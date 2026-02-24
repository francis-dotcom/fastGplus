# functions.py
"""API endpoints for serverless function management (Admin only)."""

import uuid
import httpx
import os
from uuid import UUID
from typing import Annotated, Literal
from datetime import datetime, timezone
import psycopg
from psycopg.errors import UniqueViolation
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from models.function import (
    FunctionCreate,
    FunctionRead,
    FunctionUpdate,
    FunctionEnvVarsUpdate,
    FunctionListResponse,
    FunctionExecutionRead,
    FunctionExecutionListResponse,
    FunctionLogRead,
    FunctionLogListResponse,
    ExecutionResultRequest,
    FunctionInDB,
    DeploymentStatus,
)
from models.user import UserInDB
from db import get_db
from security import get_current_active_user
from utils.validation import validate_search_term, SEARCH_TERM_REGEX

router = APIRouter(prefix="/functions", tags=["functions"])

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

FUNCTIONS_HOST = os.environ.get("FUNCTIONS_HOST", "functions")
FUNCTIONS_INTERNAL_PORT = os.environ.get("FUNCTIONS_INTERNAL_PORT", "8090")
FUNCTIONS_URL = f"http://{FUNCTIONS_HOST}:{FUNCTIONS_INTERNAL_PORT}"

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
    406: {"model": ErrorResponse, "description": "Not Acceptable"},
    409: {"model": ErrorResponse, "description": "Conflict"},
}

# ─────────────────────────────────────────────────────────────────────────────
# Admin-Only Dependency
# ─────────────────────────────────────────────────────────────────────────────

def require_admin(current_user: UserInDB = Depends(get_current_active_user)) -> UserInDB:
    """Dependency that requires admin role."""
    if current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for function management"
        )
    return current_user


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


async def get_function_from_db(
    function_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db)
) -> FunctionInDB:
    """Dependency to fetch a function by ID."""
    result = await db.execute("SELECT * FROM functions WHERE id = %s", (function_id,))
    record = await result.fetchone()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Function not found")
    return FunctionInDB(**record)


# ─────────────────────────────────────────────────────────────────────────────
# Deno Runtime Communication
# ─────────────────────────────────────────────────────────────────────────────

async def deploy_to_deno(name: str, code: str, env_vars: dict | None = None) -> dict:
    """Deploy a function to the Deno runtime."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{FUNCTIONS_URL}/deploy",
                json={"functionName": name, "code": code, "env": env_vars or {}}
            )
            return response.json()
    except Exception as e:
        return {"success": False, "message": str(e)}


async def undeploy_from_deno(name: str) -> dict:
    """Remove a function from the Deno runtime."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(f"{FUNCTIONS_URL}/functions/{name}")
            return response.json()
    except Exception as e:
        return {"success": False, "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# CRUD Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/count",
    response_model=int,
    dependencies=[Depends(strict_query_params({"search"}))],
    responses=RESP_ERRORS,
    summary="Get Function Count",
    description="Get total number of functions, optionally filtered by search term. Admin only."
)
async def get_function_count(
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX, description="Search term for filtering by name or description")] = None,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin)
) -> int:
    """Get total number of functions, optionally filtered by search term."""
    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None
    
    if search:
        result = await db.execute(
            "SELECT COUNT(*) FROM functions WHERE name ILIKE %s OR description ILIKE %s",
            (search_pattern, search_pattern)
        )
    else:
        result = await db.execute("SELECT COUNT(*) FROM functions")
    
    row = await result.fetchone()
    return row['count'] if row else 0


@router.get(
    "/",
    response_model=FunctionListResponse,
    dependencies=[Depends(strict_query_params({"limit", "offset", "search", "sort_by", "sort_order"}))],
    responses=RESP_ERRORS,
    summary="List Functions",
    description="List all functions with pagination, search, and sorting. Admin only."
)
async def list_functions(
    limit: Annotated[int, Query(ge=1, le=100, description="Maximum functions to return")] = 20,
    offset: Annotated[int, Query(ge=0, description="Number of functions to skip")] = 0,
    search: Annotated[str | None, Query(max_length=100, pattern=SEARCH_TERM_REGEX, description="Search term for filtering by name or description")] = None,
    sort_by: Annotated[Literal["created_at", "updated_at", "name", "last_executed_at", "execution_count"], Query(description="Field to sort by")] = "created_at",
    sort_order: Annotated[Literal["asc", "desc"], Query(description="Sort order (ascending or descending)")] = "desc",
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionListResponse:
    """
    List all functions with pagination, search, and sorting (Admin only).
    
    - **search**: Filter by name or description (case-insensitive)
    - **sort_by**: Field to sort by (created_at, updated_at, name, last_executed_at, execution_count)
    - **sort_order**: Sort direction (asc or desc, default: desc)
    """
    search = validate_search_term(search)
    search_pattern = f"%{search}%" if search else None
    
    # Validate sort_by to prevent SQL injection
    valid_sort_columns = {"created_at", "updated_at", "name", "last_executed_at", "execution_count"}
    if sort_by not in valid_sort_columns:
        sort_by = "created_at"
    
    # Build query
    if search:
        # Get total count with search
        count_result = await db.execute(
            "SELECT COUNT(*) FROM functions WHERE name ILIKE %s OR description ILIKE %s",
            (search_pattern, search_pattern)
        )
        count_row = await count_result.fetchone()
        total = count_row['count'] if count_row else 0
        
        # Get paginated results with search
        query = f"""
            SELECT * FROM functions 
            WHERE name ILIKE %s OR description ILIKE %s
            ORDER BY {sort_by} {sort_order.upper()} NULLS LAST
            LIMIT %s OFFSET %s
        """
        result = await db.execute(query, (search_pattern, search_pattern, limit, offset))
    else:
        # Get total count
        count_result = await db.execute("SELECT COUNT(*) FROM functions")
        count_row = await count_result.fetchone()
        total = count_row['count'] if count_row else 0
        
        # Get paginated results
        query = f"""
            SELECT * FROM functions 
            ORDER BY {sort_by} {sort_order.upper()} NULLS LAST
            LIMIT %s OFFSET %s
        """
        result = await db.execute(query, (limit, offset))
    
    records = await result.fetchall()

    return FunctionListResponse(
        functions=[FunctionRead(**r) for r in records],
        total=total,
        limit=limit,
        offset=offset
    )


@router.post(
    "/",
    response_model=FunctionRead,
    status_code=status.HTTP_201_CREATED,
    responses=RESP_ERRORS,
    summary="Create Function",
    description="Create a new serverless function. Admin only."
)
async def create_function(
    function: FunctionCreate,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionRead:
    """Create a new function (Admin only)."""
    function_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    try:
        await db.execute(
            """
            INSERT INTO functions (
                id, name, code, description, timeout_seconds,
                env_vars, owner_id, is_active, deployment_status,
                version, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s
            )
            """,
            (
                function_id, function.name, function.code, function.description,
                function.timeout_seconds,
                psycopg.types.json.Json(function.env_vars or {}),
                current_user.id, True, DeploymentStatus.PENDING.value,
                1, now, now
            )
        )
        await db.commit()

        result = await db.execute("SELECT * FROM functions WHERE id = %s", (function_id,))
        record = await result.fetchone()
        return FunctionRead(**record)

    except UniqueViolation:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Function with name '{function.name}' already exists"
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get(
    "/{function_id:uuid}",
    response_model=FunctionRead,
    responses=RESP_ERRORS,
    summary="Get Function",
    description="Get a specific function by ID. Admin only."
)
async def get_function(
    function: FunctionInDB = Depends(get_function_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionRead:
    """Get a function by ID (Admin only)."""
    return FunctionRead(**function.model_dump())


@router.patch(
    "/{function_id:uuid}",
    response_model=FunctionRead,
    responses=RESP_ERRORS,
    summary="Update Function",
    description="Update an existing function. Admin only."
)
async def update_function(
    function_id: UUID,
    update: FunctionUpdate,
    db: psycopg.AsyncConnection = Depends(get_db),
    function_in_db: FunctionInDB = Depends(get_function_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionRead:
    """Update an existing function (Admin only).
    
    Updatable fields: name, description, code, timeout_seconds, is_active, env_vars
    """
    update_data = update.model_dump(exclude_unset=True)
    update_data = {k: v for k, v in update_data.items() if v is not None}

    if not update_data:
        return FunctionRead(**function_in_db.model_dump())

    set_clauses = []
    values = []
    
    for field, value in update_data.items():
        if field == 'env_vars':
            # Handle env_vars as JSON
            set_clauses.append(f"{field} = %s")
            values.append(psycopg.types.json.Json(value))
        else:
            set_clauses.append(f"{field} = %s")
            values.append(value)

    # Increment version if code is updated
    if 'code' in update_data:
        set_clauses.append("version = version + 1")
        # Reset deployment status when code changes
        set_clauses.append("deployment_status = %s")
        values.append(DeploymentStatus.PENDING.value)

    set_clauses.append("updated_at = %s")
    values.append(datetime.now(timezone.utc))
    values.append(function_id)

    query = f"UPDATE functions SET {', '.join(set_clauses)} WHERE id = %s RETURNING *"

    try:
        result = await db.execute(query, tuple(values))
        record = await result.fetchone()
        await db.commit()
        return FunctionRead(**record)
    except UniqueViolation:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Function with name '{update_data.get('name')}' already exists"
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete(
    "/{function_id:uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Delete Function",
    description="Delete a function. Admin only."
)
async def delete_function(
    function_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    function_in_db: FunctionInDB = Depends(get_function_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> None:
    """Delete a function (Admin only)."""
    # Undeploy from Deno runtime
    await undeploy_from_deno(function_in_db.name)

    await db.execute("DELETE FROM functions WHERE id = %s", (function_id,))
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Deployment Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/{function_id:uuid}/deploy",
    response_model=FunctionRead,
    responses=RESP_ERRORS,
    summary="Deploy Function",
    description="Deploy or redeploy a function to the Deno runtime. Admin only."
)
async def deploy_function(
    function_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    function_in_db: FunctionInDB = Depends(get_function_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionRead:
    """Deploy a function to the Deno runtime (Admin only)."""
    deploy_result = await deploy_to_deno(
        function_in_db.name,
        function_in_db.code,
        function_in_db.env_vars
    )

    now = datetime.now(timezone.utc)
    if deploy_result.get("success"):
        await db.execute(
            "UPDATE functions SET deployment_status = %s, deployment_error = NULL, last_deployed_at = %s, updated_at = %s WHERE id = %s",
            (DeploymentStatus.DEPLOYED.value, now, now, function_id)
        )
    else:
        await db.execute(
            "UPDATE functions SET deployment_status = %s, deployment_error = %s, updated_at = %s WHERE id = %s",
            (DeploymentStatus.FAILED.value, deploy_result.get("message", "Unknown error"), now, function_id)
        )
    await db.commit()

    result = await db.execute("SELECT * FROM functions WHERE id = %s", (function_id,))
    record = await result.fetchone()
    return FunctionRead(**record)


@router.put(
    "/{function_id:uuid}/env",
    response_model=FunctionRead,
    responses=RESP_ERRORS,
    summary="Update Environment Variables",
    description="Update environment variables for a function. Admin only."
)
async def update_function_env_vars(
    function_id: UUID,
    env_update: FunctionEnvVarsUpdate,
    db: psycopg.AsyncConnection = Depends(get_db),
    function_in_db: FunctionInDB = Depends(get_function_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionRead:
    """Update function environment variables (Admin only)."""
    now = datetime.now(timezone.utc)
    await db.execute(
        "UPDATE functions SET env_vars = %s, updated_at = %s WHERE id = %s",
        (psycopg.types.json.Json(env_update.env_vars), now, function_id)
    )
    await db.commit()

    result = await db.execute("SELECT * FROM functions WHERE id = %s", (function_id,))
    record = await result.fetchone()
    return FunctionRead(**record)


# ─────────────────────────────────────────────────────────────────────────────
# Execution Result Callback Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/{function_name}/execution-result",
    status_code=status.HTTP_200_OK,
    responses=RESP_ERRORS,
    summary="Receive Execution Result",
    description="Internal endpoint to receive execution results from Deno runtime."
)
async def receive_execution_result(
    function_name: str,
    result: ExecutionResultRequest,
    db: psycopg.AsyncConnection = Depends(get_db)
) -> dict:
    """Receive execution result from Deno runtime (Internal)."""
    # Validate function_name to prevent NUL bytes and invalid characters
    if not function_name or len(function_name) > 255:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Function not found"
        )
    
    # Check for NUL bytes or non-ASCII characters
    try:
        if '\x00' in function_name or not function_name.isascii():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Function not found"
            )
    except (UnicodeDecodeError, UnicodeEncodeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Function not found"
        )

    try:
        # Find the function by name (including owner_id for execution tracking)
        fn_result = await db.execute(
            "SELECT id, owner_id, execution_count, execution_success_count, execution_error_count, avg_execution_time_ms FROM functions WHERE name = %s",
            (function_name,)
        )
        fn_record = await fn_result.fetchone()

        if not fn_record:
            return {"received": True, "warning": "Function not found"}

        function_id = fn_record['id']
        owner_id = fn_record['owner_id']
        now = datetime.now(timezone.utc)

        # Update function execution metrics
        new_count = fn_record['execution_count'] + 1
        new_success = fn_record['execution_success_count'] + (1 if result.success else 0)
        new_error = fn_record['execution_error_count'] + (0 if result.success else 1)

        old_avg = fn_record['avg_execution_time_ms'] or 0
        if old_avg == 0:
            new_avg = int(result.execution_time_ms)
        else:
            total_time = old_avg * fn_record['execution_count']
            new_avg = int((total_time + result.execution_time_ms) / new_count)

        await db.execute(
            """
            UPDATE functions SET
                execution_count = %s,
                execution_success_count = %s,
                execution_error_count = %s,
                avg_execution_time_ms = %s,
                last_executed_at = %s
            WHERE id = %s
            """,
            (new_count, new_success, new_error, new_avg, now, function_id)
        )

        # Create execution record
        execution_id = uuid.uuid4()
        await db.execute(
            """
            INSERT INTO function_executions (
                id, function_id, user_id, trigger_type, status,
                started_at, completed_at, duration_ms, result, error_message,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s
            )
            """,
            (
                execution_id, function_id, owner_id,
                'webhook' if result.delivery_id else 'http',
                'completed' if result.success else 'failed',
                now, now, int(result.execution_time_ms),
                psycopg.types.json.Json(result.result) if result.result else None,
                None if result.success else str(result.result),
                now, now
            )
        )

        # Store logs
        for log in result.logs:
            log_level = 'info'
            if log.startswith('[ERROR]'):
                log_level = 'error'
            elif log.startswith('[WARN]'):
                log_level = 'warn'

            await db.execute(
                """
                INSERT INTO function_logs (id, execution_id, function_id, log_level, message, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (uuid.uuid4(), execution_id, function_id, log_level, log, now)
            )

        await db.commit()
        return {"received": True, "execution_id": str(execution_id)}

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to process execution result: {str(e)}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Execution History Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{function_id:uuid}/executions",
    response_model=FunctionExecutionListResponse,
    dependencies=[Depends(strict_query_params({"limit", "offset"}))],
    responses=RESP_ERRORS,
    summary="List Function Executions",
    description="Get execution history for a function. Admin only."
)
async def list_function_executions(
    function_id: UUID,
    limit: Annotated[int, Query(ge=1, le=100, description="Maximum executions to return")] = 20,
    offset: Annotated[int, Query(ge=0, description="Number of executions to skip")] = 0,
    db: psycopg.AsyncConnection = Depends(get_db),
    function_in_db: FunctionInDB = Depends(get_function_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionExecutionListResponse:
    """List executions for a function (Admin only)."""
    count_result = await db.execute(
        "SELECT COUNT(*) FROM function_executions WHERE function_id = %s",
        (function_id,)
    )
    count_row = await count_result.fetchone()
    total = count_row['count'] if count_row else 0

    result = await db.execute(
        """
        SELECT * FROM function_executions
        WHERE function_id = %s
        ORDER BY started_at DESC
        LIMIT %s OFFSET %s
        """,
        (function_id, limit, offset)
    )
    records = await result.fetchall()

    return FunctionExecutionListResponse(
        executions=[FunctionExecutionRead(**r) for r in records],
        total=total,
        limit=limit,
        offset=offset
    )


@router.get(
    "/{function_id:uuid}/logs",
    response_model=FunctionLogListResponse,
    dependencies=[Depends(strict_query_params({"limit", "offset", "level"}))],
    responses=RESP_ERRORS,
    summary="List Function Logs",
    description="Get logs for a function. Admin only."
)
async def list_function_logs(
    function_id: UUID,
    limit: Annotated[int, Query(ge=1, le=500, description="Maximum logs to return")] = 100,
    offset: Annotated[int, Query(ge=0, description="Number of logs to skip")] = 0,
    level: Annotated[str | None, Query(description="Filter by log level")] = None,
    db: psycopg.AsyncConnection = Depends(get_db),
    function_in_db: FunctionInDB = Depends(get_function_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> FunctionLogListResponse:
    """List logs for a function (Admin only)."""
    if level:
        count_result = await db.execute(
            "SELECT COUNT(*) FROM function_logs WHERE function_id = %s AND log_level = %s",
            (function_id, level)
        )
    else:
        count_result = await db.execute(
            "SELECT COUNT(*) FROM function_logs WHERE function_id = %s",
            (function_id,)
        )
    count_row = await count_result.fetchone()
    total = count_row['count'] if count_row else 0

    if level:
        result = await db.execute(
            """
            SELECT * FROM function_logs
            WHERE function_id = %s AND log_level = %s
            ORDER BY timestamp DESC
            LIMIT %s OFFSET %s
            """,
            (function_id, level, limit, offset)
        )
    else:
        result = await db.execute(
            """
            SELECT * FROM function_logs
            WHERE function_id = %s
            ORDER BY timestamp DESC
            LIMIT %s OFFSET %s
            """,
            (function_id, limit, offset)
        )
    records = await result.fetchall()

    return FunctionLogListResponse(
        logs=[FunctionLogRead(**r) for r in records],
        total=total,
        limit=limit,
        offset=offset
    )
