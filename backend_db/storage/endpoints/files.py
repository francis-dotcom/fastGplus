# files.py
import os
import mimetypes
from pathlib import Path
from typing import Annotated, Optional
from datetime import datetime, timezone
import aiofiles
import aiofiles.os
import aiofiles.tempfile
from fastapi import APIRouter, HTTPException, UploadFile, File, Path as PathParam, Header, Request, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from models.file import FileMetadata, FileUploadResponse
from models.bucket import BUCKET_NAME_PATTERN

router = APIRouter(prefix="/files", tags=["files"])

# Storage base path
BASE_PATH = Path(os.getenv("STORAGE_PATH", "./data"))

# Chunk size for streaming operations - larger chunks = fewer syscalls = faster I/O
CHUNK_SIZE = 256 * 1024  # 256KB chunks for optimal throughput

# Threshold for using memory buffering vs direct disk writes
# Files smaller than this stay in memory (SpooledTemporaryFile behavior)
MEMORY_THRESHOLD = 1024 * 1024  # 1MB

# ─────────────────────────────────────────────────────────────────────────────
# Documentation & Error Helpers
# ─────────────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str

RESP_ERRORS = {  
    400: {"model": ErrorResponse, "description": "Bad Request"},  
    404: {"model": ErrorResponse, "description": "Not Found"},  
    422: {"model": ErrorResponse, "description": "Validation Error"},
}

def safe_join(base: Path, *parts: str) -> Path:
    """Safely join paths, preventing directory traversal."""
    result = base
    for part in parts:
        result = result / part
    result = result.resolve()
    if not str(result).startswith(str(base.resolve())):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    return result

# ─────────────────────────────────────────────────────────────────────────────
# UPLOAD FILE (Streaming - accepts raw bytes or multipart form)
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/{bucket}/{path:path}",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
    responses=RESP_ERRORS,
    summary="Upload File"
)
async def upload_file(
    request: Request,
    bucket: Annotated[str, PathParam(
        min_length=3, 
        max_length=63, 
        pattern=BUCKET_NAME_PATTERN,
        examples=["my-bucket", "test-storage"]
    )],
    path: Annotated[str, PathParam(examples=["document.pdf", "images/photo.png"])],
    content_type: Annotated[Optional[str], Header(alias="Content-Type")] = None,
    x_filename: Annotated[Optional[str], Header(alias="X-Filename")] = None,
    content_length: Annotated[Optional[int], Header(alias="Content-Length")] = None,
) -> FileUploadResponse:
    """Upload a file to a bucket using async streaming with atomic write.
    
    Supports two modes:
    1. Raw bytes streaming: Send raw file bytes with Content-Type header for MIME type
       and optional X-Filename header for original filename
    2. Multipart form: Traditional file upload using multipart/form-data
    
    Performance optimizations:
    - Async file I/O via aiofiles (non-blocking)
    - Larger chunk sizes (256KB) for fewer syscalls
    - Atomic rename for multi-worker safety
    """
    bucket_path = BASE_PATH / bucket
    if not bucket_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
    
    file_path = safe_join(bucket_path, path)
    
    # Create parent directories if needed (async)
    await aiofiles.os.makedirs(file_path.parent, exist_ok=True)
    
    total_size = 0
    tmp_path = None
    
    # Determine if this is a multipart form upload or raw bytes
    request_content_type = content_type or request.headers.get("content-type", "")
    is_multipart = "multipart/form-data" in request_content_type
    
    try:
        # Create temp file using aiofiles for async I/O
        # Using same directory ensures atomic rename works (same filesystem)
        async with aiofiles.tempfile.NamedTemporaryFile(
            dir=str(file_path.parent),
            delete=False,
            suffix='.tmp'
        ) as tmp:
            tmp_path = Path(tmp.name)
            
            if is_multipart:
                # Handle multipart form upload (legacy compatibility)
                form = await request.form()
                file = form.get("file")
                if file is None or not hasattr(file, 'read'):
                    await aiofiles.os.unlink(str(tmp_path))
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, 
                        detail="No file provided in multipart form"
                    )
                while chunk := await file.read(CHUNK_SIZE):
                    await tmp.write(chunk)
                    total_size += len(chunk)
                # Get content type from uploaded file
                actual_content_type = file.content_type or mimetypes.guess_type(path)[0] or "application/octet-stream"
            else:
                # Handle raw bytes streaming (new streaming API) - fastest path
                async for chunk in request.stream():
                    await tmp.write(chunk)
                    total_size += len(chunk)
                # Get content type from header or guess from path
                actual_content_type = request_content_type if request_content_type and request_content_type != "application/octet-stream" else mimetypes.guess_type(path)[0] or "application/octet-stream"
        
        # Validate file is not empty
        if total_size == 0:
            await aiofiles.os.unlink(str(tmp_path))
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, 
                detail="File cannot be empty"
            )
        
        # Atomic rename - safe even with multiple workers (async)
        # os.replace is atomic on POSIX systems when src and dst are on same filesystem
        await aiofiles.os.replace(str(tmp_path), str(file_path))
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Clean up temp file on any error
        if tmp_path:
            try:
                await aiofiles.os.unlink(str(tmp_path))
            except FileNotFoundError:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}"
        )
    
    return FileUploadResponse(
        file=FileMetadata(
            name=file_path.name,
            path=path,
            size=total_size,
            content_type=actual_content_type,
            created_at=datetime.now(timezone.utc)
        )
    )

# ─────────────────────────────────────────────────────────────────────────────
# DOWNLOAD FILE
# ─────────────────────────────────────────────────────────────────────────────

async def async_file_iterator(file_path: Path, chunk_size: int = CHUNK_SIZE):
    """Async generator that streams file content in chunks."""
    async with aiofiles.open(file_path, mode='rb') as f:
        while chunk := await f.read(chunk_size):
            yield chunk


@router.get(
    "/{bucket}/{path:path}",
    responses={
        200: {
            "description": "File content",
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                },
                "text/plain": {
                    "schema": {"type": "string"}
                },
                "*/*": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        },
        **RESP_ERRORS
    },
    summary="Download File"
)
async def download_file(
    bucket: Annotated[str, PathParam(
        min_length=3, 
        max_length=63, 
        pattern=BUCKET_NAME_PATTERN,
        examples=["my-bucket", "test-storage"]
    )],
    path: Annotated[str, PathParam(examples=["document.pdf", "images/photo.png"])]
):
    """Download a file from a bucket using async streaming.
    
    Performance optimizations:
    - Async file I/O via aiofiles for non-blocking reads
    - StreamingResponse for memory-efficient large file transfers
    - Proper Content-Length header for progress indication
    """
    bucket_path = BASE_PATH / bucket
    if not bucket_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
    
    file_path = safe_join(bucket_path, path)
    
    # Check if file exists (async)
    if not await aiofiles.os.path.exists(str(file_path)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    
    try:
        # Get file stats for Content-Length header
        stat_result = await aiofiles.os.stat(str(file_path))
        file_size = stat_result.st_size
        
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        
        # Use StreamingResponse with async generator for memory efficiency
        headers = {
            "Content-Disposition": f'attachment; filename="{file_path.name}"',
            "Content-Length": str(file_size),
        }
        
        return StreamingResponse(
            async_file_iterator(file_path),
            media_type=content_type,
            headers=headers
        )
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

# ─────────────────────────────────────────────────────────────────────────────
# DELETE FILE
# ─────────────────────────────────────────────────────────────────────────────

@router.delete(
    "/{bucket}/{path:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Delete File"
)
async def delete_file(
    bucket: Annotated[str, PathParam(
        min_length=3, 
        max_length=63, 
        pattern=BUCKET_NAME_PATTERN,
        examples=["my-bucket", "test-storage"]
    )],
    path: Annotated[str, PathParam(examples=["document.pdf", "images/photo.png"])]
):
    """Delete a file from a bucket."""
    bucket_path = BASE_PATH / bucket
    if not bucket_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
    
    file_path = safe_join(bucket_path, path)
    
    # Use async unlink for non-blocking delete (multi-worker safe)
    # If file doesn't exist (already deleted by another worker), succeed silently
    try:
        await aiofiles.os.unlink(str(file_path))
    except FileNotFoundError:
        # File may have been deleted by another worker - that's OK for DELETE semantics
        # (idempotent: delete of non-existent file succeeds)
        pass
