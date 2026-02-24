# token.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class TokenPair(BaseModel):
    """Response containing both access and refresh tokens."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access token expiry in seconds")


class RefreshRequest(BaseModel):
    """Request to refresh tokens."""
    refresh_token: str = Field(min_length=1, max_length=512)


class LogoutRequest(BaseModel):
    """Request to logout (revoke refresh token)."""
    refresh_token: Optional[str] = Field(None, min_length=1, max_length=512)


class LogoutResponse(BaseModel):
    """Response from logout."""
    status: str = "logged_out"


class RefreshTokenInDB(BaseModel):
    """Refresh token as stored in database."""
    id: UUID
    user_id: UUID
    token_hash: str
    expires_at: datetime
    created_at: datetime
    revoked_at: Optional[datetime] = None
