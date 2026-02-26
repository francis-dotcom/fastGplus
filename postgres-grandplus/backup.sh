#!/usr/bin/env bash
# Backup Grand Plus Postgres. Run from postgres-grandplus/ on the server.
# Cron example: 0 2 * * * /home/user/postgres-grandplus/backup.sh >> /home/user/postgres-grandplus/backup.log 2>&1

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

CONTAINER="${CONTAINER_NAME:-postgres_grandplus}"
BACKUP_DIR="${SCRIPT_DIR}/backups"
DATE=$(date +%Y-%m-%d_%H%M)
DB_NAME="${POSTGRES_DB:-grandplus_db}"
DB_USER="${POSTGRES_USER:-grandplus}"

mkdir -p "$BACKUP_DIR"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz"
# Keep last 7 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
echo "Backup done: ${DB_NAME}_${DATE}.sql.gz"
