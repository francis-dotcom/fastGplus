# file.py - Backend models for Storage Files
# Compatible with: storage/models/file.py, frontend fileService.ts

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID


# ─────────────────────────────────────────────────────────────────────────────
# Response
# ─────────────────────────────────────────────────────────────────────────────

class FileResponse(BaseModel):
    """Response model for file (matches frontend FileItem interface)."""
    id: UUID
    bucket_id: UUID
    name: str = Field(examples=["document.pdf", "photo.png"])
    path: str = Field(examples=["uploads/document.pdf", "images/photo.png"])
    size: int = Field(examples=[1024, 2048576])
    mime_type: str = Field(examples=["application/pdf", "image/png"])
    owner_id: Optional[UUID] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    checksum_sha256: Optional[str] = None
    version: int = 1
    is_latest: bool = True
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class FileListResponse(BaseModel):
    """Response model for listing files in a bucket."""
    files: List[FileResponse]
    total: int = 0
    bucket: str


# ─────────────────────────────────────────────────────────────────────────────
# Upload
# ─────────────────────────────────────────────────────────────────────────────

class FileUploadResponse(BaseModel):
    """Response model for file upload (matches frontend UploadResponse)."""
    success: bool = True
    bucket: str
    path: str
    size: int
    file_id: Optional[UUID] = None
    upload_time: Optional[float] = None
    url: Optional[str] = None
    # macOS-style rename info
    original_path: Optional[str] = None
    message: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────────────────────────────

class FileInDB(BaseModel):
    """Database model for file (maps to files table)."""
    id: UUID
    bucket_id: UUID
    name: str
    path: str
    size: int
    mime_type: str
    owner_id: Optional[UUID] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    checksum_sha256: Optional[str] = None
    version: int = 1
    is_latest: bool = True
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
