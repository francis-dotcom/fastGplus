# sql.py
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID

# ═══════════════════════════════════════════════════════════════════════════════
# SQL Execution Models
# ═══════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
# Request Models
# ─────────────────────────────────────────────────────────────────────────────

class SqlQueryRequest(BaseModel):
    """Request model for executing a SQL query."""
    query: str = Field(
        ..., 
        min_length=1, 
        max_length=100000,
        description="SQL query to execute"
    )
    
    model_config = ConfigDict(
        extra='ignore',
        json_schema_extra={
            "examples": [{
                "query": "SELECT * FROM users LIMIT 10"
            }]
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# Response Models
# ─────────────────────────────────────────────────────────────────────────────

class SqlExecutionResult(BaseModel):
    """Result of a SQL query execution."""
    success: bool = Field(..., description="Whether the query executed successfully")
    is_read_only: bool = Field(..., description="Whether the query was read-only (SELECT)")
    execution_time: float = Field(..., description="Query execution time in seconds")
    row_count: Optional[int] = Field(None, description="Number of rows returned or affected")
    columns: Optional[List[str]] = Field(None, description="Column names for SELECT queries")
    data: Optional[List[Dict[str, Any]]] = Field(None, description="Query result data")
    message: Optional[str] = Field(None, description="Success or info message")
    error: Optional[str] = Field(None, description="Error message if query failed")
    
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{
                "success": True,
                "is_read_only": True,
                "execution_time": 0.025,
                "row_count": 5,
                "columns": ["id", "name", "email"],
                "data": [{"id": 1, "name": "John", "email": "john@example.com"}],
                "message": "Query executed successfully"
            }]
        }
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SQL History Models
# ═══════════════════════════════════════════════════════════════════════════════

class SqlHistoryInDB(BaseModel):
    """SQL history entry stored in database."""
    id: UUID
    query: str
    is_read_only: bool
    execution_time: float
    row_count: Optional[int] = None
    error: Optional[str] = None
    user_id: UUID
    executed_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class SqlHistoryRead(BaseModel):
    """SQL history entry returned to client."""
    id: UUID
    query: str
    is_read_only: bool
    execution_time: float
    row_count: Optional[int] = None
    error: Optional[str] = None
    executed_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class SqlHistoryListResponse(BaseModel):
    """Response model for listing SQL history."""
    history: List[SqlHistoryRead]


# ═══════════════════════════════════════════════════════════════════════════════
# SQL Snippets Models
# ═══════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
# Database Model
# ─────────────────────────────────────────────────────────────────────────────

class SqlSnippetInDB(BaseModel):
    """SQL snippet stored in database."""
    id: UUID
    name: str
    sql_code: str
    description: Optional[str] = None
    is_shared: bool = False
    created_by: UUID
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


# ─────────────────────────────────────────────────────────────────────────────
# Create Model
# ─────────────────────────────────────────────────────────────────────────────

class SqlSnippetCreate(BaseModel):
    """Request model for creating a SQL snippet."""
    name: str = Field(
        ..., 
        min_length=1, 
        max_length=100,
        description="Name of the snippet"
    )
    sql_code: str = Field(
        ..., 
        min_length=1, 
        max_length=100000,
        description="SQL code for the snippet"
    )
    description: Optional[str] = Field(
        None, 
        max_length=500,
        description="Description of what the snippet does"
    )
    is_shared: bool = Field(
        default=False,
        description="Whether the snippet is shared with other users"
    )
    
    model_config = ConfigDict(
        extra='ignore',
        json_schema_extra={
            "examples": [{
                "name": "Get active users",
                "sql_code": "SELECT * FROM users WHERE is_active = true",
                "description": "Retrieves all active users from the database",
                "is_shared": False
            }]
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# Read Model
# ─────────────────────────────────────────────────────────────────────────────

class SqlSnippetRead(BaseModel):
    """SQL snippet returned to client."""
    id: UUID
    name: str
    sql_code: str
    description: Optional[str] = None
    is_shared: bool = False
    created_by: UUID
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class SqlSnippetListResponse(BaseModel):
    """Response model for listing SQL snippets."""
    snippets: List[SqlSnippetRead]
