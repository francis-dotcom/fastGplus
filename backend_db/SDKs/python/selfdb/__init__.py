"""SelfDB Python SDK - Full Self-Hosted BaaS Built for AI Agents."""

from selfdb.client import SelfDB
from selfdb.exceptions import (
    SelfDBError,
    APIConnectionError,
    BadRequestError,
    AuthenticationError,
    PermissionDeniedError,
    NotFoundError,
    ConflictError,
    InternalServerError,
)

__version__ = "0.0.5"

__all__ = [
    "SelfDB",
    "SelfDBError",
    "APIConnectionError",
    "BadRequestError",
    "AuthenticationError",
    "PermissionDeniedError",
    "NotFoundError",
    "ConflictError",
    "InternalServerError",
]
