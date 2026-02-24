# syntax=docker/dockerfile:1
# ═══════════════════════════════════════════════════════════════════════════════
# SelfDB Functions Service Dockerfile
# Deno runtime for serverless function execution
# ═══════════════════════════════════════════════════════════════════════════════

FROM denoland/deno:latest

# Build arguments (non-sensitive only)
# Note: API_KEY is passed at runtime via docker-compose environment, not at build time
ARG BACKEND_URL=http://backend:8000

# Set non-sensitive build args as environment variables
# API_KEY will be injected at runtime by docker-compose
ENV BACKEND_URL=${BACKEND_URL}

# Install curl for health checks (Debian-based image)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy runtime files
COPY *.ts ./

# Cache dependencies by running deno cache
RUN deno cache main.ts

# Port is configured via environment variable (no hardcoded EXPOSE)
# Health check is defined in docker-compose.yml

# Run the function runtime
# --allow-net: Allow network access for HTTP server and backend calls
# --allow-read: Allow reading function files from disk
# --allow-write: Allow writing deployed functions to disk
# --allow-env: Allow reading environment variables
CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "main.ts"]
