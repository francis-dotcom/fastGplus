"""SelfDB SDK HTTP Client - Base async HTTP client with error handling."""

from typing import Any, Dict, Optional, Union
import httpx

from selfdb.exceptions import (
    SelfDBError,
    APIConnectionError,
    BadRequestError,
    AuthenticationError,
    PermissionDeniedError,
    NotFoundError,
    ConflictError,
    UnprocessableEntityError,
    InternalServerError,
)


class HTTPClient:
    """Async HTTP client for SelfDB API."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def access_token(self) -> Optional[str]:
        """Get the current access token."""
        return self._access_token

    @access_token.setter
    def access_token(self, value: Optional[str]) -> None:
        """Set the access token."""
        self._access_token = value

    @property
    def refresh_token(self) -> Optional[str]:
        """Get the current refresh token."""
        return self._refresh_token

    @refresh_token.setter
    def refresh_token(self, value: Optional[str]) -> None:
        """Set the refresh token."""
        self._refresh_token = value

    def clear_tokens(self) -> None:
        """Clear stored tokens."""
        self._access_token = None
        self._refresh_token = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _build_headers(self, authenticated: bool = False) -> Dict[str, str]:
        """Build request headers."""
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
        }
        if authenticated and self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        return headers

    def _handle_error(self, response: httpx.Response) -> None:
        """Handle HTTP error responses by raising appropriate exceptions."""
        status_code = response.status_code
        
        try:
            body = response.json()
            message = body.get("detail", str(body))
        except Exception:
            message = response.text or f"HTTP {status_code}"

        if status_code == 400:
            raise BadRequestError(message, response_body=body if 'body' in dir() else None)
        elif status_code == 401:
            raise AuthenticationError(message, response_body=body if 'body' in dir() else None)
        elif status_code == 403:
            raise PermissionDeniedError(message, response_body=body if 'body' in dir() else None)
        elif status_code == 404:
            raise NotFoundError(message, response_body=body if 'body' in dir() else None)
        elif status_code == 409:
            raise ConflictError(message, response_body=body if 'body' in dir() else None)
        elif status_code == 422:
            raise UnprocessableEntityError(message, response_body=body if 'body' in dir() else None)
        elif status_code >= 500:
            raise InternalServerError(message, response_body=body if 'body' in dir() else None)
        else:
            raise SelfDBError(message, status_code=status_code)

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        authenticated: bool = False,
        headers: Optional[Dict[str, str]] = None,
    ) -> httpx.Response:
        """Make an HTTP request."""
        client = await self._get_client()
        
        request_headers = self._build_headers(authenticated=authenticated)
        if headers:
            request_headers.update(headers)
        
        # Remove Content-Type for multipart/form-data (let httpx set it)
        if files:
            request_headers.pop("Content-Type", None)

        # Filter out None values from params
        if params:
            params = {k: v for k, v in params.items() if v is not None}

        try:
            response = await client.request(
                method=method,
                url=path,
                params=params,
                json=json,
                data=data,
                files=files,
                headers=request_headers,
            )
        except httpx.ConnectError as e:
            raise APIConnectionError(f"Failed to connect to {self.base_url}: {e}")
        except httpx.TimeoutException as e:
            raise APIConnectionError(f"Request timed out: {e}")
        except httpx.RequestError as e:
            raise APIConnectionError(f"Request failed: {e}")

        if response.status_code >= 400:
            self._handle_error(response)

        return response

    async def get(
        self,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        authenticated: bool = False,
    ) -> Any:
        """Make a GET request and return JSON response."""
        response = await self.request("GET", path, params=params, authenticated=authenticated)
        return response.json()

    async def post(
        self,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        authenticated: bool = False,
    ) -> Any:
        """Make a POST request and return JSON response."""
        response = await self.request(
            "POST",
            path,
            json=json,
            data=data,
            files=files,
            params=params,
            authenticated=authenticated,
        )
        return response.json()

    async def patch(
        self,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        authenticated: bool = False,
    ) -> Any:
        """Make a PATCH request and return JSON response."""
        response = await self.request(
            "PATCH",
            path,
            json=json,
            params=params,
            authenticated=authenticated,
        )
        return response.json()

    async def delete(
        self,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        authenticated: bool = False,
    ) -> Any:
        """Make a DELETE request and return JSON response."""
        response = await self.request("DELETE", path, params=params, authenticated=authenticated)
        return response.json()

    async def get_raw(
        self,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        authenticated: bool = False,
    ) -> bytes:
        """Make a GET request and return raw bytes."""
        response = await self.request("GET", path, params=params, authenticated=authenticated)
        return response.content
