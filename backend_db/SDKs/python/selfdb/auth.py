"""SelfDB SDK Auth Module - Authentication and user management."""

from dataclasses import asdict
from typing import Any, Dict, List, Optional

from selfdb.http_client import HTTPClient
from selfdb.models import (
    UserCreate,
    UserUpdate,
    UserRead,
    TokenPair,
    LogoutResponse,
    UserDeleteResponse,
    user_from_dict,
)


class UsersResource:
    """User management sub-resource for auth."""

    def __init__(self, http: HTTPClient):
        self._http = http

    async def create(self, payload: UserCreate) -> UserRead:
        """Create a new user. POST /users/"""
        data = {k: v for k, v in asdict(payload).items() if v is not None}
        # Role is not allowed in create request
        data.pop("role", None)
        response = await self._http.post("/users/", json=data)
        return user_from_dict(response)

    async def list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
    ) -> List[UserRead]:
        """List users with optional search and sorting. GET /users/"""
        params = {
            "skip": skip,
            "limit": limit,
            "search": search,
            "sort_by": sort_by,
            "sort_order": sort_order,
        }
        response = await self._http.get("/users/", params=params, authenticated=True)
        return [user_from_dict(u) for u in response]

    async def get(self, user_id: str) -> UserRead:
        """Get a user by ID. GET /users/{user_id}"""
        response = await self._http.get(f"/users/{user_id}", authenticated=True)
        return user_from_dict(response)

    async def update(self, user_id: str, payload: UserUpdate) -> UserRead:
        """Update a user. PATCH /users/{user_id}"""
        data = {k: v for k, v in asdict(payload).items() if v is not None}
        if "role" in data and hasattr(data["role"], "value"):
            data["role"] = data["role"].value
        response = await self._http.patch(f"/users/{user_id}", json=data, authenticated=True)
        return user_from_dict(response)

    async def delete(self, user_id: str) -> UserDeleteResponse:
        """Delete a user. DELETE /users/{user_id}"""
        response = await self._http.delete(f"/users/{user_id}", authenticated=True)
        return UserDeleteResponse(
            message=response.get("message", "User deleted"),
            deleted_id=response.get("deleted_id", user_id),
        )


class AuthClient:
    """Authentication client for SelfDB."""

    def __init__(self, http: HTTPClient):
        self._http = http
        self.users = UsersResource(http)

    async def login(self, email: str, password: str) -> TokenPair:
        """
        Login with email and password. POST /users/token
        
        Stores the access and refresh tokens for subsequent authenticated requests.
        """
        response = await self._http.post(
            "/users/token",
            json={"email": email, "password": password},
        )
        token_pair = TokenPair(
            access_token=response["access_token"],
            refresh_token=response["refresh_token"],
            token_type=response.get("token_type", "bearer"),
        )
        # Store tokens for authenticated requests
        self._http.access_token = token_pair.access_token
        self._http.refresh_token = token_pair.refresh_token
        return token_pair

    async def refresh(self, refresh_token: Optional[str] = None) -> TokenPair:
        """
        Refresh the access token. POST /users/token/refresh
        
        Uses the stored refresh token if none is provided.
        Updates stored tokens with new values.
        """
        token = refresh_token or self._http.refresh_token
        if not token:
            raise ValueError("No refresh token available")
        
        response = await self._http.post(
            "/users/token/refresh",
            json={"refresh_token": token},
        )
        token_pair = TokenPair(
            access_token=response["access_token"],
            refresh_token=response["refresh_token"],
            token_type=response.get("token_type", "bearer"),
        )
        # Update stored tokens
        self._http.access_token = token_pair.access_token
        self._http.refresh_token = token_pair.refresh_token
        return token_pair

    async def logout(self, refresh_token: Optional[str] = None) -> LogoutResponse:
        """
        Logout the current user. POST /users/logout
        
        If refresh_token is provided, revokes only that token.
        Otherwise, revokes only the current session's refresh token.
        """
        token = refresh_token or self._http.refresh_token
        response = await self._http.post(
            "/users/logout",
            json={"refresh_token": token} if token else {},
            authenticated=True,
        )
        # Clear stored tokens
        self._http.clear_tokens()
        return LogoutResponse(message=response.get("message", "Logged out"))

    async def logout_all(self) -> LogoutResponse:
        """
        Logout from all devices. POST /users/logout/all
        
        Revokes all refresh tokens for the current user.
        """
        response = await self._http.post(
            "/users/logout/all",
            authenticated=True,
        )
        # Clear stored tokens
        self._http.clear_tokens()
        return LogoutResponse(message=response.get("message", "Logged out from all devices"))

    async def me(self) -> UserRead:
        """Get the current authenticated user. GET /users/me"""
        response = await self._http.get("/users/me", authenticated=True)
        return user_from_dict(response)

    async def count(self, search: Optional[str] = None) -> int:
        """Get total number of users. GET /users/count"""
        params = {"search": search} if search else None
        response = await self._http.get("/users/count", params=params, authenticated=True)
        return response.get("count", 0)
