# security.py
import os
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional
from uuid import UUID
import asyncio
from concurrent.futures import ThreadPoolExecutor
import jwt
from fastapi import Depends, HTTPException, status, Security
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict
import psycopg
from db import get_db

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

class SecuritySettings(BaseSettings):
    SECRET_KEY: str  # Required - no fallback
    ALGORITHM: str  # Required - no fallback
    ACCESS_TOKEN_EXPIRE_MINUTES: int  # Required - no fallback
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30  # Default 30 days for mobile apps
    API_KEY: str  # Required - no fallback
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

security_settings = SecuritySettings()

SECRET_KEY = security_settings.SECRET_KEY
ALGORITHM = security_settings.ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = security_settings.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = security_settings.REFRESH_TOKEN_EXPIRE_DAYS

# API Key Configuration
API_KEY = security_settings.API_KEY
API_KEY_NAME = "X-API-Key"

# Use bcrypt instead of Argon2 for faster password hashing
# rounds=10 ≈ 65ms (vs Argon2's 500ms+), still industry-standard security
# Increase rounds to 12 for production if latency is acceptable
password_hash = PasswordHash((BcryptHasher(rounds=10),))
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/users/token")
# Optional OAuth2 - doesn't raise error if token is missing
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/users/token", auto_error=False)

# Thread pool for CPU-intensive password hashing (bcrypt blocks the event loop!)
_password_executor = ThreadPoolExecutor(max_workers=4)


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    user_id: Optional[str] = None

# ─────────────────────────────────────────────────────────────────────────────
# Utilities - ASYNC versions to avoid blocking the event loop
# ─────────────────────────────────────────────────────────────────────────────
def _verify_password_sync(plain_password: str, hashed_password: str) -> bool:
    """Sync version - DO NOT call directly, use verify_password instead."""
    return password_hash.verify(plain_password, hashed_password)

def _get_password_hash_sync(password: str) -> str:
    """Sync version - DO NOT call directly, use get_password_hash instead."""
    return password_hash.hash(password)

async def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password in thread pool to avoid blocking event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _password_executor, _verify_password_sync, plain_password, hashed_password
    )

async def get_password_hash(password: str) -> str:
    """Hash password in thread pool to avoid blocking event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _password_executor, _get_password_hash_sync, password
    )



def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    
    # Ensure sub is a string
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
        
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────
async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: psycopg.AsyncConnection = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        token_data = TokenData(user_id=user_id)
    except InvalidTokenError:
        raise credentials_exception

    # Fetch user from DB
    result = await db.execute("SELECT * FROM users WHERE id = %s", (UUID(token_data.user_id),))
    record = await result.fetchone()
    if record is None:
        raise credentials_exception
    
    return record # Returns dict (with dict_row factory)

from models.user import UserInDB

async def get_current_active_user(
    current_user_record = Depends(get_current_user)
) -> UserInDB:
    user = UserInDB(**current_user_record)
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user

# ─────────────────────────────────────────────────────────────────────────────
# Optional Authentication (for public resources)
# ─────────────────────────────────────────────────────────────────────────────
async def get_optional_current_user(
    token: str | None = Depends(optional_oauth2_scheme),
    db: psycopg.AsyncConnection = Depends(get_db)
) -> UserInDB | None:
    """
    Optional authentication - returns None if no token provided.
    Used for endpoints that support both authenticated and unauthenticated access.
    """
    if not token:
        return None
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        
        # Fetch user from DB
        result = await db.execute("SELECT * FROM users WHERE id = %s", (UUID(user_id),))
        record = await result.fetchone()
        if record is None:
            return None
        
        user = UserInDB(**record)
        if not user.is_active:
            return None
        
        return user
    except (InvalidTokenError, Exception):
        # Invalid token - return None instead of raising error
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Refresh Token Functions (Database-backed for multi-worker support)
# ─────────────────────────────────────────────────────────────────────────────

def generate_refresh_token() -> str:
    """Generate a cryptographically secure refresh token (43 chars, URL-safe)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Hash a token using SHA-256 for secure storage."""
    return hashlib.sha256(token.encode()).hexdigest()


async def create_refresh_token(
    db: psycopg.AsyncConnection,
    user_id: UUID,
) -> str:
    """
    Create and store a new refresh token in the database.
    Returns the raw token (only returned once, stored as hash).
    """
    raw_token = generate_refresh_token()
    token_hash = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    
    await db.execute(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s)
        """,
        (user_id, token_hash, expires_at)
    )
    
    return raw_token


async def validate_refresh_token(
    db: psycopg.AsyncConnection,
    refresh_token: str
) -> UUID | None:
    """
    Validate a refresh token and return the user_id if valid.
    Returns None if token is invalid, expired, or revoked.
    """
    token_hash = hash_token(refresh_token)
    
    result = await db.execute(
        """
        SELECT user_id, expires_at, revoked_at 
        FROM refresh_tokens 
        WHERE token_hash = %s
        """,
        (token_hash,)
    )
    row = await result.fetchone()
    
    if not row:
        return None
    
    # Check if revoked
    if row['revoked_at'] is not None:
        return None
    
    # Check if expired
    if row['expires_at'] < datetime.now(timezone.utc):
        return None
    
    return row['user_id']


async def rotate_refresh_token(
    db: psycopg.AsyncConnection,
    old_refresh_token: str,
    user_id: UUID
) -> str | None:
    """
    Rotate a refresh token: revoke the old one and create a new one.
    Returns the new raw token, or None if old token was invalid.
    """
    token_hash = hash_token(old_refresh_token)
    
    # Revoke the old token
    result = await db.execute(
        """
        UPDATE refresh_tokens 
        SET revoked_at = CURRENT_TIMESTAMP 
        WHERE token_hash = %s AND revoked_at IS NULL
        RETURNING id
        """,
        (token_hash,)
    )
    row = await result.fetchone()
    
    if not row:
        # Token was already revoked or doesn't exist - potential reuse attack
        # Revoke ALL tokens for this user as a security measure
        await revoke_all_user_tokens(db, user_id)
        return None
    
    # Create new token
    return await create_refresh_token(db, user_id)


async def revoke_refresh_token(
    db: psycopg.AsyncConnection,
    refresh_token: str
) -> bool:
    """Revoke a single refresh token. Returns True if token was found and revoked."""
    token_hash = hash_token(refresh_token)
    
    result = await db.execute(
        """
        UPDATE refresh_tokens 
        SET revoked_at = CURRENT_TIMESTAMP 
        WHERE token_hash = %s AND revoked_at IS NULL
        """,
        (token_hash,)
    )
    
    return result.rowcount > 0


async def revoke_all_user_tokens(
    db: psycopg.AsyncConnection,
    user_id: UUID
) -> int:
    """Revoke all refresh tokens for a user (logout from all devices). Returns count revoked."""
    result = await db.execute(
        """
        UPDATE refresh_tokens 
        SET revoked_at = CURRENT_TIMESTAMP 
        WHERE user_id = %s AND revoked_at IS NULL
        """,
        (user_id,)
    )
    
    return result.rowcount