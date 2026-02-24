#!/bin/bash
# Run schemathesis API tests against the local server
# Configuration is loaded from schemathesis.toml automatically
# Custom deserializers are loaded from hooks.py

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load API_KEY from .env file and export it for schemathesis.toml
ENV_FILE="${SCRIPT_DIR}/../.env"
if [[ -f "$ENV_FILE" ]]; then
    export API_KEY=$(grep "^API_KEY=" "$ENV_FILE" | cut -d'=' -f2)
fi

# Fallback if not found
if [[ -z "$API_KEY" ]]; then
    echo "❌ API_KEY not found in .env file. Please set it."
    exit 1
fi

# First fetch the schema with the API key, save to temp file
SCHEMA_FILE=$(mktemp /tmp/openapi.XXXXXX.json)
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$SCHEMA_FILE" \
    -H "X-API-Key: ${API_KEY}" \
    http://localhost:8000/openapi.json)

if [[ "$HTTP_CODE" != "200" ]]; then
    echo "❌ Failed to fetch OpenAPI schema (HTTP $HTTP_CODE)"
    cat "$SCHEMA_FILE"
    rm -f "$SCHEMA_FILE"
    exit 1
fi

echo "✓ Fetched OpenAPI schema"

# Run schemathesis with the local schema file
uv run schemathesis run "$SCHEMA_FILE" \
    --url http://localhost:8000 \
    --header "X-API-Key: ${API_KEY}"

EXIT_CODE=$?

# Clean up
rm -f "$SCHEMA_FILE"

exit $EXIT_CODE