# buckets.py - Backend Bucket Endpoints with Public/Private Access Control
# Metadata stored in PostgreSQL, blob operations proxied to storage service

from uuid import UUID
import uuid
from typing import List, Annotated, Optional, Literal
from datetime import datetime, timezone
import psycopg
from pydantic import StrictBool
from psycopg import sql
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from models.bucket import (
    BucketCreate, BucketUpdate, BucketResponse, BucketInDB, BucketListResponse,
    BUCKET_NAME_PATTERN
)
from db import get_db
from security import get_current_active_user, get_optional_current_user
from models.user import UserInDB
from utils.validation import validate_search_term, SEARCH_TERM_REGEX
import storage_client

router = APIRouter(prefix="/storage/buckets", tags=["storage-buckets"])


# ─────────────────────────────────────────────────────────────────────────────
# Documentation & Error Helpers
# ─────────────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str


RESP_ERRORS = {
    400: {"model": ErrorResponse, "description": "Bad Request"},
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not Found"},
    405: {"model": ErrorResponse, "description": "Method Not Allowed"},
    406: {"model": ErrorResponse, "description": "Not Acceptable (Missing API Key)"},
    409: {"model": ErrorResponse, "description": "Conflict"},
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
    db: psycopg.AsyncConnection = Depends(get_db)
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


async def require_bucket_owner(
    bucket: BucketInDB = Depends(get_bucket_from_db),
    current_user: UserInDB = Depends(get_current_active_user)
) -> tuple[BucketInDB, UserInDB]:
    """Ensure current user owns the bucket or is admin."""
    if bucket.owner_id != current_user.id and current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only modify buckets you own"
        )
    return bucket, current_user


# ─────────────────────────────────────────────────────────────────────────────
# BUCKET COUNT ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/count",
    response_model=int,
    dependencies=[Depends(strict_query_params({"search"}))],
    responses=RESP_ERRORS,
    summary="Get Bucket Count"
)
async def get_bucket_count(
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX)] = None,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
) -> int:
    """Get total number of buckets accessible to the user."""
    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None

    if current_user is None:
        if search:
            result = await db.execute(
                "SELECT COUNT(*) FROM buckets WHERE public = TRUE AND (name ILIKE %s OR description ILIKE %s)",
                (search_pattern, search_pattern)
            )
        else:
            result = await db.execute("SELECT COUNT(*) FROM buckets WHERE public = TRUE")
    else:
        if search:
            result = await db.execute(
                "SELECT COUNT(*) FROM buckets WHERE (public = TRUE OR owner_id = %s) AND (name ILIKE %s OR description ILIKE %s)",
                (current_user.id, search_pattern, search_pattern)
            )
        else:
            result = await db.execute(
                "SELECT COUNT(*) FROM buckets WHERE public = TRUE OR owner_id = %s",
                (current_user.id,)
            )

    row = await result.fetchone()
    return row['count'] if row else 0


# ─────────────────────────────────────────────────────────────────────────────
# BUCKET CRUD ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=BucketResponse,
    status_code=status.HTTP_201_CREATED,
    responses=RESP_ERRORS,
    summary="Create Bucket"
)
async def create_bucket(
    bucket: BucketCreate,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(get_current_active_user)
):
    """Create a new storage bucket. Requires authentication."""
    bucket_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    bucket_name = strip_name(bucket.name).lower()

    try:
        # 1. Create bucket directory in storage service
        await storage_client.create_bucket(bucket_name, bucket.public)

        # 2. Insert metadata into database
        await db.execute(
            """
            INSERT INTO buckets (id, name, public, description, owner_id, metadata, file_count, total_size, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                bucket_id,
                bucket_name,
                bucket.public,
                bucket.description,
                current_user.id,
                Json(bucket.metadata or {}),
                0,
                0,
                now,
                now
            )
        )
        await db.commit()

        return BucketResponse(
            id=bucket_id,
            name=bucket_name,
            public=bucket.public,
            description=bucket.description,
            file_count=0,
            total_size=0,
            owner_id=current_user.id,
            metadata=bucket.metadata or {},
            created_at=now,
            updated_at=now
        )

    except UniqueViolation:
        await db.rollback()
        # Idempotency: If exact bucket exists, return it
        existing = await get_bucket_by_name(bucket_name, db)
        if existing:
            return BucketResponse(
                id=existing.id,
                name=existing.name,
                public=existing.public,
                description=existing.description,
                file_count=existing.file_count,
                total_size=existing.total_size,
                owner_id=existing.owner_id,
                metadata=existing.metadata,
                created_at=existing.created_at,
                updated_at=existing.updated_at
            )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bucket name already exists")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/",
    response_model=List[BucketResponse],
    dependencies=[Depends(strict_query_params({"skip", "limit", "search", "sort_by", "sort_order"}))],
    responses=RESP_ERRORS,
    summary="List Buckets"
)
async def list_buckets(
    skip: Annotated[int, Query(ge=0, le=2147483647)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX)] = None,
    sort_by: Annotated[Literal["created_at", "updated_at", "name"], Query()] = "created_at",
    sort_order: Annotated[Literal["asc", "desc"], Query()] = "desc",
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
):
    """
    List buckets with optional search and sorting.
    
    - For unauthenticated users: Only public buckets
    - For authenticated users: All buckets (public + private)
    """
    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None

    order_direction = sql.SQL("DESC") if sort_order == "desc" else sql.SQL("ASC")
    order_by = sql.SQL("ORDER BY {} {}").format(sql.Identifier(sort_by), order_direction)

    try:
        if current_user is None:
            if search:
                query = sql.SQL("""
                    SELECT * FROM buckets 
                    WHERE public = TRUE AND (name ILIKE %s OR description ILIKE %s)
                    {} LIMIT %s OFFSET %s
                """).format(order_by)
                result = await db.execute(query, (search_pattern, search_pattern, limit, skip))
            else:
                query = sql.SQL("SELECT * FROM buckets WHERE public = TRUE {} LIMIT %s OFFSET %s").format(order_by)
                result = await db.execute(query, (limit, skip))
        else:
            # Authenticated users see ALL buckets (public + private)
            if search:
                query = sql.SQL("""
                    SELECT * FROM buckets 
                    WHERE (name ILIKE %s OR description ILIKE %s)
                    {} LIMIT %s OFFSET %s
                """).format(order_by)
                result = await db.execute(query, (search_pattern, search_pattern, limit, skip))
            else:
                query = sql.SQL("SELECT * FROM buckets {} LIMIT %s OFFSET %s").format(order_by)
                result = await db.execute(query, (limit, skip))

        records = await result.fetchall()
        return [BucketResponse(**record) for record in records]
    except psycopg.errors.DataError:
        raise HTTPException(status_code=400, detail="Invalid offset or limit")


@router.get(
    "/{bucket_id:uuid}",
    response_model=BucketResponse,
    responses=RESP_ERRORS,
    summary="Get Bucket"
)
async def get_bucket(
    bucket: BucketInDB = Depends(get_bucket_from_db),
    current_user: UserInDB | None = Depends(get_optional_current_user)
):
    """
    Get a specific bucket by ID.
    - Public buckets: Accessible to anyone
    - Private buckets: Requires authentication (any authenticated user can access)
    """
    if bucket.public:
        return BucketResponse(
            id=bucket.id,
            name=bucket.name,
            public=bucket.public,
            description=bucket.description,
            file_count=bucket.file_count,
            total_size=bucket.total_size,
            owner_id=bucket.owner_id,
            metadata=bucket.metadata,
            created_at=bucket.created_at,
            updated_at=bucket.updated_at
        )

    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to access private buckets"
        )

    return BucketResponse(
        id=bucket.id,
        name=bucket.name,
        public=bucket.public,
        description=bucket.description,
        file_count=bucket.file_count,
        total_size=bucket.total_size,
        owner_id=bucket.owner_id,
        metadata=bucket.metadata,
        created_at=bucket.created_at,
        updated_at=bucket.updated_at
    )


@router.patch(
    "/{bucket_id:uuid}",
    response_model=BucketResponse,
    responses=RESP_ERRORS,
    summary="Update Bucket"
)
async def update_bucket(
    bucket_id: UUID,
    bucket_update: BucketUpdate,
    db: psycopg.AsyncConnection = Depends(get_db),
    owner_check: tuple[BucketInDB, UserInDB] = Depends(require_bucket_owner)
):
    """Update a bucket. Only the owner or admin can update."""
    bucket_in_db, _ = owner_check

    update_data = bucket_update.model_dump(exclude_unset=True)
    update_data = {k: v for k, v in update_data.items() if v is not None}

    if not update_data:
        return BucketResponse(
            id=bucket_in_db.id,
            name=bucket_in_db.name,
            public=bucket_in_db.public,
            description=bucket_in_db.description,
            file_count=bucket_in_db.file_count,
            total_size=bucket_in_db.total_size,
            owner_id=bucket_in_db.owner_id,
            metadata=bucket_in_db.metadata,
            created_at=bucket_in_db.created_at,
            updated_at=bucket_in_db.updated_at
        )

    # Sync public flag change to storage service
    if 'public' in update_data:
        try:
            await storage_client.update_bucket(bucket_in_db.name, public=update_data['public'])
        except Exception:
            pass  # Storage service update is best-effort for metadata

    update_data['updated_at'] = datetime.now(timezone.utc)

    set_clauses = []
    values = []
    for field, value in update_data.items():
        set_clauses.append(f"{field} = %s")
        if field == 'metadata':
            values.append(Json(value))
        else:
            values.append(value)

    values.append(bucket_id)
    query = f"UPDATE buckets SET {', '.join(set_clauses)} WHERE id = %s RETURNING *"

    try:
        result = await db.execute(query, tuple(values))
        updated_record = await result.fetchone()
        await db.commit()
        if not updated_record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
        return BucketResponse(**updated_record)
    except UniqueViolation:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bucket name already exists")


@router.delete(
    "/{bucket_id:uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Delete Bucket"
)
async def delete_bucket(
    bucket_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    owner_check: tuple[BucketInDB, UserInDB] = Depends(require_bucket_owner)
):
    """Delete a bucket and all files inside it. Only the owner or admin can delete."""
    bucket_in_db, _ = owner_check

    # 1. Get all files in the bucket
    files_result = await db.execute(
        "SELECT id, path, size FROM files WHERE bucket_id = %s",
        (bucket_id,)
    )
    files = await files_result.fetchall()

    # 2. Delete each file from storage service
    for file_record in files:
        try:
            await storage_client.delete_file(bucket_in_db.name, file_record['path'])
        except Exception:
            pass  # Best effort - storage might already be deleted

    # 3. Delete all files from database
    await db.execute("DELETE FROM files WHERE bucket_id = %s", (bucket_id,))

    # 4. Delete bucket from storage service
    try:
        await storage_client.delete_bucket(bucket_in_db.name)
    except Exception:
        pass  # Best effort - storage might already be deleted

    # 5. Delete bucket from database
    result = await db.execute("DELETE FROM buckets WHERE id = %s", (bucket_id,))
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")
