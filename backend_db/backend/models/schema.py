# schema.py
"""
Schema visualization models for representing database schema structure.
Used by the ReactFlow-based schema visualization frontend component.
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class SchemaColumn(BaseModel):
    """Represents a column in a database table for schema visualization."""
    column_name: str = Field(..., description="Name of the column")
    data_type: str = Field(..., description="PostgreSQL data type of the column")
    column_default: Optional[str] = Field(None, description="Default value expression for the column")
    is_primary_key: bool = Field(default=False, description="Whether this column is part of the primary key")


class SchemaNode(BaseModel):
    """
    Represents a table node in the schema visualization graph.
    Each node contains the table's columns and metadata.
    """
    id: str = Field(..., description="Table name (used as unique identifier)")
    label: str = Field(..., description="Display label for the table")
    columns: List[SchemaColumn] = Field(default_factory=list, description="List of columns in the table")
    primary_keys: List[str] = Field(default_factory=list, description="List of primary key column names")


class SchemaEdge(BaseModel):
    """
    Represents a foreign key relationship edge in the schema visualization graph.
    Connects a source table's column to a target table's column.
    """
    id: str = Field(..., description="Unique identifier for the edge (constraint name)")
    source: str = Field(..., description="Source table name")
    target: str = Field(..., description="Target (referenced) table name")
    source_column: str = Field(..., description="Source column name (foreign key)")
    target_column: str = Field(..., description="Target column name (referenced key)")


class SchemaVisualizationResponse(BaseModel):
    """
    Complete schema visualization data response.
    Contains all tables as nodes and all foreign key relationships as edges.
    """
    nodes: List[SchemaNode] = Field(default_factory=list, description="List of table nodes")
    edges: List[SchemaEdge] = Field(default_factory=list, description="List of foreign key relationship edges")
