"""SelfDB SDK Realtime Module - WebSocket client for real-time updates.

Uses Phoenix Channels protocol to communicate with the SelfDB realtime service.
The backend proxies WebSocket connections to the internal Phoenix server.

Usage:
    await selfdb.realtime.connect()
    channel = selfdb.realtime.channel("table:users")
    channel.on("INSERT", lambda payload: print("New user:", payload))
    channel.on("UPDATE", lambda payload: print("Updated user:", payload))
    channel.on("DELETE", lambda payload: print("Deleted user:", payload))
    channel.on("*", lambda payload: print("Any change:", payload))
    await channel.subscribe()
    
    # Later:
    await channel.unsubscribe()
    await selfdb.realtime.disconnect()
"""

import asyncio
import json
from typing import Any, Callable, Dict, List, Optional, Set, TYPE_CHECKING
import websockets


# ─────────────────────────────────────────────────────────────────────────────
# Types
# ─────────────────────────────────────────────────────────────────────────────

RealtimeEvent = str  # "INSERT", "UPDATE", "DELETE", "*"

class RealtimePayload:
    """Payload received from realtime events."""
    def __init__(self, data: Dict[str, Any]):
        self.event: str = data.get("event", "")
        self.table: str = data.get("table", "")
        self.new: Optional[Dict[str, Any]] = data.get("new")
        self.old: Optional[Dict[str, Any]] = data.get("old")
        self._raw = data
    
    def __repr__(self) -> str:
        return f"RealtimePayload(event={self.event}, table={self.table})"


RealtimeCallback = Callable[[RealtimePayload], None]


# ─────────────────────────────────────────────────────────────────────────────
# Channel Class
# ─────────────────────────────────────────────────────────────────────────────

class RealtimeChannel:
    """
    A channel for subscribing to realtime events on a specific topic.
    
    Example:
        channel = selfdb.realtime.channel("table:users")
        channel.on("INSERT", lambda p: print("New:", p.new))
        await channel.subscribe()
    """

    def __init__(self, topic: str, service: "RealtimeClient"):
        self._topic = topic
        self._service = service
        self._callbacks: Dict[str, List[RealtimeCallback]] = {}
        self._joined = False
        self._ref = 0

    @property
    def topic(self) -> str:
        return self._topic

    @property
    def is_joined(self) -> bool:
        return self._joined

    def on(self, event: str, callback: RealtimeCallback) -> "RealtimeChannel":
        """
        Register a callback for a specific event type.
        
        Args:
            event: Event type ("INSERT", "UPDATE", "DELETE", or "*" for all)
            callback: Function to call when event is received
        
        Returns:
            self for chaining
        """
        if event not in self._callbacks:
            self._callbacks[event] = []
        self._callbacks[event].append(callback)
        return self

    def off(self, event: str, callback: Optional[RealtimeCallback] = None) -> "RealtimeChannel":
        """
        Remove a callback for a specific event type.
        
        Args:
            event: Event type
            callback: Specific callback to remove (if None, removes all for event)
        
        Returns:
            self for chaining
        """
        if event not in self._callbacks:
            return self
        
        if callback is None:
            del self._callbacks[event]
        else:
            self._callbacks[event] = [cb for cb in self._callbacks[event] if cb != callback]
        
        return self

    async def subscribe(self) -> "RealtimeChannel":
        """
        Subscribe to the channel (join the Phoenix channel).
        
        Returns:
            self for chaining
        """
        if self._joined:
            return self

        self._ref += 1
        await self._service._send({
            "topic": self._topic,
            "event": "phx_join",
            "payload": {},
            "ref": str(self._ref),
        })
        self._joined = True
        return self

    async def unsubscribe(self) -> None:
        """Unsubscribe from the channel (leave the Phoenix channel)."""
        if not self._joined:
            return

        self._ref += 1
        await self._service._send({
            "topic": self._topic,
            "event": "phx_leave",
            "payload": {},
            "ref": str(self._ref),
        })
        self._joined = False
        self._service._remove_channel(self._topic)

    def _handle_message(self, event: str, payload: Any) -> None:
        """Internal: Handle incoming message for this channel."""
        # Handle Phoenix system events
        if event in ("phx_reply", "phx_close"):
            return

        # Build realtime payload
        if isinstance(payload, dict):
            realtime_payload = RealtimePayload(payload)
        else:
            realtime_payload = RealtimePayload({"event": event})

        # Normalize event name to uppercase for callback lookup
        # Phoenix sends lowercase ('insert', 'update', 'delete') but we register with uppercase
        normalized_event = (realtime_payload.event or event).upper()

        # Call specific event callbacks
        if normalized_event in self._callbacks:
            for callback in self._callbacks[normalized_event]:
                try:
                    callback(realtime_payload)
                except Exception:
                    pass  # Silently ignore callback errors

        # Call wildcard callbacks
        if "*" in self._callbacks:
            for callback in self._callbacks["*"]:
                try:
                    callback(realtime_payload)
                except Exception:
                    pass


# ─────────────────────────────────────────────────────────────────────────────
# Realtime Client Class
# ─────────────────────────────────────────────────────────────────────────────

class RealtimeClient:
    """
    WebSocket client for SelfDB real-time updates using Phoenix Channels protocol.
    
    Example:
        await selfdb.realtime.connect()
        
        channel = selfdb.realtime.channel("table:users")
        channel.on("INSERT", lambda p: print("New user:", p.new))
        await channel.subscribe()
        
        # Later:
        await channel.unsubscribe()
        await selfdb.realtime.disconnect()
    """

    def __init__(self, base_url: str, api_key: str, get_token: Callable[[], Optional[str]]):
        """
        Initialize the realtime client.
        
        Args:
            base_url: The SelfDB API base URL (http/https)
            api_key: The API key for authentication
            get_token: A callable that returns the current access token
        """
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._get_token = get_token
        self._ws: Optional[Any] = None
        self._channels: Dict[str, RealtimeChannel] = {}
        self._listen_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._connected = False
        self._heartbeat_ref = 0

    @property
    def connected(self) -> bool:
        """Check if the WebSocket is connected."""
        if not self._connected or self._ws is None:
            return False
        try:
            # websockets >= 13 uses state, older versions use open
            if hasattr(self._ws, 'state'):
                from websockets.protocol import State
                return self._ws.state == State.OPEN
            elif hasattr(self._ws, 'open'):
                return self._ws.open
            return True
        except Exception:
            return False

    @property
    def is_connected(self) -> bool:
        """Alias for connected property."""
        return self.connected

    def _get_ws_url(self) -> str:
        """Get the WebSocket URL with authentication parameters."""
        # Convert http(s) to ws(s)
        ws_base = self._base_url.replace("https://", "wss://").replace("http://", "ws://")
        token = self._get_token()
        url = f"{ws_base}/realtime/socket?X-API-Key={self._api_key}"
        if token:
            url += f"&token={token}"
        return url

    async def connect(self) -> None:
        """
        Connect to the realtime WebSocket endpoint.
        WS /realtime/socket?X-API-Key=<key>&token=<jwt>
        """
        if self.connected:
            return

        url = self._get_ws_url()
        self._ws = await websockets.connect(url)
        self._connected = True
        
        # Start listening for messages in the background
        self._listen_task = asyncio.create_task(self._listen())
        
        # Start heartbeat (Phoenix expects heartbeats every 30 seconds)
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def disconnect(self) -> None:
        """Disconnect from the realtime WebSocket."""
        self._connected = False
        
        # Cancel the heartbeat task
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None
        
        # Cancel the listen task
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
            self._listen_task = None
        
        # Close the WebSocket
        if self._ws:
            await self._ws.close()
            self._ws = None
        
        # Clear channels
        self._channels.clear()

    def channel(self, topic: str) -> RealtimeChannel:
        """
        Create or get a channel for a topic.
        
        Args:
            topic: The topic to subscribe to (e.g., "table:users")
        
        Returns:
            RealtimeChannel instance
        """
        if topic not in self._channels:
            self._channels[topic] = RealtimeChannel(topic, self)
        return self._channels[topic]

    # Legacy API compatibility
    async def subscribe(self, topic: str) -> None:
        """
        Subscribe to a topic (legacy API).
        Prefer using channel(topic).subscribe() instead.
        """
        channel = self.channel(topic)
        await channel.subscribe()

    async def unsubscribe(self, topic: str) -> None:
        """
        Unsubscribe from a topic (legacy API).
        Prefer using channel.unsubscribe() instead.
        """
        if topic in self._channels:
            await self._channels[topic].unsubscribe()

    def on(self, topic: str, event: str, callback: RealtimeCallback) -> None:
        """
        Register a callback for a specific event on a topic (legacy API).
        Prefer using channel(topic).on(event, callback) instead.
        """
        self.channel(topic).on(event, callback)

    def off(self, topic: str, event: Optional[str] = None, callback: Optional[RealtimeCallback] = None) -> None:
        """
        Remove callbacks (legacy API).
        """
        if topic not in self._channels:
            return
        
        if event is None:
            del self._channels[topic]
        else:
            self._channels[topic].off(event, callback)

    async def _send(self, message: Dict[str, Any]) -> None:
        """Internal: Send a message through the WebSocket."""
        if self._ws and self.connected:
            await self._ws.send(json.dumps(message))

    def _remove_channel(self, topic: str) -> None:
        """Internal: Remove a channel from tracking."""
        self._channels.pop(topic, None)

    async def _listen(self) -> None:
        """Listen for incoming messages and dispatch to channels."""
        try:
            while self.connected and self._ws:
                try:
                    message = await self._ws.recv()
                    data = json.loads(message)
                    self._handle_message(data)
                except websockets.exceptions.ConnectionClosed:
                    self._connected = False
                    break
                except json.JSONDecodeError:
                    continue
        except asyncio.CancelledError:
            pass

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats to keep connection alive."""
        try:
            while self.connected:
                await asyncio.sleep(30)
                if self.connected:
                    self._heartbeat_ref += 1
                    await self._send({
                        "topic": "phoenix",
                        "event": "heartbeat",
                        "payload": {},
                        "ref": str(self._heartbeat_ref),
                    })
        except asyncio.CancelledError:
            pass

    def _handle_message(self, message: Dict[str, Any]) -> None:
        """Handle incoming Phoenix message."""
        topic = message.get("topic", "")
        event = message.get("event", "")
        payload = message.get("payload", {})

        # Handle Phoenix heartbeat response
        if topic == "phoenix" and event == "phx_reply":
            return

        # Route message to appropriate channel
        if topic in self._channels:
            self._channels[topic]._handle_message(event, payload)
