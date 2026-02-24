# sql.py
"""SQL execution endpoints for SelfDB."""

import time
import re
import uuid
from uuid import UUID
from typing import List, Dict, Any, Annotated, Optional, Tuple
from datetime import datetime, timezone
import psycopg
from psycopg import sql as psycopg_sql
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from models.sql import (
    SqlQueryRequest,
    SqlExecutionResult,
    SqlHistoryRead,
    SqlHistoryListResponse,
    SqlSnippetCreate,
    SqlSnippetRead,
    SqlSnippetListResponse,
)
from models.user import UserInDB
from db import get_db
from security import get_current_active_user


# ─────────────────────────────────────────────────────────────────────────────
# CREATE TABLE Detection and Metadata Registration
# ─────────────────────────────────────────────────────────────────────────────

# System tables that should NOT be registered in the tables metadata
SYSTEM_TABLES = {
    'system_config', 'users', 'tables', 'sql_history', 'sql_snippets',
    'buckets', 'files', 'functions', 'function_executions', 'function_logs',
    'webhooks', 'webhook_deliveries', 'refresh_tokens',
    'pg_catalog', 'information_schema',
}

# PostgreSQL type mapping for schema extraction
PG_TYPE_MAPPING = {
    'text': 'TEXT',
    'varchar': 'TEXT',
    'character varying': 'TEXT',
    'char': 'TEXT',
    'character': 'TEXT',
    'int': 'INTEGER',
    'int4': 'INTEGER',
    'integer': 'INTEGER',
    'int8': 'BIGINT',
    'bigint': 'BIGINT',
    'smallint': 'INTEGER',
    'int2': 'INTEGER',
    'serial': 'INTEGER',
    'bigserial': 'BIGINT',
    'decimal': 'DECIMAL',
    'numeric': 'DECIMAL',
    'real': 'FLOAT',
    'float': 'FLOAT',
    'float4': 'FLOAT',
    'float8': 'FLOAT',
    'double precision': 'FLOAT',
    'boolean': 'BOOLEAN',
    'bool': 'BOOLEAN',
    'date': 'DATE',
    'time': 'TIMESTAMP',
    'timestamp': 'TIMESTAMP',
    'timestamp with time zone': 'TIMESTAMP',
    'timestamp without time zone': 'TIMESTAMP',
    'timestamptz': 'TIMESTAMP',
    'json': 'JSON',
    'jsonb': 'JSONB',
    'uuid': 'UUID',
    'bytea': 'TEXT',
}


def parse_create_table_statement(query: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """
    Parse a CREATE TABLE statement to extract table name and column definitions.
    
    Returns:
        Tuple of (table_name, schema_dict) if successful, None otherwise.
        schema_dict format: {column_name: {type: str, nullable: bool}}
    """
    # Match CREATE TABLE pattern (with optional IF NOT EXISTS)
    create_pattern = r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["\']?(\w+)["\']?\s*\((.*)\)'
    match = re.search(create_pattern, query, re.IGNORECASE | re.DOTALL)
    
    if not match:
        return None
    
    table_name = match.group(1).lower()
    columns_str = match.group(2)
    
    # Skip system tables
    if table_name in SYSTEM_TABLES:
        return None
    
    # Parse column definitions
    schema = {}
    
    # Split by commas, but be careful with complex types like DECIMAL(10,2)
    # and constraints like FOREIGN KEY(..., ...)
    columns = []
    paren_depth = 0
    current = ""
    
    for char in columns_str:
        if char == '(':
            paren_depth += 1
            current += char
        elif char == ')':
            paren_depth -= 1
            current += char
        elif char == ',' and paren_depth == 0:
            columns.append(current.strip())
            current = ""
        else:
            current += char
    
    if current.strip():
        columns.append(current.strip())
    
    for col_def in columns:
        col_def = col_def.strip()
        
        # Skip constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, CONSTRAINT)
        if re.match(r'^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)', col_def, re.IGNORECASE):
            continue
        
        # Parse column: column_name TYPE [constraints...]
        col_match = re.match(r'["\']?(\w+)["\']?\s+(\w+(?:\s*\([^)]*\))?)', col_def, re.IGNORECASE)
        if col_match:
            col_name = col_match.group(1).lower()
            col_type_raw = col_match.group(2).lower()
            
            # Extract base type (without size specification)
            base_type = re.sub(r'\s*\([^)]*\)', '', col_type_raw).strip()
            
            # Map to our standard types
            mapped_type = PG_TYPE_MAPPING.get(base_type, 'TEXT')
            
            # Check for NOT NULL constraint
            nullable = 'not null' not in col_def.lower()
            
            schema[col_name] = {
                'type': mapped_type,
                'nullable': nullable
            }
    
    return (table_name, schema) if schema else None


def parse_drop_table_statement(query: str) -> Optional[str]:
    """
    Parse a DROP TABLE statement to extract table name.
    
    Returns:
        Table name if successful, None otherwise.
    """
    # Match DROP TABLE pattern (with optional IF EXISTS)
    drop_pattern = r'DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["\']?(\w+)["\']?'
    match = re.search(drop_pattern, query, re.IGNORECASE)
    
    if not match:
        return None
    
    table_name = match.group(1).lower()
    
    # Skip system tables
    if table_name in SYSTEM_TABLES:
        return None
    
    return table_name


async def register_table_metadata(
    db: psycopg.AsyncConnection,
    table_name: str,
    table_schema: Dict[str, Any],
    owner_id: UUID
) -> None:
    """
    Register a table in the tables metadata table.
    This is called after a CREATE TABLE statement is successfully executed.
    """
    table_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    
    try:
        # Check if table already exists in metadata
        result = await db.execute(
            "SELECT id FROM tables WHERE name = %s",
            (table_name,)
        )
        existing = await result.fetchone()
        
        if existing:
            # Table already registered, skip
            return
        
        # Insert into tables metadata
        await db.execute(
            """
            INSERT INTO tables (id, name, table_schema, public, owner_id, description, metadata, row_count, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                table_id,
                table_name,
                psycopg.types.json.Json(table_schema),
                False,  # Default to private
                owner_id,
                f"Table created via SQL Editor",
                psycopg.types.json.Json({}),
                0,
                now,
                now
            )
        )
        await db.commit()
    except Exception:
        # Don't fail the main query if metadata registration fails
        await db.rollback()


async def unregister_table_metadata(
    db: psycopg.AsyncConnection,
    table_name: str
) -> None:
    """
    Remove a table from the tables metadata table.
    This is called after a DROP TABLE statement is successfully executed.
    """
    try:
        await db.execute(
            "DELETE FROM tables WHERE name = %s",
            (table_name,)
        )
        await db.commit()
    except Exception:
        # Don't fail the main query if metadata unregistration fails
        await db.rollback()

router = APIRouter(prefix="/sql", tags=["sql"])

# ─────────────────────────────────────────────────────────────────────────────
# Documentation & Error Helpers
# ─────────────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str

# Defined responses allow Schemathesis to accept 4xx codes as valid outcomes
# Include 406 for missing X-API-Key header (validated by middleware)
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
    """
    Dependency that requires admin role for all SQL operations.
    Automatically validates authentication and blocks non-admin users.
    """
    if current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for SQL operations"
        )
    return current_user

# ─────────────────────────────────────────────────────────────────────────────
# Security Patterns - Dangerous SQL patterns to block
# ─────────────────────────────────────────────────────────────────────────────

# Patterns that should be blocked for security reasons
DANGEROUS_PATTERNS = [
    r'\bpg_read_file\b',
    r'\bpg_write_file\b',
    r'\bpg_ls_dir\b',
    r'\blo_import\b',
    r'\blo_export\b',
    r'\bcopy\s+.*\s+to\s+program\b',
    r'\bcopy\s+.*\s+from\s+program\b',
    r'\bexecute\s+format\b',
    r';\s*--',  # SQL comment injection
]

# System tables that should not be modified
PROTECTED_TABLES = {
    'system_config',
    'sql_history',
    'sql_snippets',
    'pg_catalog',
    'information_schema',
}

def validate_query_security(query: str) -> None:
    """Validate query for dangerous patterns."""
    query_lower = query.lower()
    
    # Check for dangerous patterns
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, query_lower, re.IGNORECASE):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Query contains prohibited pattern for security reasons"
            )
    
    # Check for modifications to protected tables
    # Look for INSERT, UPDATE, DELETE, DROP, TRUNCATE on protected tables
    modification_patterns = [
        r'\b(insert\s+into|update|delete\s+from|drop\s+table|truncate)\s+',
    ]
    
    for pattern in modification_patterns:
        match = re.search(pattern, query_lower)
        if match:
            # Extract table name after the modification keyword
            remaining = query_lower[match.end():]
            for protected in PROTECTED_TABLES:
                if remaining.strip().startswith(protected):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Cannot modify protected system table: {protected}"
                    )


def is_read_only_query(query: str) -> bool:
    """Determine if a query is read-only (SELECT, EXPLAIN, etc.)."""
    query_stripped = query.strip().lower()
    read_only_prefixes = ('select', 'explain', 'show', 'describe', 'with')
    return query_stripped.startswith(read_only_prefixes)


# ─────────────────────────────────────────────────────────────────────────────
# SQL QUERY EXECUTION
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/query",
    response_model=SqlExecutionResult,
    responses=RESP_ERRORS,
    summary="Execute SQL Query",
    description="Execute a SQL query. Only ADMIN users can execute queries. Requires authentication and API key."
)
async def execute_query(
    request: SqlQueryRequest,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> SqlExecutionResult:
    """Execute a SQL query (ADMIN only)."""
    
    query = request.query.strip()
    
    # Security validation
    validate_query_security(query)
    
    # Track execution time
    start_time = time.time()
    is_read_only = is_read_only_query(query)
    
    try:
        async with db.cursor() as cur:
            await cur.execute(query)
            execution_time = time.time() - start_time
            
            # Get results for SELECT queries
            if is_read_only and cur.description:
                columns = [desc.name for desc in cur.description]
                rows = await cur.fetchall()
                data = [dict(zip(columns, row.values())) if hasattr(row, 'values') else dict(zip(columns, row)) for row in rows]
                row_count = len(data)
                
                result = SqlExecutionResult(
                    success=True,
                    is_read_only=True,
                    execution_time=execution_time,
                    row_count=row_count,
                    columns=columns,
                    data=data,
                    message=f"Query returned {row_count} row(s)"
                )
            else:
                # For non-SELECT queries, get rowcount
                row_count = cur.rowcount if cur.rowcount >= 0 else 0
                await db.commit()
                
                # Auto-detect CREATE TABLE and register in metadata
                create_table_info = parse_create_table_statement(query)
                if create_table_info:
                    table_name, table_schema = create_table_info
                    try:
                        await register_table_metadata(
                            db=db,
                            table_name=table_name,
                            table_schema=table_schema,
                            owner_id=current_user.id
                        )
                    except Exception:
                        pass  # Don't fail if metadata registration fails
                
                # Auto-detect DROP TABLE and unregister from metadata
                dropped_table = parse_drop_table_statement(query)
                if dropped_table:
                    try:
                        await unregister_table_metadata(db=db, table_name=dropped_table)
                    except Exception:
                        pass  # Don't fail if metadata unregistration fails
                
                result = SqlExecutionResult(
                    success=True,
                    is_read_only=False,
                    execution_time=execution_time,
                    row_count=row_count,
                    message=f"Query executed successfully. {row_count} row(s) affected."
                )
        
        # Save to history (don't fail if history save fails)
        try:
            await _save_history(
                db=db,
                query=query,
                is_read_only=is_read_only,
                execution_time=execution_time,
                row_count=result.row_count or 0,
                error=None,
                user_id=current_user.id
            )
        except Exception:
            pass  # Don't fail the request if history save fails
        
        return result
        
    except Exception as e:
        execution_time = time.time() - start_time
        error_msg = str(e)
        
        # Save failed query to history
        try:
            await _save_history(
                db=db,
                query=query,
                is_read_only=is_read_only,
                execution_time=execution_time,
                row_count=0,
                error=error_msg,
                user_id=current_user.id
            )
        except Exception:
            pass
        
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )


async def _save_history(
    db: psycopg.AsyncConnection,
    query: str,
    is_read_only: bool,
    execution_time: float,
    row_count: int,
    error: str | None,
    user_id: UUID
) -> None:
    """Save query execution to history."""
    history_id = uuid.uuid4()
    await db.execute(
        """
        INSERT INTO sql_history (id, query, is_read_only, execution_time, row_count, error, user_id, executed_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (history_id, query, is_read_only, execution_time, row_count, error, user_id, datetime.now(timezone.utc))
    )
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# SQL HISTORY
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/history",
    response_model=SqlHistoryListResponse,
    responses=RESP_ERRORS,
    summary="Get Query History",
    description="Get the admin user's SQL query execution history. Admin only. Requires authentication and API key."
)
async def get_query_history(
    limit: Annotated[int, Query(ge=1, le=500, description="Maximum number of history entries to return")] = 100,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> SqlHistoryListResponse:
    """Get query execution history for the current user."""
    
    result = await db.execute(
        """
        SELECT id, query, is_read_only, execution_time, row_count, error, executed_at
        FROM sql_history
        WHERE user_id = %s
        ORDER BY executed_at DESC
        LIMIT %s
        """,
        (current_user.id, limit)
    )
    
    records = await result.fetchall()
    history = [SqlHistoryRead(**record) for record in records]
    
    return SqlHistoryListResponse(history=history)


@router.delete(
    "/history",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Clear Query History",
    description="Clear all SQL query history for the admin user. Admin only. Requires authentication and API key."
)
async def clear_query_history(
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> None:
    """Clear query history for the current user."""
    
    await db.execute(
        "DELETE FROM sql_history WHERE user_id = %s",
        (current_user.id,)
    )
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# SQL SNIPPETS
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/snippets",
    response_model=SqlSnippetListResponse,
    responses=RESP_ERRORS,
    summary="Get SQL Snippets",
    description="Get saved SQL snippets. Returns admin's own snippets and shared snippets. Admin only. Requires authentication and API key."
)
async def get_snippets(
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> SqlSnippetListResponse:
    """Get saved SQL snippets."""
    
    # Get user's own snippets and shared snippets
    result = await db.execute(
        """
        SELECT id, name, sql_code, description, is_shared, created_by, created_at
        FROM sql_snippets
        WHERE created_by = %s OR is_shared = TRUE
        ORDER BY created_at DESC
        """,
        (current_user.id,)
    )
    
    records = await result.fetchall()
    snippets = [SqlSnippetRead(**record) for record in records]
    
    return SqlSnippetListResponse(snippets=snippets)


@router.post(
    "/snippets",
    response_model=SqlSnippetRead,
    status_code=status.HTTP_201_CREATED,
    responses=RESP_ERRORS,
    summary="Create SQL Snippet",
    description="Create a new saved SQL snippet. Admin only. Requires authentication and API key."
)
async def create_snippet(
    snippet: SqlSnippetCreate,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> SqlSnippetRead:
    """Create a new SQL snippet."""
    
    snippet_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)
    
    await db.execute(
        """
        INSERT INTO sql_snippets (id, name, sql_code, description, is_shared, created_by, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (snippet_id, snippet.name, snippet.sql_code, snippet.description, snippet.is_shared, current_user.id, created_at)
    )
    await db.commit()
    
    return SqlSnippetRead(
        id=snippet_id,
        name=snippet.name,
        sql_code=snippet.sql_code,
        description=snippet.description,
        is_shared=snippet.is_shared,
        created_by=current_user.id,
        created_at=created_at
    )


@router.delete(
    "/snippets/{snippet_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Delete SQL Snippet",
    description="Delete a saved SQL snippet. Admin only. Requires authentication and API key."
)
async def delete_snippet(
    snippet_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> None:
    """Delete a SQL snippet (Admin only)."""
    
    # Check if snippet exists
    result = await db.execute(
        "SELECT id FROM sql_snippets WHERE id = %s",
        (snippet_id,)
    )
    record = await result.fetchone()
    
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snippet not found"
        )
    
    await db.execute("DELETE FROM sql_snippets WHERE id = %s", (snippet_id,))
    await db.commit()
