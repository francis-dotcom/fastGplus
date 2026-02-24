# storage_client.py - Simple HTTP client for internal storage service
# Backend uses this to proxy requests to the storage service
# Configuration comes from environment variables (set in docker-compose.yml from .env)

import os
import httpx
from typing import Optional, BinaryIO, AsyncGenerator

# Storage service URL (internal Docker network) - no fallbacks, .env is source of truth
STORAGE_HOST = os.environ["STORAGE_HOST"]
STORAGE_PORT = os.environ["STORAGE_INTERNAL_PORT"]
STORAGE_BASE_URL = f"http://{STORAGE_HOST}:{STORAGE_PORT}/api/v1"

# Connection pool configuration (configurable via environment)
MAX_CONNECTIONS = int(os.getenv("STORAGE_MAX_CONNECTIONS", "100"))
MAX_KEEPALIVE_CONNECTIONS = int(os.getenv("STORAGE_MAX_KEEPALIVE", "20"))

# Timeouts optimized for internal service communication (configurable via environment)
TIMEOUT = httpx.Timeout(
    connect=float(os.getenv("STORAGE_CONNECT_TIMEOUT", "5.0")),
    read=float(os.getenv("STORAGE_READ_TIMEOUT", "300.0")),    # Per-chunk, not total
    write=float(os.getenv("STORAGE_WRITE_TIMEOUT", "300.0")),  # Per-chunk, not total
    pool=float(os.getenv("STORAGE_POOL_TIMEOUT", "5.0"))
)

# Connection limits for pooling
LIMITS = httpx.Limits(
    max_connections=MAX_CONNECTIONS,
    max_keepalive_connections=MAX_KEEPALIVE_CONNECTIONS
)

# Module-level shared client (initialized lazily, reused across requests)
_client: httpx.AsyncClient | None = None


async def get_client() -> httpx.AsyncClient:
    """Get or create the shared async HTTP client with connection pooling."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=TIMEOUT,
            limits=LIMITS
        )
    return _client


async def close_client() -> None:
    """Close the shared HTTP client (call on app shutdown)."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ─────────────────────────────────────────────────────────────────────────────
# Bucket Operations
# ─────────────────────────────────────────────────────────────────────────────

async def create_bucket(name: str, public: bool = False) -> dict:
    """Create a new bucket."""
    client = await get_client()
    response = await client.post(
        f"{STORAGE_BASE_URL}/buckets",
        json={"name": name, "public": public}
    )
    response.raise_for_status()
    return response.json()


async def list_buckets() -> list:
    """List all buckets."""
    client = await get_client()
    response = await client.get(f"{STORAGE_BASE_URL}/buckets")
    response.raise_for_status()
    return response.json()


async def get_bucket(name: str) -> dict:
    """Get bucket details."""
    client = await get_client()
    response = await client.get(f"{STORAGE_BASE_URL}/buckets/{name}")
    response.raise_for_status()
    return response.json()


async def update_bucket(name: str, public: Optional[bool] = None) -> dict:
    """Update bucket settings."""
    data = {}
    if public is not None:
        data["public"] = public
    
    client = await get_client()
    response = await client.put(
        f"{STORAGE_BASE_URL}/buckets/{name}",
        json=data
    )
    response.raise_for_status()
    return response.json()


async def delete_bucket(name: str) -> None:
    """Delete a bucket."""
    client = await get_client()
    response = await client.delete(f"{STORAGE_BASE_URL}/buckets/{name}")
    response.raise_for_status()


# ─────────────────────────────────────────────────────────────────────────────
# File Operations
# ─────────────────────────────────────────────────────────────────────────────

async def upload_file(bucket: str, path: str, file: BinaryIO, filename: str, content_type: str = "application/octet-stream") -> dict:
    """Upload a file to a bucket (multipart form - for backward compatibility)."""
    client = await get_client()
    files = {"file": (filename, file, content_type)}
    response = await client.post(
        f"{STORAGE_BASE_URL}/files/{bucket}/{path}",
        files=files
    )
    response.raise_for_status()
    return response.json()


async def upload_file_streaming(
    bucket: str,
    path: str,
    stream: AsyncGenerator[bytes, None],
    filename: str,
    content_type: str = "application/octet-stream",
    content_length: int | None = None
) -> dict:
    """
    Upload a file to storage using true streaming (no buffering).
    
    Args:
        bucket: Target bucket name
        path: File path within the bucket
        stream: Async generator yielding file chunks
        filename: Original filename
        content_type: MIME type of the file
        content_length: Optional file size for Content-Length header
    
    Returns:
        Storage service response as dict
    """
    client = await get_client()
    
    # Build headers for the storage service
    headers = {
        "Content-Type": content_type,
        "X-Filename": filename,
    }
    if content_length is not None:
        headers["Content-Length"] = str(content_length)
    
    response = await client.post(
        f"{STORAGE_BASE_URL}/files/{bucket}/{path}",
        content=stream,
        headers=headers
    )
    response.raise_for_status()
    return response.json()


async def download_file(bucket: str, path: str) -> httpx.Response:
    """Download a file from a bucket (returns streaming response)."""
    client = await get_client()
    response = await client.get(
        f"{STORAGE_BASE_URL}/files/{bucket}/{path}",
        follow_redirects=True
    )
    response.raise_for_status()
    return response


async def delete_file(bucket: str, path: str) -> None:
    """Delete a file from a bucket."""
    client = await get_client()
    response = await client.delete(f"{STORAGE_BASE_URL}/files/{bucket}/{path}")
    response.raise_for_status()


# ─────────────────────────────────────────────────────────────────────────────
# Health Check
# ─────────────────────────────────────────────────────────────────────────────

async def health_check() -> dict:
    """Check storage service health."""
    client = await get_client()
    try:
        response = await client.get(f"http://{STORAGE_HOST}:{STORAGE_PORT}/health")
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
