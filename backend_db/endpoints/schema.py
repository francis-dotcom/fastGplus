# schema.py
"""
Schema visualization endpoint for exposing database schema structure.
Provides table structure and foreign key relationships for the ReactFlow-based visualization.
"""

from typing import List, Set
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import psycopg

from models.schema import (
    SchemaVisualizationResponse, 
    SchemaNode, 
    SchemaColumn, 
    SchemaEdge
)
from models.user import UserInDB
from db import get_db
from security import get_current_active_user

router = APIRouter(prefix="/schema", tags=["schema"])

# ─────────────────────────────────────────────────────────────────────────────
# Documentation & Error Helpers
# ─────────────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str

RESP_ERRORS = {
    400: {"model": ErrorResponse, "description": "Bad Request"},
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    406: {"model": ErrorResponse, "description": "Not Acceptable"},
    500: {"model": ErrorResponse, "description": "Internal Server Error"},
}

# ─────────────────────────────────────────────────────────────────────────────
# Admin-Only Dependency
# ─────────────────────────────────────────────────────────────────────────────

def require_admin(current_user: UserInDB = Depends(get_current_active_user)) -> UserInDB:
    """
    Dependency that requires admin role for all schema operations.
    Automatically validates authentication and blocks non-admin users.
    """
    if current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for schema visualization"
        )
    return current_user

# ─────────────────────────────────────────────────────────────────────────────
# System Tables Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Tables to exclude from visualization (internal system tables)
SYSTEM_TABLES_TO_EXCLUDE: Set[str] = {
    "alembic_version",
    "sql_history",
    "sql_snippets",
    "storage_buckets",
    "storage_objects",
    "pg_stat_statements",
    "tables_metadata",  # Internal metadata table
}

# Core system tables to include in visualization (user-relevant system tables)
CORE_TABLES_TO_INCLUDE: Set[str] = {
    "users",
    "sessions",
    "tables",
    "webhooks",
    "webhook_deliveries",
    "functions",
    "scheduled_functions",
    "backup_configs",
    "backups",
}


def is_system_table(table_name: str) -> bool:
    """
    Determine if a table is a system table that should be excluded from visualization.
    Excludes internal PostgreSQL tables and SelfDB internal tables,
    but keeps user-facing system tables like 'users', 'sessions', etc.
    """
    # Exclude explicitly listed system tables
    if table_name in SYSTEM_TABLES_TO_EXCLUDE:
        return True
    
    # Include explicitly listed core tables
    if table_name in CORE_TABLES_TO_INCLUDE:
        return False
    
    # Exclude pg_* and information_schema tables
    if table_name.startswith("pg_") or table_name.startswith("_"):
        return True
    
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Schema Visualization Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/visualization",
    response_model=SchemaVisualizationResponse,
    responses=RESP_ERRORS,
    summary="Get Schema Visualization Data",
    description="""
    Get database schema data formatted for visualization with nodes (tables) and edges (foreign key relationships).
    
    Returns:
    - **nodes**: All user-created tables plus core system tables (users, sessions, etc.)
    - **edges**: All foreign key relationships between tables
    
    Each node contains:
    - Table name and label
    - Column definitions with data types
    - Primary key indicators
    
    Each edge represents a foreign key constraint connecting two tables.
    """
)
async def get_schema_visualization(
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> SchemaVisualizationResponse:
    """
    Get schema visualization data including all tables and their foreign key relationships.
    
    This endpoint queries the PostgreSQL information_schema to extract:
    1. All user tables and their columns
    2. Primary key information for each table
    3. Foreign key relationships between tables
    
    The response is formatted for use with ReactFlow-based schema visualization.
    """
    try:
        # Step 1: Get all tables in the public schema
        tables_query = """
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """
        result = await db.execute(tables_query)
        all_tables = await result.fetchall()
        
        # Filter out system tables
        table_names = [
            row["table_name"] 
            for row in all_tables 
            if not is_system_table(row["table_name"])
        ]
        
        if not table_names:
            return SchemaVisualizationResponse(nodes=[], edges=[])
        
        # Step 2: Get columns for all tables with primary key information
        # Using a single query with subquery for efficiency
        columns_query = """
            SELECT 
                c.table_name,
                c.column_name,
                c.data_type,
                c.column_default,
                c.ordinal_position,
                COALESCE(
                    (SELECT true
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu
                       ON tc.constraint_name = kcu.constraint_name
                      AND tc.table_schema = kcu.table_schema
                     WHERE tc.constraint_type = 'PRIMARY KEY'
                       AND tc.table_schema = 'public'
                       AND tc.table_name = c.table_name
                       AND kcu.column_name = c.column_name
                    ), false
                ) AS is_primary_key
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = ANY(%s)
            ORDER BY c.table_name, c.ordinal_position
        """
        result = await db.execute(columns_query, (table_names,))
        columns_data = await result.fetchall()
        
        # Step 3: Get foreign key relationships
        fk_query = """
            SELECT 
                tc.constraint_name AS id,
                tc.table_name AS source,
                kcu.column_name AS source_column,
                ccu.table_name AS target,
                ccu.column_name AS target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = ANY(%s)
            ORDER BY tc.table_name, kcu.column_name
        """
        result = await db.execute(fk_query, (table_names,))
        fk_data = await result.fetchall()
        
        # Step 4: Build nodes from columns data
        # Group columns by table
        table_columns: dict[str, List[SchemaColumn]] = {}
        table_primary_keys: dict[str, List[str]] = {}
        
        for row in columns_data:
            table_name = row["table_name"]
            
            if table_name not in table_columns:
                table_columns[table_name] = []
                table_primary_keys[table_name] = []
            
            column = SchemaColumn(
                column_name=row["column_name"],
                data_type=row["data_type"],
                column_default=row["column_default"],
                is_primary_key=row["is_primary_key"]
            )
            table_columns[table_name].append(column)
            
            if row["is_primary_key"]:
                table_primary_keys[table_name].append(row["column_name"])
        
        # Create nodes
        nodes: List[SchemaNode] = []
        for table_name in table_names:
            if table_name in table_columns:
                node = SchemaNode(
                    id=table_name,
                    label=table_name,
                    columns=table_columns[table_name],
                    primary_keys=table_primary_keys.get(table_name, [])
                )
                nodes.append(node)
        
        # Step 5: Build edges from foreign key data
        # Filter edges to only include relationships between visible tables
        table_set = set(table_names)
        edges: List[SchemaEdge] = []
        
        for row in fk_data:
            # Only include edges where both source and target are in our table list
            if row["source"] in table_set and row["target"] in table_set:
                edge = SchemaEdge(
                    id=row["id"],
                    source=row["source"],
                    target=row["target"],
                    source_column=row["source_column"],
                    target_column=row["target_column"]
                )
                edges.append(edge)
        
        return SchemaVisualizationResponse(nodes=nodes, edges=edges)
        
    except psycopg.Error as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error while fetching schema: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching schema visualization: {str(e)}"
        )


@router.get(
    "/tables",
    response_model=List[str],
    responses=RESP_ERRORS,
    summary="List All Table Names",
    description="Get a list of all table names in the database (excluding system tables)."
)
async def list_schema_tables(
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin),
) -> List[str]:
    """
    Get a simple list of all table names visible in the schema.
    Useful for dropdowns and quick lookups.
    """
    try:
        query = """
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """
        result = await db.execute(query)
        all_tables = await result.fetchall()
        
        return [
            row["table_name"] 
            for row in all_tables 
            if not is_system_table(row["table_name"])
        ]
        
    except psycopg.Error as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
