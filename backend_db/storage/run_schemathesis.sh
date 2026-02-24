#!/bin/bash
# Run schemathesis API tests against the local server

# Create test bucket before running tests (idempotent - safe to run multiple times)
echo "Setting up test data..."
curl -s -X POST -H 'Content-Type: application/json' \
    -d '{"name": "test-bucket", "public": false}' \
    http://localhost:8000/api/v1/buckets > /dev/null

# Create a test file in the bucket
echo "test content" > /tmp/test-file.txt
curl -s -X POST -F "file=@/tmp/test-file.txt" \
    http://localhost:8000/api/v1/files/test-bucket/test-file.txt > /dev/null

echo "Running schemathesis tests..."
# Note: schemathesis.toml is auto-loaded from current directory
# hooks = "hooks" in the config loads our custom deserializers
uv run schemathesis run http://localhost:8000/openapi.json 