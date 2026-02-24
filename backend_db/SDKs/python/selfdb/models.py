"""SelfDB SDK Models - Request and Response types."""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field


class UserRole(str, Enum):
    """User role enumeration."""
    ADMIN = "ADMIN"
    USER = "USER"


# ─────────────────────────────────────────────────────────────────────────────
# User Models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class UserCreate:
    """Request model for creating a user."""
    email: str
    password: str
    firstName: str
    lastName: str


@dataclass
class UserUpdate:
    """Request model for updating a user."""
    email: Optional[str] = None
    password: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    role: Optional[UserRole] = None


@dataclass
class UserRead:
    """Response model for a user."""
    id: str
    email: str
    role: UserRole
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class LoginRequest:
    """Request model for login."""
    email: str
    password: str


@dataclass
class TokenPair:
    """Response containing access and refresh tokens."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@dataclass
class RefreshRequest:
    """Request to refresh tokens."""
    refresh_token: str


@dataclass
class LogoutRequest:
    """Request to logout."""
    refresh_token: Optional[str] = None


@dataclass
class LogoutResponse:
    """Response from logout."""
    message: str


@dataclass
class UserDeleteResponse:
    """Response from deleting a user."""
    message: str
    deleted_id: str


# ─────────────────────────────────────────────────────────────────────────────
# Table Models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ColumnDefinition:
    """Model for defining a column."""
    name: str
    type: str
    nullable: bool = True
    default: Optional[str] = None
    primary_key: bool = False
    unique: bool = False


@dataclass
class ColumnUpdate:
    """Model for updating column properties."""
    new_name: Optional[str] = None
    type: Optional[str] = None
    nullable: Optional[bool] = None
    default: Optional[str] = None


@dataclass
class TableCreate:
    """Request model for creating a table."""
    name: str
    table_schema: Dict[str, Any]
    description: Optional[str] = None
    public: bool = False
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class TableUpdate:
    """Request model for updating a table."""
    name: Optional[str] = None
    table_schema: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    public: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None
    realtime_enabled: Optional[bool] = None


@dataclass
class TableRead:
    """Response model for a table."""
    id: str
    name: str
    schema_name: str
    owner_id: str
    public: bool
    realtime: bool
    description: Optional[str] = None
    columns: List[Dict[str, Any]] = field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class TableDataResponse:
    """Response model for table data with pagination."""
    data: List[Dict[str, Any]]
    total: int
    page: int
    page_size: int


@dataclass
class TableDeleteResponse:
    """Response from deleting a table."""
    message: str
    deleted_id: str


@dataclass
class RowDeleteResponse:
    """Response from deleting a row."""
    message: str
    deleted_id: str


# ─────────────────────────────────────────────────────────────────────────────
# Storage Models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BucketCreate:
    """Request model for creating a bucket."""
    name: str
    description: Optional[str] = None
    public: bool = False
    file_size_limit: Optional[int] = None
    allowed_mime_types: Optional[List[str]] = None


@dataclass
class BucketUpdate:
    """Request model for updating a bucket."""
    name: Optional[str] = None
    description: Optional[str] = None
    public: Optional[bool] = None
    file_size_limit: Optional[int] = None
    allowed_mime_types: Optional[List[str]] = None


@dataclass
class BucketResponse:
    """Response model for a bucket."""
    id: str
    name: str
    owner_id: str
    public: bool
    description: Optional[str] = None
    file_size_limit: Optional[int] = None
    allowed_mime_types: Optional[List[str]] = None
    file_count: int = 0
    total_size: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class FileResponse:
    """Response model for a file."""
    id: str
    name: str
    bucket_id: str
    bucket_name: str
    path: str
    size: int
    mime_type: str
    owner_id: str
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class FileUploadResponse:
    """Response model for file upload."""
    success: bool
    bucket: str
    path: str
    size: int
    file_id: Optional[str] = None
    upload_time: Optional[float] = None
    url: Optional[str] = None
    original_path: Optional[str] = None
    message: Optional[str] = None


@dataclass
class FileDataResponse:
    """Response model for file listing with pagination."""
    data: List[FileResponse]
    total: int
    page: int
    page_size: int


@dataclass
class StorageStatsResponse:
    """Response model for storage statistics."""
    total_files: int
    total_size: int
    total_buckets: int


# ─────────────────────────────────────────────────────────────────────────────
# Utility functions for parsing responses
# ─────────────────────────────────────────────────────────────────────────────

def parse_datetime(value: Any) -> Optional[datetime]:
    """Parse a datetime string or return None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        # Handle ISO format with or without timezone
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def user_from_dict(data: Dict[str, Any]) -> UserRead:
    """Create a UserRead from a dictionary."""
    role_str = data.get("role", "USER")
    try:
        role = UserRole(role_str)
    except ValueError:
        role = UserRole.USER
    return UserRead(
        id=data["id"],
        email=data["email"],
        role=role,
        firstName=data.get("firstName"),
        lastName=data.get("lastName"),
        created_at=parse_datetime(data.get("created_at")),
        updated_at=parse_datetime(data.get("updated_at")),
    )


def table_from_dict(data: Dict[str, Any]) -> TableRead:
    """Create a TableRead from a dictionary."""
    return TableRead(
        id=data["id"],
        name=data["name"],
        schema_name=data.get("schema_name", "public"),
        owner_id=data["owner_id"],
        public=data.get("public", False),
        realtime=data.get("realtime", False),
        description=data.get("description"),
        columns=data.get("columns", []),
        created_at=parse_datetime(data.get("created_at")),
        updated_at=parse_datetime(data.get("updated_at")),
    )


def bucket_from_dict(data: Dict[str, Any]) -> BucketResponse:
    """Create a BucketResponse from a dictionary."""
    return BucketResponse(
        id=data["id"],
        name=data["name"],
        owner_id=data["owner_id"],
        public=data.get("public", False),
        description=data.get("description"),
        file_size_limit=data.get("file_size_limit"),
        allowed_mime_types=data.get("allowed_mime_types"),
        file_count=data.get("file_count", 0),
        total_size=data.get("total_size", 0),
        created_at=parse_datetime(data.get("created_at")),
        updated_at=parse_datetime(data.get("updated_at")),
    )


def file_from_dict(data: Dict[str, Any]) -> FileResponse:
    """Create a FileResponse from a dictionary."""
    return FileResponse(
        id=data["id"],
        name=data["name"],
        bucket_id=data["bucket_id"],
        bucket_name=data.get("bucket_name", ""),
        path=data["path"],
        size=data["size"],
        mime_type=data["mime_type"],
        owner_id=data["owner_id"],
        metadata=data.get("metadata"),
        created_at=parse_datetime(data.get("created_at")),
        updated_at=parse_datetime(data.get("updated_at")),
    )
