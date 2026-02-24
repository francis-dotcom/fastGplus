# webhooks.py
"""API endpoints for webhook management (Admin only, except trigger endpoint)."""

import uuid
import secrets
import httpx
import os
from uuid import UUID
from typing import Annotated
from datetime import datetime, timezone
import psycopg
from psycopg.errors import UniqueViolation
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from models.webhook import (
    WebhookCreate,
    WebhookRead,
    WebhookUpdate,
    WebhookListResponse,
    WebhookDeliveryRead,
    WebhookDeliveryListResponse,
    WebhookInDB,
)
from models.user import UserInDB
from db import get_db
from security import get_current_active_user

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# Configuration
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
            detail="Admin access required for webhook management"
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


async def get_webhook_from_db(
    webhook_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db)
) -> WebhookInDB:
    """Dependency to fetch a webhook by ID."""
    result = await db.execute("SELECT * FROM webhooks WHERE id = %s", (webhook_id,))
    record = await result.fetchone()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
    return WebhookInDB(**record)


# ─────────────────────────────────────────────────────────────────────────────
# CRUD Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/",
    response_model=WebhookListResponse,
    dependencies=[Depends(strict_query_params({"limit", "offset"}))],
    responses=RESP_ERRORS,
    summary="List Webhooks",
    description="List all webhooks with pagination. Admin only."
)
async def list_webhooks(
    limit: Annotated[int, Query(ge=1, le=100, description="Maximum webhooks to return")] = 20,
    offset: Annotated[int, Query(ge=0, description="Number of webhooks to skip")] = 0,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin)
) -> WebhookListResponse:
    """List all webhooks with pagination (Admin only)."""
    count_result = await db.execute("SELECT COUNT(*) FROM webhooks")
    count_row = await count_result.fetchone()
    total = count_row['count'] if count_row else 0

    result = await db.execute(
        "SELECT * FROM webhooks ORDER BY created_at DESC LIMIT %s OFFSET %s",
        (limit, offset)
    )
    records = await result.fetchall()

    return WebhookListResponse(
        webhooks=[WebhookRead(**r) for r in records],
        total=total,
        limit=limit,
        offset=offset
    )


@router.post(
    "/",
    response_model=WebhookRead,
    status_code=status.HTTP_201_CREATED,
    responses=RESP_ERRORS,
    summary="Create Webhook",
    description="Create a new webhook. Admin only."
)
async def create_webhook(
    webhook: WebhookCreate,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin)
) -> WebhookRead:
    """Create a new webhook (Admin only)."""
    webhook_id = uuid.uuid4()
    webhook_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)

    try:
        await db.execute(
            """
            INSERT INTO webhooks (
                id, function_id, owner_id, name, description,
                provider, provider_event_type,
                webhook_token, secret_key, is_active,
                rate_limit_per_minute, retry_attempts,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s
            )
            """,
            (
                webhook_id, webhook.function_id, current_user.id, webhook.name, webhook.description,
                webhook.provider, webhook.provider_event_type,
                webhook_token, webhook.secret_key, True,
                webhook.rate_limit_per_minute, webhook.retry_attempts,
                now, now
            )
        )
        await db.commit()

        result = await db.execute("SELECT * FROM webhooks WHERE id = %s", (webhook_id,))
        record = await result.fetchone()
        return WebhookRead(**record)

    except UniqueViolation:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Webhook with name '{webhook.name}' already exists"
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get(
    "/{webhook_id}",
    response_model=WebhookRead,
    responses=RESP_ERRORS,
    summary="Get Webhook",
    description="Get a specific webhook by ID. Admin only."
)
async def get_webhook(
    webhook: WebhookInDB = Depends(get_webhook_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> WebhookRead:
    """Get a webhook by ID (Admin only)."""
    return WebhookRead(**webhook.model_dump())


@router.patch(
    "/{webhook_id}",
    response_model=WebhookRead,
    responses=RESP_ERRORS,
    summary="Update Webhook",
    description="Update an existing webhook. Admin only."
)
async def update_webhook(
    webhook_id: UUID,
    update: WebhookUpdate,
    db: psycopg.AsyncConnection = Depends(get_db),
    webhook_in_db: WebhookInDB = Depends(get_webhook_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> WebhookRead:
    """Update an existing webhook (Admin only)."""
    update_data = update.model_dump(exclude_unset=True)
    update_data = {k: v for k, v in update_data.items() if v is not None}

    if not update_data:
        return WebhookRead(**webhook_in_db.model_dump())

    set_clauses = []
    values = []
    for field, value in update_data.items():
        set_clauses.append(f"{field} = %s")
        values.append(value)

    set_clauses.append("updated_at = %s")
    values.append(datetime.now(timezone.utc))
    values.append(webhook_id)

    query = f"UPDATE webhooks SET {', '.join(set_clauses)} WHERE id = %s RETURNING *"

    try:
        result = await db.execute(query, tuple(values))
        record = await result.fetchone()
        await db.commit()
        return WebhookRead(**record)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete(
    "/{webhook_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESP_ERRORS,
    summary="Delete Webhook",
    description="Delete a webhook. Admin only."
)
async def delete_webhook(
    webhook_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    webhook_in_db: WebhookInDB = Depends(get_webhook_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> None:
    """Delete a webhook (Admin only)."""
    await db.execute("DELETE FROM webhooks WHERE id = %s", (webhook_id,))
    await db.commit()


@router.post(
    "/{webhook_id}/regenerate-token",
    response_model=WebhookRead,
    responses=RESP_ERRORS,
    summary="Regenerate Token",
    description="Regenerate the webhook token. Admin only."
)
async def regenerate_webhook_token(
    webhook_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    webhook_in_db: WebhookInDB = Depends(get_webhook_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> WebhookRead:
    """Regenerate webhook token (Admin only)."""
    new_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)

    await db.execute(
        "UPDATE webhooks SET webhook_token = %s, updated_at = %s WHERE id = %s",
        (new_token, now, webhook_id)
    )
    await db.commit()

    result = await db.execute("SELECT * FROM webhooks WHERE id = %s", (webhook_id,))
    record = await result.fetchone()
    return WebhookRead(**record)


# ─────────────────────────────────────────────────────────────────────────────
# Public Trigger Endpoint (No Auth Required, No API Key Required)
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/trigger/{webhook_token}",
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        202: {"description": "Webhook accepted for processing"},
        404: {"model": ErrorResponse, "description": "Webhook not found or inactive"},
        400: {"model": ErrorResponse, "description": "Bad Request"},
    },
    summary="Trigger Webhook",
    description="Public endpoint to trigger a webhook by token. No authentication or API key required - authentication is via the webhook token itself.",
    tags=["webhooks-public"]
)
async def trigger_webhook(
    webhook_token: str,
    request: Request,
    db: psycopg.AsyncConnection = Depends(get_db)
) -> dict:
    """Public endpoint to trigger a webhook by token (No auth or API key required)."""
    # Validate webhook token format (alphanumeric, hyphens, underscores only)
    if not webhook_token or len(webhook_token) > 255:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook not found or inactive"
        )
    
    # Check for invalid characters (non-ASCII or control characters)
    try:
        webhook_token.encode('ascii')
        if not all(c.isalnum() or c in '-_' for c in webhook_token):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook not found or inactive"
            )
    except UnicodeEncodeError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook not found or inactive"
        )

    # Find webhook by token
    result = await db.execute(
        "SELECT * FROM webhooks WHERE webhook_token = %s AND is_active = TRUE",
        (webhook_token,)
    )
    record = await result.fetchone()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook not found or inactive"
        )

    webhook = WebhookInDB(**record)
    delivery_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    # Get request payload
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    # Create initial delivery record
    await db.execute(
        """
        INSERT INTO webhook_deliveries (
            id, webhook_id, function_id, request_body, status,
            delivery_attempt, created_at, received_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s
        )
        """,
        (
            delivery_id, webhook.id, webhook.function_id,
            psycopg.types.json.Json(payload), 'received',
            1, now, now, now
        )
    )
    await db.commit()

    # Invoke the linked function via Deno runtime
    fn_result = await db.execute(
        "SELECT name FROM functions WHERE id = %s",
        (webhook.function_id,)
    )
    fn_record = await fn_result.fetchone()

    if fn_record:
        function_name = fn_record['name']

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{FUNCTIONS_URL}/invoke/{function_name}",
                    json={"payload": payload, "delivery_id": str(delivery_id)},
                    headers={"Content-Type": "application/json"}
                )
                response_data = response.json()

                # Update delivery status
                await db.execute(
                    """
                    UPDATE webhook_deliveries SET
                        status = %s,
                        response_status_code = %s,
                        execution_result = %s,
                        processing_completed_at = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (
                        'completed' if response.status_code < 400 else 'failed',
                        response.status_code,
                        psycopg.types.json.Json(response_data),
                        datetime.now(timezone.utc), datetime.now(timezone.utc),
                        delivery_id
                    )
                )
                await db.commit()

                return {
                    "accepted": True,
                    "delivery_id": str(delivery_id),
                    "function": function_name
                }

        except Exception as e:
            await db.execute(
                """
                UPDATE webhook_deliveries SET
                    status = %s,
                    error_message = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                ('failed', str(e), datetime.now(timezone.utc), delivery_id)
            )
            await db.commit()

            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to invoke function: {str(e)}"
            )

    return {
        "accepted": True,
        "delivery_id": str(delivery_id),
        "message": "Webhook received but no function configured"
    }


# ─────────────────────────────────────────────────────────────────────────────
# Delivery History Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{webhook_id}/deliveries",
    response_model=WebhookDeliveryListResponse,
    dependencies=[Depends(strict_query_params({"limit", "offset"}))],
    responses=RESP_ERRORS,
    summary="List Webhook Deliveries",
    description="Get delivery history for a webhook. Admin only."
)
async def list_webhook_deliveries(
    webhook_id: UUID,
    limit: Annotated[int, Query(ge=1, le=100, description="Maximum deliveries to return")] = 20,
    offset: Annotated[int, Query(ge=0, description="Number of deliveries to skip")] = 0,
    db: psycopg.AsyncConnection = Depends(get_db),
    webhook_in_db: WebhookInDB = Depends(get_webhook_from_db),
    current_user: UserInDB = Depends(require_admin)
) -> WebhookDeliveryListResponse:
    """List deliveries for a webhook (Admin only)."""
    count_result = await db.execute(
        "SELECT COUNT(*) FROM webhook_deliveries WHERE webhook_id = %s",
        (webhook_id,)
    )
    count_row = await count_result.fetchone()
    total = count_row['count'] if count_row else 0

    result = await db.execute(
        """
        SELECT * FROM webhook_deliveries
        WHERE webhook_id = %s
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        (webhook_id, limit, offset)
    )
    records = await result.fetchall()

    return WebhookDeliveryListResponse(
        deliveries=[WebhookDeliveryRead(**r) for r in records],
        total=total,
        limit=limit,
        offset=offset
    )


@router.post(
    "/deliveries/{delivery_id}/retry",
    response_model=WebhookDeliveryRead,
    responses=RESP_ERRORS,
    summary="Retry Delivery",
    description="Retry a failed webhook delivery. Admin only."
)
async def retry_webhook_delivery(
    delivery_id: UUID,
    db: psycopg.AsyncConnection = Depends(get_db),
    current_user: UserInDB = Depends(require_admin)
) -> WebhookDeliveryRead:
    """Retry a failed webhook delivery (Admin only)."""
    result = await db.execute(
        "SELECT * FROM webhook_deliveries WHERE id = %s",
        (delivery_id,)
    )
    delivery_record = await result.fetchone()

    if not delivery_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found")

    webhook_result = await db.execute(
        "SELECT * FROM webhooks WHERE id = %s",
        (delivery_record['webhook_id'],)
    )
    webhook_record = await webhook_result.fetchone()

    if not webhook_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    webhook = WebhookInDB(**webhook_record)
    payload = delivery_record['request_body'] or {}
    now = datetime.now(timezone.utc)

    # Update retry count
    await db.execute(
        "UPDATE webhook_deliveries SET retry_count = retry_count + 1, delivery_attempt = delivery_attempt + 1, updated_at = %s WHERE id = %s",
        (now, delivery_id)
    )

    # Get function name and invoke
    fn_result = await db.execute(
        "SELECT name FROM functions WHERE id = %s",
        (webhook.function_id,)
    )
    fn_record = await fn_result.fetchone()

    if fn_record:
        function_name = fn_record['name']

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{FUNCTIONS_URL}/invoke/{function_name}",
                    json={"payload": payload, "delivery_id": str(delivery_id)},
                    headers={"Content-Type": "application/json"}
                )
                response_data = response.json()

                await db.execute(
                    """
                    UPDATE webhook_deliveries SET
                        status = %s,
                        response_status_code = %s,
                        execution_result = %s,
                        processing_completed_at = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (
                        'completed' if response.status_code < 400 else 'failed',
                        response.status_code,
                        psycopg.types.json.Json(response_data),
                        now, now, delivery_id
                    )
                )

        except Exception as e:
            await db.execute(
                """
                UPDATE webhook_deliveries SET
                    status = %s,
                    error_message = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                ('failed', str(e), now, delivery_id)
            )

    await db.commit()

    result = await db.execute("SELECT * FROM webhook_deliveries WHERE id = %s", (delivery_id,))
    record = await result.fetchone()
    return WebhookDeliveryRead(**record)
