# bucket.py - Backend models for Storage Buckets
# Compatible with: storage/models/bucket.py, frontend bucketService.ts

from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID
import re

# S3-compatible bucket naming: 3-63 chars, lowercase alphanumeric, hyphens
BUCKET_NAME_PATTERN = r'^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$'


def validate_bucket_name(v: Optional[str]) -> Optional[str]:
    """Validate bucket name follows S3-style naming conventions."""
    if v is None:
        return v
    if len(v) < 3 or len(v) > 63:
        raise ValueError('Bucket name must be between 3 and 63 characters')
    if not re.match(BUCKET_NAME_PATTERN, v):
        raise ValueError('Bucket name must be lowercase alphanumeric, start/end with alphanumeric')
    return v


# ─────────────────────────────────────────────────────────────────────────────
# Create / Update
# ─────────────────────────────────────────────────────────────────────────────

class BucketCreate(BaseModel):
    """Request model for creating a bucket."""
    name: str = Field(
        min_length=3,
        max_length=63,
        pattern=BUCKET_NAME_PATTERN,
        strict=True,
        examples=["my-bucket", "user-uploads"]
    )
    public: bool = Field(default=False, strict=True)
    description: Optional[str] = Field(None, max_length=500)
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)
    
    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        return validate_bucket_name(v)
    
    model_config = ConfigDict(extra='forbid')


class BucketUpdate(BaseModel):
    """Request model for updating a bucket."""
    public: Optional[bool] = Field(None, strict=True)
    description: Optional[str] = Field(None, max_length=500)
    metadata: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(extra='forbid')


# ─────────────────────────────────────────────────────────────────────────────
# Response
# ─────────────────────────────────────────────────────────────────────────────

class BucketResponse(BaseModel):
    """Response model for bucket (matches frontend Bucket interface)."""
    id: UUID
    name: str
    public: bool
    description: Optional[str] = None
    file_count: int = 0
    total_size: int = 0
    owner_id: Optional[UUID] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class BucketListResponse(BaseModel):
    """Response model for listing buckets."""
    buckets: List[BucketResponse]
    total: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────────────────────────────

class BucketInDB(BaseModel):
    """Database model for bucket (maps to buckets table)."""
    id: UUID
    name: str
    public: bool = False
    description: Optional[str] = None
    owner_id: Optional[UUID] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    file_count: int = 0
    total_size: int = 0
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
