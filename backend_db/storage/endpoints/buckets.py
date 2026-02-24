# buckets.py
import os
import shutil
from pathlib import Path
from typing import List, Annotated
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query, Path as PathParam, status
from pydantic import BaseModel

from models.bucket import BucketCreate, BucketUpdate, BucketResponse, BUCKET_NAME_PATTERN

router = APIRouter(prefix="/buckets", tags=["buckets"])

# Storage base path
BASE_PATH = Path(os.getenv("STORAGE_PATH", "./data"))

# ─────────────────────────────────────────────────────────────────────────────
# Documentation & Error Helpers
# ─────────────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str

RESP_ERRORS = {  
    400: {"model": ErrorResponse, "description": "Bad Request"},  
    404: {"model": ErrorResponse, "description": "Not Found"},  
    409: {"model": ErrorResponse, "description": "Conflict"},  
    422: {"model": ErrorResponse, "description": "Validation Error"},
}

# ─────────────────────────────────────────────────────────────────────────────
# CREATE BUCKET
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "",
    response_model=BucketResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        **RESP_ERRORS,
        200: {"model": BucketResponse, "description": "Bucket with this name already exists (idempotent)"},
    },
    summary="Create Bucket",
    description="""
    Create a new storage bucket.
    
    **Idempotent**: If a bucket with the same name already exists, returns the existing bucket (200 OK).
    """
)
async def create_bucket(bucket: BucketCreate) -> BucketResponse:
    """Create a new storage bucket.
    
    Multi-worker safe: Uses exist_ok=True and handles race conditions gracefully.
    """
    bucket_path = BASE_PATH / bucket.name
    
    # Ensure base path exists (race-safe)
    BASE_PATH.mkdir(parents=True, exist_ok=True)
    
    try:
        # Try to create bucket directory
        # exist_ok=True handles race condition where another worker creates it first
        bucket_path.mkdir(parents=True, exist_ok=True)
    except OSError:
        # Handle any OS-level race condition
        pass
    
    # Check if bucket exists now (either we created it or another worker did)
    if bucket_path.exists():
        stat = bucket_path.stat()
        return BucketResponse(
            name=bucket.name,
            public=bucket.public,
            created_at=datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
        )
    
    # This shouldn't happen, but handle gracefully
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create bucket"
    )

# ─────────────────────────────────────────────────────────────────────────────
# LIST BUCKETS
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=List[BucketResponse],
    responses=RESP_ERRORS,
    summary="List Buckets"
)
async def list_buckets() -> List[BucketResponse]:
    """List all storage buckets.
    
    Multi-worker safe: Handles directories disappearing during iteration.
    """
    BASE_PATH.mkdir(parents=True, exist_ok=True)
    
    buckets = []
    try:
        for item in BASE_PATH.iterdir():
            try:
                # Check is_dir and get stat in try block - directory might be deleted
                # by another worker between iterdir() and stat()
                if item.is_dir():
                    stat = item.stat()
                    buckets.append(BucketResponse(
                        name=item.name,
                        public=False,
                        created_at=datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
                    ))
            except (FileNotFoundError, OSError):
                # Directory was deleted by another worker - skip it
                continue
    except (FileNotFoundError, OSError):
        # BASE_PATH was deleted/modified - return empty list
        pass
    
    return buckets

# ─────────────────────────────────────────────────────────────────────────────
# GET BUCKET
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{bucket}",
    response_model=BucketResponse,
    responses=RESP_ERRORS,
    summary="Get Bucket"
)
async def get_bucket(
    bucket: Annotated[str, PathParam(
        min_length=3, 
        max_length=63, 
        pattern=BUCKET_NAME_PATTERN,
        examples=["my-bucket", "test-storage", "media-files"]
    )]
) -> BucketResponse:
    """Get bucket details."""
    bucket_path = BASE_PATH / bucket
    
    if not bucket_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
    
    stat = bucket_path.stat()
    return BucketResponse(
        name=bucket,
        public=False,
        created_at=datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
    )

# ─────────────────────────────────────────────────────────────────────────────
# UPDATE BUCKET
# ─────────────────────────────────────────────────────────────────────────────

@router.put(
    "/{bucket}",
    response_model=BucketResponse,
    responses=RESP_ERRORS,
    summary="Update Bucket"
)
async def update_bucket(
    bucket: Annotated[str, PathParam(
        min_length=3, 
        max_length=63, 
        pattern=BUCKET_NAME_PATTERN,
        examples=["my-bucket", "test-storage", "media-files"]
    )],
    data: BucketUpdate
) -> BucketResponse:
    """Update bucket settings."""
    bucket_path = BASE_PATH / bucket
    
    if not bucket_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
    
    stat = bucket_path.stat()
    return BucketResponse(
        name=bucket,
        public=data.public if data.public is not None else False,
        created_at=datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
    )

# ─────────────────────────────────────────────────────────────────────────────
# DELETE BUCKET
# ─────────────────────────────────────────────────────────────────────────────

@router.delete(
    "/{bucket}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Delete Bucket"
)
async def delete_bucket(
    bucket: Annotated[str, PathParam(
        min_length=3, 
        max_length=63, 
        pattern=BUCKET_NAME_PATTERN,
        examples=["my-bucket", "test-storage", "media-files"]
    )]
):
    """Delete a bucket and all its contents.
    
    Multi-worker safe: Idempotent delete - succeeds even if already deleted.
    """
    bucket_path = BASE_PATH / bucket
    
    try:
        # shutil.rmtree with ignore_errors handles race conditions
        # where another worker deletes the bucket first
        if bucket_path.exists():
            shutil.rmtree(bucket_path, ignore_errors=True)
        
        # Verify deletion or check if another worker deleted it
        if bucket_path.exists():
            # Still exists - might be a permission issue
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete bucket"
            )
    except HTTPException:
        raise
    except Exception:
        # Any other error - bucket is gone or inaccessible, which is fine
        pass
    
    # Success - bucket is deleted (or was already deleted by another worker)
