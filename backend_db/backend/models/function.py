# function.py
"""Pydantic models for serverless functions (Deno runtime only)."""

from pydantic import BaseModel, Field, field_validator, ConfigDict, StrictBool
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID
from enum import Enum
import re

# Function name pattern: alphanumeric, underscores, hyphens
FUNCTION_NAME_PATTERN = r'^[a-zA-Z][a-zA-Z0-9_-]*$'


def validate_function_name(v: Optional[str]) -> Optional[str]:
    """Validate function name follows naming conventions."""
    if v is None:
        return v
    if len(v) < 1 or len(v) > 255:
        raise ValueError('Function name must be between 1 and 255 characters')
    if not re.match(FUNCTION_NAME_PATTERN, v):
        raise ValueError('Function name must start with a letter and only contain letters, numbers, underscores, and hyphens')
    return v


def validate_code_not_empty(v: Optional[str]) -> Optional[str]:
    """Validate that code is not just whitespace."""
    if v is not None and not v.strip():
        raise ValueError('Function code cannot be empty or whitespace only')
    return v


# ═══════════════════════════════════════════════════════════════════════════════
# Enums
# ═══════════════════════════════════════════════════════════════════════════════

class DeploymentStatus(str, Enum):
    """Function deployment status."""
    PENDING = "pending"
    DEPLOYED = "deployed"
    FAILED = "failed"
    UNDEPLOYED = "undeployed"


class TriggerType(str, Enum):
    """Function trigger types."""
    HTTP = "http"
    SCHEDULE = "schedule"
    DATABASE = "database"
    EVENT = "event"
    WEBHOOK = "webhook"
    MANUAL = "manual"


class ExecutionStatus(str, Enum):
    """Function execution status."""
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


class LogLevel(str, Enum):
    """Log level types."""
    DEBUG = "debug"
    INFO = "info"
    WARN = "warn"
    ERROR = "error"


# ═══════════════════════════════════════════════════════════════════════════════
# Function Models
# ═══════════════════════════════════════════════════════════════════════════════

class FunctionBase(BaseModel):
    """Base model with common function fields."""
    name: str = Field(
        min_length=1,
        max_length=255,
        pattern=FUNCTION_NAME_PATTERN,
        strict=True,
        description="Function name (alphanumeric, underscores, hyphens)"
    )
    description: Optional[str] = Field(None, max_length=1000)
    timeout_seconds: int = Field(default=30, ge=5, le=300)

    model_config = ConfigDict(
        extra='ignore',
        json_schema_extra={
            "examples": [{
                "name": "hello-world",
                "description": "A simple hello world function",
                "timeout_seconds": 30
            }]
        }
    )


class FunctionInDB(FunctionBase):
    """Function model stored in database."""
    id: UUID
    code: str
    owner_id: UUID
    is_active: bool = True
    deployment_status: str = DeploymentStatus.PENDING.value
    deployment_error: Optional[str] = None
    version: int = 1
    env_vars: Dict[str, Any] = Field(default_factory=dict)
    execution_count: int = 0
    execution_success_count: int = 0
    execution_error_count: int = 0
    last_executed_at: Optional[datetime] = None
    avg_execution_time_ms: Optional[int] = None
    last_deployed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class FunctionCreate(BaseModel):
    """Model for creating a new function."""
    name: str = Field(
        min_length=1,
        max_length=255,
        pattern=FUNCTION_NAME_PATTERN,
        strict=True,
        json_schema_extra={
            "pattern": FUNCTION_NAME_PATTERN,
            "description": "Function name (start with letter, alphanumeric/underscore/hyphen)"
        }
    )
    code: str = Field(min_length=1, description="Function source code (TypeScript/Deno)")
    description: Optional[str] = Field(None, max_length=1000)
    timeout_seconds: int = Field(default=30, ge=5, le=300)
    env_vars: Optional[Dict[str, str]] = Field(default=None)

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        return validate_function_name(v)

    @field_validator('code')
    @classmethod
    def validate_code(cls, v: str) -> str:
        return validate_code_not_empty(v)

    model_config = ConfigDict(
        extra='forbid',
        json_schema_extra={
            "examples": [{
                "name": "hello-world",
                "code": "export default async (req) => new Response('Hello!');",
                "description": "A simple hello world function"
            }]
        }
    )


class FunctionRead(FunctionBase):
    """Function model returned to client."""
    id: UUID
    code: str
    owner_id: UUID
    is_active: bool
    deployment_status: str
    deployment_error: Optional[str] = None
    version: int
    env_vars: Dict[str, Any] = Field(default_factory=dict)
    execution_count: int
    execution_success_count: int
    execution_error_count: int
    last_executed_at: Optional[datetime] = None
    avg_execution_time_ms: Optional[int] = None
    last_deployed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class FunctionUpdate(BaseModel):
    """Model for updating an existing function."""
    name: Optional[str] = Field(None, min_length=1, max_length=255, pattern=FUNCTION_NAME_PATTERN)
    description: Optional[str] = Field(None, max_length=1000)
    code: Optional[str] = Field(None, min_length=1)
    timeout_seconds: Optional[int] = Field(None, ge=5, le=300)
    is_active: Optional[bool] = None
    env_vars: Optional[Dict[str, str]] = None

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        return validate_function_name(v)

    @field_validator('code')
    @classmethod
    def validate_code(cls, v: Optional[str]) -> Optional[str]:
        return validate_code_not_empty(v)

    model_config = ConfigDict(
        extra='forbid',
        json_schema_extra={
            "examples": [{
                "name": "new-function-name",
                "description": "Updated description",
                "is_active": False,
                "env_vars": {"API_KEY": "secret"}
            }]
        }
    )


class FunctionEnvVarsUpdate(BaseModel):
    """Model for updating function environment variables."""
    env_vars: Dict[str, str] = Field(..., description="Environment variables dictionary")

    model_config = ConfigDict(extra='forbid')


class FunctionListResponse(BaseModel):
    """Response model for listing functions."""
    functions: List[FunctionRead]
    total: int
    limit: int
    offset: int


# ═══════════════════════════════════════════════════════════════════════════════
# Execution Models
# ═══════════════════════════════════════════════════════════════════════════════

class FunctionExecutionInDB(BaseModel):
    """Function execution stored in database."""
    id: UUID
    function_id: UUID
    user_id: UUID
    trigger_type: str
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FunctionExecutionRead(BaseModel):
    """Function execution returned to client."""
    id: UUID
    function_id: UUID
    user_id: UUID
    trigger_type: str
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FunctionExecutionListResponse(BaseModel):
    """Response model for listing executions."""
    executions: List[FunctionExecutionRead]
    total: int
    limit: int
    offset: int


# ═══════════════════════════════════════════════════════════════════════════════
# Execution Result Model (from Deno runtime callback)
# ═══════════════════════════════════════════════════════════════════════════════

class ExecutionResultRequest(BaseModel):
    """Model for receiving execution results from Deno runtime."""
    execution_id: str = Field(default="", min_length=0, description="Execution ID from runtime")
    function_name: str = Field(default="", min_length=0, description="Name of the executed function")
    success: StrictBool = Field(default=False, description="Whether the execution succeeded")
    result: Optional[Any] = None
    logs: List[str] = Field(default_factory=list)
    execution_time_ms: float = Field(default=0.0, ge=0)
    timestamp: Optional[str] = Field(default=None, description="ISO 8601 timestamp of execution")
    delivery_id: Optional[str] = None

    @field_validator('execution_time_ms', mode='before')
    @classmethod
    def coerce_execution_time(cls, v):
        """Coerce execution_time_ms to float, reject non-numeric types."""
        if v is None:
            raise ValueError('execution_time_ms cannot be null')
        if isinstance(v, bool):
            raise ValueError('execution_time_ms must be a number, not boolean')
        if isinstance(v, (int, float)):
            return float(v)
        raise ValueError('execution_time_ms must be a number')

    model_config = ConfigDict(
        extra='ignore',
        json_schema_extra={
            "examples": [{
                "execution_id": "abc123",
                "function_name": "hello-world",
                "success": True,
                "result": {"message": "Hello!"},
                "logs": ["[LOG] Started execution"],
                "execution_time_ms": 125.5,
                "timestamp": "2025-01-01T00:00:00Z"
            }]
        }
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Log Models
# ═══════════════════════════════════════════════════════════════════════════════

class FunctionLogInDB(BaseModel):
    """Function log stored in database."""
    id: UUID
    execution_id: UUID
    function_id: UUID
    log_level: str
    message: str
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class FunctionLogRead(BaseModel):
    """Function log returned to client."""
    id: UUID
    execution_id: UUID
    function_id: UUID
    log_level: str
    message: str
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class FunctionLogListResponse(BaseModel):
    """Response model for listing logs."""
    logs: List[FunctionLogRead]
    total: int
    limit: int
    offset: int
