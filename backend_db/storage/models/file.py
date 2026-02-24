from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# 1. File Metadata
# ─────────────────────────────────────────────────────────────────────────────
class FileMetadata(BaseModel):
    name: str = Field(examples=["document.pdf", "image.png"])
    path: str = Field(examples=["uploads/document.pdf", "images/photo.png"])
    size: int = Field(examples=[1024, 2048576])
    content_type: str = Field(examples=["application/pdf", "image/png"])
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "examples": [
                {
                    "name": "document.pdf",
                    "path": "uploads/document.pdf",
                    "size": 1024,
                    "content_type": "application/pdf",
                    "created_at": "2024-01-01T00:00:00Z"
                }
            ]
        }
    )

# ─────────────────────────────────────────────────────────────────────────────
# 2. Upload Response
# ─────────────────────────────────────────────────────────────────────────────
class FileUploadResponse(BaseModel):
    success: bool = Field(default=True, examples=[True])
    file: FileMetadata
