#!/usr/bin/env bash
# Backup production SelfDB (Hetzner) to your Mac. Run from grandpluscollege project root.
# Creates: backend_db/backups/gpc_selfdb_YYYYMMDD_HHMMSS.sql
set -e
SERVER="${SELFDB_SERVER:-femi@46.225.232.77}"
DB_NAME="${SELFDB_DB_NAME:-gpc_selfdb}"
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backend_db/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/gpc_selfdb_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

# Find SelfDB db container on server (e.g. selfdb-db-1)
CONTAINER=$(ssh "$SERVER" "docker ps -q --filter 'name=db' --filter 'name=selfdb' | head -1")
if [ -z "$CONTAINER" ]; then
  echo "No SelfDB db container found on server. Is SelfDB running?"
  exit 1
fi

echo "Backing up $DB_NAME from server (container $CONTAINER) to $BACKUP_FILE ..."
ssh "$SERVER" "docker exec $CONTAINER pg_dump -U postgres $DB_NAME" > "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "Backup failed or empty. Check server and DB name."
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "Done. Backup saved to: $BACKUP_FILE ($(wc -c < "$BACKUP_FILE" | tr -d ' ') bytes)"
