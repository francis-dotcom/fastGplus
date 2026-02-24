# files.py - Backend File Endpoints with Public/Private Access Control
# Metadata stored in PostgreSQL, blob operations proxied to storage service

from uuid import UUID
import uuid
import re
from typing import List, Annotated, Optional, Literal, Dict, Any
from datetime import datetime, timezone
import psycopg
from psycopg import sql
from psycopg.types.json import Json
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form, Path, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models.file import FileResponse, FileListResponse, FileUploadResponse, FileInDB
from models.bucket import BucketInDB
from db import get_db
from security import get_current_active_user, get_optional_current_user
from models.user import UserInDB
from utils.validation import validate_search_term, SEARCH_TERM_REGEX
import storage_client

router = APIRouter(prefix="/storage/files", tags=["storage-files"])


# ─────────────────────────────────────────────────────────────────────────────
# Documentation & Error Helpers
# ─────────────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str


class FileDataResponse(BaseModel):
    """Response model for file listing with metadata."""
    files: List[FileResponse]
    total: int
    page: int
    page_size: int


RESP_ERRORS = {
    400: {"model": ErrorResponse, "description": "Bad Request"},
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not Found"},
    405: {"model": ErrorResponse, "description": "Method Not Allowed"},
    406: {"model": ErrorResponse, "description": "Not Acceptable (Missing API Key)"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    413: {"model": ErrorResponse, "description": "File Too Large"},
    500: {"model": ErrorResponse, "description": "Internal Server Error"},
}


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def strip_name(name: str) -> str:
    """Strip leading and trailing whitespace from a name."""
    return name.strip() if name else name


def strict_query_params(allowed: set[str]):
    """Validates query parameters."""
    def dependency(request: Request):
        unknown = [k for k in request.query_params.keys() if k not in allowed]
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown query parameters: {', '.join(unknown)}"
            )
        return True
    return dependency


async def get_bucket_from_db(
    bucket_id: UUID,
    db: psycopg.AsyncConnection
) -> BucketInDB:
    """Get bucket from database by ID."""
    result = await db.execute("SELECT * FROM buckets WHERE id = %s", (bucket_id,))
    record = await result.fetchone()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
    return BucketInDB(**record)


async def get_bucket_by_name(
    bucket_name: str,
    db: psycopg.AsyncConnection
) -> BucketInDB | None:
    """Get bucket from database by name."""
    result = await db.execute("SELECT * FROM buckets WHERE name = %s", (bucket_name,))
    record = await result.fetchone()
    return BucketInDB(**record) if record else None


async def get_file_from_db(
    file_id: UUID,
    db: psycopg.AsyncConnection
) -> FileInDB:
    """Get file from database by ID."""
    result = await db.execute("SELECT * FROM files WHERE id = %s", (file_id,))
    record = await result.fetchone()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return FileInDB(**record)


async def check_bucket_access(
    bucket: BucketInDB,
    current_user: UserInDB | None,
    require_write: bool = False
) -> None:
    """
    Check if user has access to the bucket.
    - Public buckets: Anyone can read, anyone can write
    - Private buckets: Any authenticated user can read/write
    """
    if bucket.public:
        return  # Public buckets allow access to anyone

    # Private buckets require authentication (any authenticated user can access)
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )


# ─────────────────────────────────────────────────────────────────────────────
# macOS-style Duplicate Filename Handling
# ─────────────────────────────────────────────────────────────────────────────

async def find_next_available_filename(
    bucket_id: UUID,
    original_path: str,
    db: psycopg.AsyncConnection
) -> str:
    """
    Find the next available filename using macOS-style auto-increment.
    Examples: 'doc.pdf' → 'doc (1).pdf' if 'doc.pdf' exists.
    """
    # Check if file exists
    result = await db.execute(
        "SELECT id FROM files WHERE bucket_id = %s AND path = %s AND is_latest = TRUE AND deleted_at IS NULL",
        (bucket_id, original_path)
    )
    if not await result.fetchone():
        return original_path  # File doesn't exist, use original path

    # Parse path: extract directory, base name, and extension
    path_parts = original_path.rsplit('/', 1)
    if len(path_parts) == 2:
        directory, filename = path_parts[0] + '/', path_parts[1]
    else:
        directory, filename = '', original_path

    # Split filename into base and extension
    if '.' in filename:
        base_name, ext = filename.rsplit('.', 1)
        ext = f'.{ext}'
    else:
        base_name, ext = filename, ''

    # Get files in same directory with similar names
    pattern = f"{directory}{base_name}%{ext}"
    result = await db.execute(
        "SELECT path FROM files WHERE bucket_id = %s AND path LIKE %s AND is_latest = TRUE AND deleted_at IS NULL",
        (bucket_id, pattern)
    )
    existing_files = [row['path'] for row in await result.fetchall()]

    # Extract used numbers from matching filenames
    name_pattern = re.compile(
        re.escape(f"{directory}{base_name}") + r'(?:\s*\((\d+)\))?' + re.escape(ext) + r'$'
    )
    used_numbers = set()
    for f in existing_files:
        match = name_pattern.match(f)
        if match:
            num = match.group(1)
            used_numbers.add(int(num) if num else 0)

    # Find next available number (0 = original file, so start from 1)
    next_num = 1
    while next_num in used_numbers:
        next_num += 1

    return f"{directory}{base_name} ({next_num}){ext}"


# ─────────────────────────────────────────────────────────────────────────────
# STORAGE STATS ENDPOINT (Total files and storage across all buckets)
# ─────────────────────────────────────────────────────────────────────────────

class StorageStatsResponse(BaseModel):
    """Response model for storage statistics."""
    total_files: int
    total_size: int
    bucket_count: int


@router.get(
    "/stats",
    response_model=StorageStatsResponse,
    dependencies=[Depends(strict_query_params({"search"}))],
    responses=RESP_ERRORS,
    summary="Get Storage Stats"
)
async def get_storage_stats(
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX, description="Search term for filtering")] = None,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
) -> StorageStatsResponse:
    """
    Get total storage statistics across all accessible buckets.
    
    Returns:
    - total_files: Total number of files across all accessible buckets
    - total_size: Total storage size in bytes
    - bucket_count: Number of accessible buckets
    """
    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None

    if current_user is None:
        # Unauthenticated - only public buckets
        if search:
            result = await db.execute(
                """SELECT 
                    COALESCE(SUM(file_count), 0) as total_files,
                    COALESCE(SUM(total_size), 0) as total_size,
                    COUNT(*) as bucket_count
                FROM buckets 
                WHERE public = TRUE AND (name ILIKE %s OR description ILIKE %s)""",
                (search_pattern, search_pattern)
            )
        else:
            result = await db.execute(
                """SELECT 
                    COALESCE(SUM(file_count), 0) as total_files,
                    COALESCE(SUM(total_size), 0) as total_size,
                    COUNT(*) as bucket_count
                FROM buckets 
                WHERE public = TRUE"""
            )
    else:
        # Authenticated users see ALL buckets
        if search:
            result = await db.execute(
                """SELECT 
                    COALESCE(SUM(file_count), 0) as total_files,
                    COALESCE(SUM(total_size), 0) as total_size,
                    COUNT(*) as bucket_count
                FROM buckets 
                WHERE (name ILIKE %s OR description ILIKE %s)""",
                (search_pattern, search_pattern)
            )
        else:
            result = await db.execute(
                """SELECT 
                    COALESCE(SUM(file_count), 0) as total_files,
                    COALESCE(SUM(total_size), 0) as total_size,
                    COUNT(*) as bucket_count
                FROM buckets"""
            )

    row = await result.fetchone()
    return StorageStatsResponse(
        total_files=row['total_files'] if row else 0,
        total_size=row['total_size'] if row else 0,
        bucket_count=row['bucket_count'] if row else 0
    )


# ─────────────────────────────────────────────────────────────────────────────
# TOTAL FILE COUNT ENDPOINT (across all accessible buckets)
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/total-count",
    response_model=int,
    dependencies=[Depends(strict_query_params({"search"}))],
    responses=RESP_ERRORS,
    summary="Get Total File Count"
)
async def get_total_file_count(
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX, description="Search term for filtering by name or path")] = None,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
) -> int:
    """
    Get total number of files across all accessible buckets.
    
    - For unauthenticated users: Files in public buckets only
    - For authenticated users: Files in all buckets
    """
    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None

    if current_user is None:
        # Unauthenticated - only files in public buckets
        if search:
            result = await db.execute(
                """SELECT COUNT(*) FROM files f
                   JOIN buckets b ON f.bucket_id = b.id
                   WHERE b.public = TRUE 
                   AND f.is_latest = TRUE AND f.deleted_at IS NULL
                   AND (f.name ILIKE %s OR f.path ILIKE %s)""",
                (search_pattern, search_pattern)
            )
        else:
            result = await db.execute(
                """SELECT COUNT(*) FROM files f
                   JOIN buckets b ON f.bucket_id = b.id
                   WHERE b.public = TRUE 
                   AND f.is_latest = TRUE AND f.deleted_at IS NULL"""
            )
    else:
        # Authenticated users - files in ALL buckets
        if search:
            result = await db.execute(
                """SELECT COUNT(*) FROM files f
                   WHERE f.is_latest = TRUE AND f.deleted_at IS NULL
                   AND (f.name ILIKE %s OR f.path ILIKE %s)""",
                (search_pattern, search_pattern)
            )
        else:
            result = await db.execute(
                """SELECT COUNT(*) FROM files f
                   WHERE f.is_latest = TRUE AND f.deleted_at IS NULL"""
            )

    row = await result.fetchone()
    return row['count'] if row else 0


# ─────────────────────────────────────────────────────────────────────────────
# FILE COUNT ENDPOINT (per bucket)
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/count",
    response_model=int,
    dependencies=[Depends(strict_query_params({"bucket_id", "search"}))],
    responses=RESP_ERRORS,
    summary="Get File Count"
)
async def get_file_count(
    bucket_id: Annotated[UUID, Query(description="Bucket ID to count files in")],
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX)] = None,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
) -> int:
    """Get total number of files in a bucket accessible to the user."""
    bucket = await get_bucket_from_db(bucket_id, db)
    await check_bucket_access(bucket, current_user)

    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None

    if search:
        result = await db.execute(
            """SELECT COUNT(*) FROM files 
               WHERE bucket_id = %s AND is_latest = TRUE AND deleted_at IS NULL 
               AND (name ILIKE %s OR path ILIKE %s)""",
            (bucket_id, search_pattern, search_pattern)
        )
    else:
        result = await db.execute(
            "SELECT COUNT(*) FROM files WHERE bucket_id = %s AND is_latest = TRUE AND deleted_at IS NULL",
            (bucket_id,)
        )

    row = await result.fetchone()
    return row['count'] if row else 0


# ─────────────────────────────────────────────────────────────────────────────
# FILE CRUD ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(strict_query_params({"bucket_id", "path", "filename", "content_type"}))],
    responses=RESP_ERRORS,
    summary="Upload File (Streaming)"
)
async def upload_file(
    request: Request,
    bucket_id: Annotated[UUID, Query(description="Target bucket ID")],
    filename: Annotated[str, Query(description="Original filename")],
    path: Annotated[Optional[str], Query(description="Target path within bucket")] = None,
    content_type: Annotated[str, Query(description="MIME type of the file")] = "application/octet-stream",
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
):
    """
    Upload a file to a bucket using true streaming (no memory buffering).
    
    The file content is streamed directly from the client to the storage service
    without being fully buffered in memory on the backend. This enables efficient
    handling of both small and large files.
    
    - Public buckets: Anyone can upload
    - Private buckets: Only owner or admin can upload
    
    Automatically renames duplicates using macOS-style increment (e.g., 'file (1).pdf').
    
    Request body should contain the raw file bytes (not multipart form data).
    Use Content-Length header for file size validation.
    """
    bucket = await get_bucket_from_db(bucket_id, db)
    
    # Public buckets allow uploads from anyone
    # Private buckets require authentication (any authenticated user can upload)
    if not bucket.public:
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required for private buckets"
            )

    # Determine the initial target path
    initial_path = strip_name(path or filename or "unnamed")

    # Find next available filename (macOS-style auto-increment)
    target_path = await find_next_available_filename(bucket_id, initial_path, db)
    file_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    
    # Get content length from header if available
    content_length = request.headers.get("content-length")
    content_length_int = int(content_length) if content_length else None

    try:
        # 1. Upload blob to storage service using streaming
        import time
        start_time = time.time()
        
        # Create async generator that streams request body directly
        async def stream_body():
            async for chunk in request.stream():
                yield chunk
        
        storage_result = await storage_client.upload_file_streaming(
            bucket=bucket.name,
            path=target_path,
            stream=stream_body(),
            filename=filename or "unnamed",
            content_type=content_type,
            content_length=content_length_int
        )
        
        upload_time = time.time() - start_time
        file_size = storage_result.get('file', {}).get('size', 0)

        # 2. Insert metadata into database
        await db.execute(
            """
            INSERT INTO files (id, bucket_id, name, path, size, mime_type, owner_id, metadata, version, is_latest, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                file_id,
                bucket_id,
                target_path.split('/')[-1],  # Extract filename from path
                target_path,
                file_size,
                content_type,
                current_user.id if current_user else None,
                Json({}),
                1,
                True,
                now,
                now
            )
        )

        # 3. Update bucket stats
        await db.execute(
            "UPDATE buckets SET file_count = file_count + 1, total_size = total_size + %s, updated_at = %s WHERE id = %s",
            (file_size, now, bucket_id)
        )
        await db.commit()

        response = FileUploadResponse(
            success=True,
            bucket=bucket.name,
            path=target_path,
            size=file_size,
            file_id=file_id,
            upload_time=upload_time,
            url=f"/api/storage/files/{bucket.name}/{target_path}"
        )

        # Include original path if file was auto-renamed
        if target_path != initial_path:
            response.original_path = initial_path
            response.message = f"File uploaded successfully (renamed from '{initial_path}' to avoid overwrite)"
        else:
            response.message = "File uploaded successfully"

        return response

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/",
    response_model=FileDataResponse,
    dependencies=[Depends(strict_query_params({"bucket_id", "page", "page_size", "search", "sort_by", "sort_order"}))],
    responses=RESP_ERRORS,
    summary="List Files"
)
async def list_files(
    bucket_id: Annotated[UUID, Query(description="Bucket ID to list files from")],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=1000)] = 100,
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX)] = None,
    sort_by: Annotated[Literal["created_at", "updated_at", "name", "size"], Query()] = "created_at",
    sort_order: Annotated[Literal["asc", "desc"], Query()] = "desc",
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
):
    """
    List files in a bucket with pagination, search, and sorting.
    
    - Public buckets: Accessible to anyone
    - Private buckets: Owner or admin only
    """
    bucket = await get_bucket_from_db(bucket_id, db)
    await check_bucket_access(bucket, current_user)

    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None
    offset = (page - 1) * page_size

    order_direction = sql.SQL("DESC") if sort_order == "desc" else sql.SQL("ASC")
    order_by = sql.SQL("ORDER BY {} {}").format(sql.Identifier(sort_by), order_direction)

    try:
        # Count query
        if search:
            count_result = await db.execute(
                """SELECT COUNT(*) FROM files 
                   WHERE bucket_id = %s AND is_latest = TRUE AND deleted_at IS NULL 
                   AND (name ILIKE %s OR path ILIKE %s)""",
                (bucket_id, search_pattern, search_pattern)
            )
        else:
            count_result = await db.execute(
                "SELECT COUNT(*) FROM files WHERE bucket_id = %s AND is_latest = TRUE AND deleted_at IS NULL",
                (bucket_id,)
            )
        count_row = await count_result.fetchone()
        total = count_row['count'] if count_row else 0

        # Data query
        if search:
            query = sql.SQL("""
                SELECT * FROM files 
                WHERE bucket_id = %s AND is_latest = TRUE AND deleted_at IS NULL 
                AND (name ILIKE %s OR path ILIKE %s)
                {} LIMIT %s OFFSET %s
            """).format(order_by)
            result = await db.execute(query, (bucket_id, search_pattern, search_pattern, page_size, offset))
        else:
            query = sql.SQL("""
                SELECT * FROM files 
                WHERE bucket_id = %s AND is_latest = TRUE AND deleted_at IS NULL
                {} LIMIT %s OFFSET %s
            """).format(order_by)
            result = await db.execute(query, (bucket_id, page_size, offset))

        records = await result.fetchall()
        files = [FileResponse(**record) for record in records]

        return FileDataResponse(
            files=files,
            total=total,
            page=page,
            page_size=page_size
        )

    except psycopg.errors.DataError:
        raise HTTPException(status_code=400, detail="Invalid offset or limit")


@router.get(
    "/{file_id:uuid}",
    response_model=FileResponse,
    responses=RESP_ERRORS,
    summary="Get File Metadata"
)
async def get_file_metadata(
    file_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
):
    """Get file metadata by ID."""
    file = await get_file_from_db(file_id, db)
    bucket = await get_bucket_from_db(file.bucket_id, db)
    await check_bucket_access(bucket, current_user)

    return FileResponse(
        id=file.id,
        bucket_id=file.bucket_id,
        name=file.name,
        path=file.path,
        size=file.size,
        mime_type=file.mime_type,
        owner_id=file.owner_id,
        metadata=file.metadata,
        checksum_sha256=file.checksum_sha256,
        version=file.version,
        is_latest=file.is_latest,
        deleted_at=file.deleted_at,
        created_at=file.created_at,
        updated_at=file.updated_at
    )


@router.get(
    "/download/{bucket_name}/{path:path}",
    responses={
        200: {
            "description": "File content",
            "content": {"*/*": {"schema": {"type": "string", "format": "binary"}}}
        },
        **RESP_ERRORS
    },
    summary="Download File"
)
async def download_file(
    bucket_name: Annotated[str, Path(min_length=3, max_length=63, pattern=r'^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$')],
    path: str,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
):
    """
    Download a file from storage.
    
    - Public buckets: Accessible to anyone
    - Private buckets: Owner or admin only
    """
    bucket = await get_bucket_by_name(bucket_name, db)
    if not bucket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")

    await check_bucket_access(bucket, current_user)

    # Verify file exists in database
    result = await db.execute(
        "SELECT * FROM files WHERE bucket_id = %s AND path = %s AND is_latest = TRUE AND deleted_at IS NULL",
        (bucket.id, path)
    )
    file_record = await result.fetchone()
    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    try:
        # Stream from storage service
        response = await storage_client.download_file(bucket_name, path)
        filename = path.split('/')[-1]

        async def stream_content():
            async for chunk in response.aiter_bytes():
                yield chunk

        return StreamingResponse(
            stream_content(),
            media_type=file_record['mime_type'],
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(file_record['size'])
            }
        )

    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage service unavailable")


@router.delete(
    "/{file_id:uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Delete File"
)
async def delete_file(
    file_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Delete a file.
    - Users can only delete files they own (owner_id = current_user.id)
    - Admin can delete any file
    """
    file = await get_file_from_db(file_id, db)
    bucket = await get_bucket_from_db(file.bucket_id, db)

    # Check file ownership (not bucket ownership)
    if current_user.role != "ADMIN" and file.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete files you own"
        )

    try:
        # 1. Delete blob from storage service
        await storage_client.delete_file(bucket.name, file.path)
    except Exception:
        pass  # Best effort - storage might already be deleted

    # 2. Delete from database
    await db.execute("DELETE FROM files WHERE id = %s", (file_id,))

    # 3. Update bucket stats
    await db.execute(
        "UPDATE buckets SET file_count = file_count - 1, total_size = total_size - %s, updated_at = %s WHERE id = %s",
        (file.size, datetime.now(timezone.utc), file.bucket_id)
    )
    await db.commit()


@router.patch(
    "/{file_id:uuid}",
    response_model=FileResponse,
    responses=RESP_ERRORS,
    summary="Update File Metadata"
)
async def update_file_metadata(
    file_id: UUID,
    metadata: Dict[str, Any],
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Update file metadata.
    - Users can only update files they own (owner_id = current_user.id)
    - Admin can update any file
    """
    file = await get_file_from_db(file_id, db)
    bucket = await get_bucket_from_db(file.bucket_id, db)

    # Check file ownership (not bucket ownership)
    if current_user.role != "ADMIN" and file.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only update files you own"
        )

    now = datetime.now(timezone.utc)
    result = await db.execute(
        "UPDATE files SET metadata = %s, updated_at = %s WHERE id = %s RETURNING *",
        (Json(metadata), now, file_id)
    )
    updated = await result.fetchone()
    await db.commit()

    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    return FileResponse(**updated)
