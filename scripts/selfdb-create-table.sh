#!/usr/bin/env bash
# Create a SelfDB table on the server. You only supply the -d JSON.
# Usage: ./scripts/selfdb-create-table.sh '{"name":"my_table","table_schema":{...},"public":true}'
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  SELFDB_API_URL=$(grep '^SELFDB_API_URL=' .env | cut -d= -f2-)
  SELFDB_API_KEY=$(grep '^SELFDB_API_KEY=' .env | cut -d= -f2-)
fi
URL="${SELFDB_API_URL:-https://grandpluscollege.com/api}"
KEY="${SELFDB_API_KEY:?Set SELFDB_API_KEY in .env}"
if [ -z "$1" ]; then
  echo "Usage: $0 '<json payload>'"
  echo "Example: $0 '{\"name\":\"news\",\"table_schema\":{\"title\":{\"type\":\"text\",\"nullable\":true}},\"public\":true}'"
  exit 1
fi
curl -s -X POST "${URL}/tables/" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d "$1"
