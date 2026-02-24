FROM elixir:1.17.1-alpine

WORKDIR /app

# Install curl for health checks and build dependencies
RUN apk add --no-cache curl build-base

# Install Hex and Rebar
RUN mix local.hex --force && mix local.rebar --force

# Copy mix files first for better caching
COPY mix.exs ./
RUN mix deps.get --only prod
RUN MIX_ENV=prod mix deps.compile

# Copy application code
COPY config ./config
COPY lib ./lib

# Compile the application
RUN MIX_ENV=prod mix compile

# Port is configured via environment variable (no hardcoded EXPOSE)
# Health check uses PORT environment variable
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Run the application
CMD ["mix", "run", "--no-halt"]
