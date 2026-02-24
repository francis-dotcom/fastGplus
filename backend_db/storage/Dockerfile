# ═══════════════════════════════════════════════════════════════════════════════
# SelfDB Storage Service Dockerfile
# FastAPI blob storage with uv package manager
# ═══════════════════════════════════════════════════════════════════════════════

# Use Python 3.12 slim image with uv pre-installed
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Install minimal system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for better caching
COPY pyproject.toml uv.lock* ./

# Install dependencies (without the project itself)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project

# Copy the rest of the application
COPY . .

# Install the project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

# Storage path - will be mounted as volume
ENV STORAGE_PATH=/data

# Create data directory
RUN mkdir -p /data

# Port is dynamic - set via STORAGE_INTERNAL_PORT env var at runtime
# No hardcoded EXPOSE - port comes from environment

# Run the FastAPI application with multiple workers for performance
# Workers default to 4, can be overridden via STORAGE_WORKERS env var
CMD ["sh", "-c", "uv run uvicorn main:app --host 0.0.0.0 --port ${STORAGE_INTERNAL_PORT} --workers ${STORAGE_WORKERS}"]
