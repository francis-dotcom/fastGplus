#!/usr/bin/env bash
# Create SelfDB admin user via API (backend hashes password = login always works)
# then set role to ADMIN in DB. This was the fix that worked before for "invalid username or password".
# Run with SelfDB backend on http://localhost:8000 (e.g. ./selfdb.sh start).
# Usage: ./scripts/selfdb-create-admin.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SELFDB_GPC_DIR="${SELFDB_GPC_DIR:-$HOME/Desktop/SELFDB-GPC}"

# API: use local backend so we're creating user in the same DB you log in to
API_URL="${SELFDB_API_URL:-http://localhost:8000}"
# API key must match backend (SELFDB-GPC .env)
if [ -f "$SELFDB_GPC_DIR/.env" ]; then
  API_KEY="$(grep -E '^API_KEY=' "$SELFDB_GPC_DIR/.env" | cut -d= -f2- | head -1)"
fi
API_KEY="${API_KEY:-$(grep -E '^SELFDB_API_KEY=' "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2- | head -1)}"
if [ -z "$API_KEY" ]; then
  echo "Set API_KEY in $SELFDB_GPC_DIR/.env or SELFDB_API_KEY in project .env"
  exit 1
fi

# Credentials from SELFDB-GPC/.env (same as seed script); trim newlines/spaces
read_var() { grep -E "^${1}=" "$SELFDB_GPC_DIR/.env" 2>/dev/null | cut -d= -f2- | head -1 | tr -d '\r\n '; }
EMAIL="$(read_var ADMIN_EMAIL)"
PASSWORD="$(read_var ADMIN_PASSWORD)"
FIRST_NAME="$(read_var ADMIN_FIRST_NAME)"
LAST_NAME="$(read_var ADMIN_LAST_NAME)"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Set ADMIN_EMAIL and ADMIN_PASSWORD in $SELFDB_GPC_DIR/.env"
  exit 1
fi
FIRST_NAME="${FIRST_NAME:-Admin}"
LAST_NAME="${LAST_NAME:-User}"

echo "Creating user $EMAIL via $API_URL (backend hashes password so login will work) ..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/users/" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\"}")

HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo "User created. Setting role to ADMIN in DB ..."
elif [ "$HTTP_CODE" = "409" ]; then
  echo "User already exists. Setting role to ADMIN and syncing password from .env ..."
  # Reset password in DB to match .env (in case it was wrong before)
  "$SCRIPT_DIR/selfdb-seed-admin.sh" 2>/dev/null || true
else
  echo "Request failed (HTTP $HTTP_CODE): $BODY"
  exit 1
fi

# Set role ADMIN (local container)
CONTAINER="${SELFDB_CONTAINER:-selfdb-gpc-db-1}"
DB="${POSTGRES_DB:-gpc_selfdb}"
USER="${POSTGRES_USER:-postgres}"
EMAIL_SQL="${EMAIL//\'/\'\'}"
if docker exec "$CONTAINER" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" -c "UPDATE users SET role = 'ADMIN', is_active = true WHERE email = '$EMAIL_SQL';"
  echo "Done. Log in at http://localhost:3000 with:"
  echo "  Email:    $EMAIL"
  echo "  Password: (your ADMIN_PASSWORD from $SELFDB_GPC_DIR/.env)"
else
  echo "DB container not ready. When SELFDB-GPC is running, set ADMIN with:"
  echo "  docker exec -i $CONTAINER psql -U $USER -d $DB -c \"UPDATE users SET role = 'ADMIN', is_active = true WHERE email = '$EMAIL';\""
fi
