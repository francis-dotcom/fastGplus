# realtime.py
"""
WebSocket Proxy for Realtime Service

This endpoint proxies WebSocket connections from clients to the internal Phoenix
realtime service. The backend handles JWT authentication before forwarding
connections with user context.

Architecture:
  Client <--> Backend (:8000/realtime/socket) <--> Phoenix (internal)
  
Benefits:
  - Single API gateway (one URL for SDK)
  - Centralized authentication (JWT validated here, API key validated by middleware)
  - Phoenix not exposed externally (more secure)
  - User context passed to Phoenix for channel authorization

Security:
  - API Key: Required via query param (WebSocket can't use headers during handshake)
  - JWT Token: Optional for user context (anonymous allowed for public tables)
"""
import asyncio
import os
from typing import Optional

import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from security import SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/realtime", tags=["realtime"])

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Internal Phoenix realtime service URL (Docker network)
# Port from environment variable - .env is source of truth
REALTIME_INTERNAL_PORT = os.environ.get("REALTIME_INTERNAL_PORT", "4000")
PHOENIX_WS_URL = f"ws://realtime:{REALTIME_INTERNAL_PORT}/socket/websocket"


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket Token Validation (separate from REST auth - WebSocket can't use headers)
# ─────────────────────────────────────────────────────────────────────────────

import jwt
from jwt.exceptions import InvalidTokenError


async def validate_websocket_token(token: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """
    Validate JWT token and extract user context for WebSocket connections.
    
    WebSocket connections pass token as query parameter since they can't use
    Authorization headers during the initial handshake.
    
    Returns:
        tuple: (user_id, role) - both None if token invalid or not provided
    """
    if not token:
        return None, None
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        role = payload.get("role")
        return user_id, role
    except InvalidTokenError:
        return None, None


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket Proxy Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/socket")
async def websocket_proxy(
    websocket: WebSocket,
    token: Optional[str] = Query(None, description="JWT access token for user authentication")
):
    """
    WebSocket proxy endpoint that forwards connections to Phoenix realtime service.
    
    Authentication:
    - API Key: Required via X-API-Key query param (validated by middleware)
    - JWT Token: Optional via token query param (for user context)
    
    Usage:
        ws://localhost:8000/realtime/socket?X-API-Key=<api_key>&token=<jwt_token>
    
    Phoenix Channel Protocol:
    - Send: {"topic": "table:users", "event": "phx_join", "payload": {}, "ref": "1"}
    - Receive: {"topic": "table:users", "event": "insert", "payload": {...}, "ref": null}
    """
    # Note: API Key validation is handled by middleware (checks query params for WebSocket)
    
    # Accept the WebSocket connection from client
    await websocket.accept()
    
    # Validate JWT and extract user context
    user_id, role = await validate_websocket_token(token)
    
    # Connect to internal Phoenix with user context
    phoenix_url = f"{PHOENIX_WS_URL}?user_id={user_id or ''}&role={role or ''}"
    
    try:
        async with websockets.connect(phoenix_url) as phoenix_ws:
            # Create tasks for bidirectional message forwarding
            async def client_to_phoenix():
                """Forward messages from client to Phoenix"""
                try:
                    while True:
                        data = await websocket.receive_text()
                        await phoenix_ws.send(data)
                except WebSocketDisconnect:
                    pass
            
            async def phoenix_to_client():
                """Forward messages from Phoenix to client"""
                try:
                    async for message in phoenix_ws:
                        await websocket.send_text(message)
                except websockets.exceptions.ConnectionClosed:
                    pass
            
            # Run both forwarding tasks concurrently
            client_task = asyncio.create_task(client_to_phoenix())
            phoenix_task = asyncio.create_task(phoenix_to_client())
            
            # Wait for either task to complete (connection closed)
            done, pending = await asyncio.wait(
                [client_task, phoenix_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            
            # Cancel pending tasks
            for task in pending:
                task.cancel()
                
    except websockets.exceptions.WebSocketException as e:
        # Phoenix connection failed
        await websocket.close(code=1011, reason=f"Phoenix connection failed: {str(e)}")
    except Exception as e:
        await websocket.close(code=1011, reason=f"Proxy error: {str(e)}")
