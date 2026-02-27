#!/usr/bin/env bash
# Create or reset the SelfDB admin user so you can log into the GUI.
# Reads ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME from
# SELFDB-GPC/.env and upserts that user into the local gpc_selfdb (container selfdb-gpc-db-1).
# Run from project root. Requires local SELFDB-GPC stack running.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SELFDB_GPC_DIR="${SELFDB_GPC_DIR:-$HOME/Desktop/SELFDB-GPC}"

if [ ! -f "$SELFDB_GPC_DIR/.env" ]; then
  echo "Missing $SELFDB_GPC_DIR/.env (set SELFDB_GPC_DIR if different)."
  exit 1
fi

# Read only ADMIN_* vars (avoid sourcing .env — lines with spaces break source)
read_var() { grep -E "^${1}=" "$SELFDB_GPC_DIR/.env" | cut -d= -f2- | head -1 | tr -d '\r\n '; }
ADMIN_EMAIL="$(read_var ADMIN_EMAIL)"
ADMIN_PASSWORD="$(read_var ADMIN_PASSWORD)"
ADMIN_FIRST_NAME="$(read_var ADMIN_FIRST_NAME)"
ADMIN_LAST_NAME="$(read_var ADMIN_LAST_NAME)"

for key in ADMIN_EMAIL ADMIN_PASSWORD ADMIN_FIRST_NAME ADMIN_LAST_NAME; do
  val="${!key}"
  if [ -z "$val" ]; then
    echo "Missing $key in $SELFDB_GPC_DIR/.env"
    exit 1
  fi
done

# Escape single quotes for SQL: ' -> ''
adm_email_sql="${ADMIN_EMAIL//\'/\'\'}"
adm_pwd_sql="${ADMIN_PASSWORD//\'/\'\'}"
adm_first_sql="${ADMIN_FIRST_NAME//\'/\'\'}"
adm_last_sql="${ADMIN_LAST_NAME//\'/\'\'}"

CONTAINER="${SELFDB_CONTAINER:-selfdb-gpc-db-1}"
USER="${POSTGRES_USER:-postgres}"
DB="${POSTGRES_DB:-gpc_selfdb}"

if ! docker exec "$CONTAINER" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then
  echo "Container $CONTAINER is not running or DB not ready. Start SELFDB-GPC first: cd $SELFDB_GPC_DIR && ./selfdb.sh start"
  exit 1
fi

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" << EOF
INSERT INTO users (id, email, password, first_name, last_name, role, is_active)
VALUES (
  gen_random_uuid(),
  '$adm_email_sql',
  crypt('$adm_pwd_sql', gen_salt('bf', 10)),
  '$adm_first_sql',
  '$adm_last_sql',
  'ADMIN',
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;
EOF

echo "Admin user set: $ADMIN_EMAIL — use this email and your ADMIN_PASSWORD to log into the GUI (http://localhost:3000)."