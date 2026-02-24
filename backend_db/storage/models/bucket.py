from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional
from datetime import datetime
from uuid import UUID
import re

# Bucket name pattern: 3-63 chars, lowercase alphanumeric, hyphens allowed (not at start/end)
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
# 1. Create Model
# ─────────────────────────────────────────────────────────────────────────────
class BucketCreate(BaseModel):
    name: str = Field(
        min_length=3, 
        max_length=63, 
        pattern=BUCKET_NAME_PATTERN, 
        strict=True,
        examples=["my-bucket", "test-storage", "media-files"],
        json_schema_extra={
            "pattern": BUCKET_NAME_PATTERN,
            "description": "Bucket name (3-63 chars, lowercase alphanumeric, hyphens allowed)"
        }
    )
    public: bool = Field(default=False, strict=True, examples=[False, True])
    
    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        return validate_bucket_name(v)
    
    model_config = ConfigDict(
        extra='forbid',
        json_schema_extra={
            "examples": [
                {"name": "my-bucket", "public": False},
                {"name": "public-files", "public": True}
            ]
        }
    )

# ─────────────────────────────────────────────────────────────────────────────
# 2. Update Model
# ─────────────────────────────────────────────────────────────────────────────
class BucketUpdate(BaseModel):
    public: Optional[bool] = Field(None, strict=True)
    
    model_config = ConfigDict(extra='forbid')

# ─────────────────────────────────────────────────────────────────────────────
# 3. Response Model
# ─────────────────────────────────────────────────────────────────────────────
class BucketResponse(BaseModel):
    name: str
    public: bool
    created_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)

# ─────────────────────────────────────────────────────────────────────────────
# 4. Database Model
# ─────────────────────────────────────────────────────────────────────────────
class BucketInDB(BaseModel):
    id: UUID
    name: str
    owner_id: Optional[UUID] = None
    public: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
