"""SelfDB SDK Client - Main client class that composes all modules."""

from typing import Optional

from selfdb.http_client import HTTPClient
from selfdb.auth import AuthClient
from selfdb.tables import TablesClient
from selfdb.storage import StorageClient
from selfdb.realtime import RealtimeClient


class SelfDB:
    """
    SelfDB Python SDK Client.
    
    Example:
        from selfdb import SelfDB
        
        selfdb = SelfDB(
            base_url="https://api.your-domain.local",
            api_key="your-api-key"
        )
        
        # Authenticate
        await selfdb.auth.login(email="user@example.com", password="password")
        
        # Use tables
        tables = await selfdb.tables.list()
        
        # Use storage
        buckets = await selfdb.storage.buckets.list()
        
        # Use realtime
        await selfdb.realtime.connect()
        await selfdb.realtime.subscribe("table:users")
        
        # Close when done
        await selfdb.close()
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout: float = 30.0,
    ):
        """
        Initialize the SelfDB client.
        
        Args:
            base_url: The SelfDB API base URL (e.g., "http://localhost:8000")
            api_key: The API key for authentication
            timeout: Request timeout in seconds (default: 30.0)
        """
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        
        # Initialize HTTP client
        self._http = HTTPClient(
            base_url=self._base_url,
            api_key=api_key,
            timeout=timeout,
        )
        
        # Initialize module clients
        self.auth = AuthClient(self._http)
        self.tables = TablesClient(self._http)
        self.storage = StorageClient(self._http)
        self.realtime = RealtimeClient(
            base_url=self._base_url,
            api_key=api_key,
            get_token=lambda: self._http.access_token,
        )

    @property
    def base_url(self) -> str:
        """Get the base URL."""
        return self._base_url

    @property
    def api_key(self) -> str:
        """Get the API key."""
        return self._api_key

    @property
    def access_token(self) -> Optional[str]:
        """Get the current access token."""
        return self._http.access_token

    @property
    def refresh_token(self) -> Optional[str]:
        """Get the current refresh token."""
        return self._http.refresh_token

    async def close(self) -> None:
        """
        Close all connections.
        
        Should be called when done using the client to clean up resources.
        """
        # Disconnect realtime if connected
        if self.realtime.connected:
            await self.realtime.disconnect()
        
        # Close HTTP client
        await self._http.close()

    async def __aenter__(self) -> "SelfDB":
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.close()
