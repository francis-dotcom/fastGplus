# webhook.py
"""Pydantic models for webhooks (simplified)."""

from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID
from enum import Enum


# ═══════════════════════════════════════════════════════════════════════════════
# Enums
# ═══════════════════════════════════════════════════════════════════════════════

class WebhookDeliveryStatus(str, Enum):
    """Webhook delivery status."""
    RECEIVED = "received"
    QUEUED = "queued"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRY_PENDING = "retry_pending"


# ═══════════════════════════════════════════════════════════════════════════════
# Webhook Models
# ═══════════════════════════════════════════════════════════════════════════════

class WebhookBase(BaseModel):
    """Base model with common webhook fields."""
    name: str = Field(min_length=1, max_length=255, description="Webhook name")
    description: Optional[str] = Field(None, max_length=1000)
    provider: Optional[str] = Field(None, max_length=50, description="External provider (stripe, github, etc.)")
    provider_event_type: Optional[str] = Field(None, max_length=255, description="Provider-specific event type")
    rate_limit_per_minute: int = Field(default=100, ge=1, le=10000)
    retry_attempts: int = Field(default=3, ge=1, le=10)
    retry_delay_seconds: int = Field(default=60, ge=1, le=3600)

    model_config = ConfigDict(
        extra='ignore',
        json_schema_extra={
            "examples": [{
                "name": "stripe-payment",
                "description": "Stripe payment webhook handler",
                "provider": "stripe",
                "provider_event_type": "payment_intent.succeeded"
            }]
        }
    )


class WebhookInDB(WebhookBase):
    """Webhook model stored in database."""
    id: UUID
    function_id: UUID
    owner_id: UUID
    webhook_token: str
    secret_key: str
    is_active: bool = True
    retry_enabled: bool = True
    last_received_at: Optional[datetime] = None
    last_delivery_status: Optional[str] = None
    successful_delivery_count: int = 0
    failed_delivery_count: int = 0
    total_delivery_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class WebhookCreate(BaseModel):
    """Model for creating a new webhook."""
    function_id: UUID = Field(..., description="UUID of the associated function")
    name: str = Field(min_length=1, max_length=255, description="Webhook name")
    description: Optional[str] = Field(None, max_length=1000)
    secret_key: str = Field(..., min_length=1, description="HMAC secret key for signature verification")
    provider: Optional[str] = Field(None, max_length=50)
    provider_event_type: Optional[str] = Field(None, max_length=255)
    rate_limit_per_minute: int = Field(default=100, ge=1, le=10000)
    retry_attempts: int = Field(default=3, ge=1, le=10)
    retry_delay_seconds: int = Field(default=60, ge=1, le=3600)

    @field_validator('secret_key')
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """Validate that secret key is not just whitespace."""
        if not v.strip():
            raise ValueError('Secret key cannot be empty or whitespace only')
        return v

    model_config = ConfigDict(
        extra='forbid',
        json_schema_extra={
            "examples": [{
                "function_id": "123e4567-e89b-12d3-a456-426614174000",
                "name": "stripe-payment",
                "secret_key": "whsec_xxx",
                "provider": "stripe"
            }]
        }
    )


class WebhookRead(WebhookBase):
    """Webhook model returned to client."""
    id: UUID
    function_id: UUID
    owner_id: UUID
    webhook_token: str
    secret_key: str
    is_active: bool
    retry_enabled: bool
    last_received_at: Optional[datetime] = None
    last_delivery_status: Optional[str] = None
    successful_delivery_count: int
    failed_delivery_count: int
    total_delivery_count: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class WebhookUpdate(BaseModel):
    """Model for updating an existing webhook."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    secret_key: Optional[str] = Field(None, min_length=1)
    is_active: Optional[bool] = None
    rate_limit_per_minute: Optional[int] = Field(None, ge=1, le=10000)
    retry_attempts: Optional[int] = Field(None, ge=1, le=10)
    retry_delay_seconds: Optional[int] = Field(None, ge=1, le=3600)

    @field_validator('secret_key')
    @classmethod
    def validate_secret_key(cls, v: Optional[str]) -> Optional[str]:
        """Validate that secret key is not just whitespace if provided."""
        if v is not None and not v.strip():
            raise ValueError('Secret key cannot be empty or whitespace only')
        return v

    model_config = ConfigDict(
        extra='forbid',
        json_schema_extra={
            "examples": [{
                "name": "updated-webhook-name",
                "is_active": False
            }]
        }
    )


class WebhookListResponse(BaseModel):
    """Response model for listing webhooks."""
    webhooks: List[WebhookRead]
    total: int
    limit: int
    offset: int


# ═══════════════════════════════════════════════════════════════════════════════
# Webhook Delivery Models
# ═══════════════════════════════════════════════════════════════════════════════

class WebhookDeliveryInDB(BaseModel):
    """Webhook delivery stored in database."""
    id: UUID
    webhook_id: UUID
    function_id: UUID
    source_ip: Optional[str] = None
    request_headers: Optional[Dict[str, Any]] = None
    request_body: Optional[Dict[str, Any]] = None
    signature_valid: Optional[bool] = None
    status: str
    delivery_attempt: int = 1
    processing_started_at: Optional[datetime] = None
    function_execution_id: Optional[UUID] = None
    execution_result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    execution_time_ms: Optional[int] = None
    response_status_code: Optional[int] = None
    retry_count: int = 0
    next_retry_at: Optional[datetime] = None
    created_at: datetime
    received_at: Optional[datetime] = None
    processing_completed_at: Optional[datetime] = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WebhookDeliveryRead(BaseModel):
    """Webhook delivery returned to client."""
    id: UUID
    webhook_id: UUID
    function_id: UUID
    source_ip: Optional[str] = None
    request_headers: Optional[Dict[str, Any]] = None
    request_body: Optional[Dict[str, Any]] = None
    signature_valid: Optional[bool] = None
    status: str
    delivery_attempt: int
    processing_started_at: Optional[datetime] = None
    function_execution_id: Optional[UUID] = None
    execution_result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    execution_time_ms: Optional[int] = None
    response_status_code: Optional[int] = None
    retry_count: int
    next_retry_at: Optional[datetime] = None
    created_at: datetime
    received_at: Optional[datetime] = None
    processing_completed_at: Optional[datetime] = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WebhookDeliveryListResponse(BaseModel):
    """Response model for listing deliveries."""
    deliveries: List[WebhookDeliveryRead]
    total: int
    limit: int
    offset: int
