#main.py 

import os
from fastapi import FastAPI
from contextlib import asynccontextmanager
from db import init_db, close_db
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from endpoints.users import router as users_router
from endpoints.tables import router as tables_router
from endpoints.system import router as system_router
from endpoints.backups import router as backups_router
from endpoints.sql import router as sql_router
from endpoints.realtime import router as realtime_router
from endpoints.buckets import router as buckets_router
from endpoints.files import router as files_router
from endpoints.functions import router as functions_router
from endpoints.webhooks import router as webhooks_router
from endpoints.schema import router as schema_router
from security import API_KEY
from fastapi.openapi.utils import get_openapi
from services.backup_service import start_scheduler, stop_scheduler
from storage_client import close_client as close_storage_client

# App metadata from environment variables (required)
APP_NAME = os.environ["APP_NAME"]
APP_DESCRIPTION = os.environ["APP_DESCRIPTION"]
APP_VERSION = os.environ["APP_VERSION"]

# ─────────────────────────────────────────────────────────────────────────────
# Custom Middleware for API Key Validation
# ─────────────────────────────────────────────────────────────────────────────

class APIKeyMiddleware(BaseHTTPMiddleware):
    """
    Middleware to validate API key for all requests except documentation endpoints
    and public webhook trigger endpoints.
    Runs before routing and OpenAPI schema validation.
    
    API Key Sources:
    - HTTP Header: X-API-Key (for REST endpoints)
    - Query Parameter: X-API-Key (for WebSocket - can't use headers during handshake)
    """
    async def dispatch(self, request, call_next):
        # Only webhook trigger endpoint is excluded from API key validation
        # Documentation endpoints now require API key for security
        excluded_paths: list[str] = []
        
        current_path = request.url.path
        
        # Skip API key validation for excluded endpoints
        if current_path in excluded_paths:
            return await call_next(request)
        
        # Skip API key validation for webhook trigger endpoint (public ingestion)
        # Pattern: /webhooks/trigger/{webhook_token}
        if current_path.startswith("/webhooks/trigger/"):
            return await call_next(request)
        
        # Check for API key in header first, then query params (for WebSocket)
        api_key = request.headers.get("X-API-Key")
        
        # WebSocket connections can't use headers during handshake
        # Allow API key via query parameter for WebSocket endpoints
        if not api_key and current_path.startswith("/realtime/socket"):
            api_key = request.query_params.get("X-API-Key")
        
        if not api_key:
            return JSONResponse(
                status_code=406,
                content={"detail": "Missing required header: X-API-Key"}
            )
        
        if api_key != API_KEY:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid API key"}
            )
        
        # API key is valid, proceed with request
        response = await call_next(request)
        return response



@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await start_scheduler()
    yield
    await stop_scheduler()
    await close_storage_client()
    await close_db()

app = FastAPI(
    title=APP_NAME, 
    description=APP_DESCRIPTION,
    version=APP_VERSION,
    lifespan=lifespan
)


# Add API Key middleware BEFORE CORS
# This ensures API key validation happens first
app.add_middleware(APIKeyMiddleware)

# CORS origins from environment variable (required, no fallback)
CORS_ORIGINS = os.environ["CORS_ORIGINS"].split(",")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# Include all routers
app.include_router(users_router)
app.include_router(tables_router)
app.include_router(system_router)
app.include_router(backups_router)
app.include_router(sql_router)
app.include_router(realtime_router)
app.include_router(buckets_router)
app.include_router(files_router)
app.include_router(functions_router)
app.include_router(webhooks_router)
app.include_router(schema_router)


# Custom OpenAPI schema to document X-API-Key as a required header parameter
# and add WebSocket endpoint documentation
def custom_openapi():  
    if app.openapi_schema:  
        return app.openapi_schema  
      
    openapi_schema = get_openapi(  
        title=app.title,  
        version=app.version,  
        description=app.description,  
        routes=app.routes,  
    )  
    
    # Add WebSocket endpoint documentation (OpenAPI doesn't natively support WebSocket)
    openapi_schema["paths"]["/realtime/socket"] = {
        "get": {
            "tags": ["realtime"],
            "summary": "WebSocket Proxy for Realtime",
            "description": """WebSocket endpoint that proxies connections to the internal Phoenix realtime service.

**Protocol:** WebSocket (not HTTP)

**Authentication:**
- API Key: Pass `X-API-Key` as query parameter (required)
- JWT Token: Pass `token` as query parameter for user context (optional)

**Connection URL:**
```
ws://localhost:8000/realtime/socket?X-API-Key=<api_key>&token=<jwt_token>
```

**Phoenix Channel Protocol:**
- Join: `{"topic": "table:users", "event": "phx_join", "payload": {}, "ref": "1"}`
- Events: `insert`, `update`, `delete`
- Payload: `{"event": "INSERT", "table": "users", "new": {...}, "old": null}`
""",
            "operationId": "websocket_realtime_socket",
            "parameters": [
                {
                    "name": "X-API-Key",
                    "in": "query",
                    "required": True,
                    "schema": {"type": "string"},
                    "description": "API key required for WebSocket connections (passed as query param since WebSocket can't use headers)"
                },
                {
                    "name": "token",
                    "in": "query",
                    "required": False,
                    "schema": {"type": "string"},
                    "description": "JWT access token for user authentication (optional, for user-specific subscriptions)"
                }
            ],
            "responses": {
                "101": {
                    "description": "Switching Protocols - WebSocket connection established"
                },
                "404": {
                    "description": "Not Found - This endpoint only accepts WebSocket connections, not HTTP requests",
                    "content": {
                        "application/json": {
                            "schema": {"type": "object", "properties": {"detail": {"type": "string"}}}
                        }
                    }
                },
                "406": {
                    "description": "Missing required X-API-Key parameter",
                    "content": {
                        "application/json": {
                            "schema": {"type": "object", "properties": {"detail": {"type": "string"}}}
                        }
                    }
                },
                "401": {
                    "description": "Invalid API key",
                    "content": {
                        "application/json": {
                            "schema": {"type": "object", "properties": {"detail": {"type": "string"}}}
                        }
                    }
                }
            }
        }
    }
      
    # Add X-API-Key as a required header parameter to all REST operations
    # Except WebSocket (uses query param) and webhook trigger (public endpoint)
    for path, path_item in openapi_schema["paths"].items():
        # Skip the WebSocket endpoint (uses query param, not header)
        if path == "/realtime/socket":
            continue
        
        # Skip webhook trigger endpoint (public, no API key required)
        if path.startswith("/webhooks/trigger/"):
            continue
            
        for operation in path_item.values():  
            if isinstance(operation, dict) and "operationId" in operation:  
                if "parameters" not in operation:
                    operation["parameters"] = []
                
                # Add X-API-Key header parameter if not already present
                has_api_key = any(
                    p.get("name") == "X-API-Key" and p.get("in") == "header"
                    for p in operation["parameters"]
                )
                
                if not has_api_key:
                    operation["parameters"].append({
                        "name": "X-API-Key",
                        "in": "header",
                        "required": True,
                        "schema": {"type": "string"},
                        "description": "API key required for all endpoints (validated by middleware)"
                    })
      
    app.openapi_schema = openapi_schema  
    return app.openapi_schema  
  
app.openapi = custom_openapi
