#!/usr/bin/env bash
# Run this ON the Hetzner server after copying postgres-grandplus/ there.
# Usage: cd ~/postgres-grandplus && chmod +x setup-on-server.sh && ./setup-on-server.sh

set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f .env ]; then
  cp env.example .env
  echo "Created .env from env.example. Edit it and set POSTGRES_PASSWORD, then run this script again."
  exit 0
fi

mkdir -p backups
set -a
source .env
set +a
docker compose up -d
echo "Waiting for Postgres to be ready..."
sleep 5
docker compose ps
docker exec postgres_grandplus psql -U "${POSTGRES_USER:-grandplus}" -d "${POSTGRES_DB:-grandplus_db}" -c "\dt" 2>/dev/null || true
echo "Done. Connection: postgresql://${POSTGRES_USER:-grandplus}:YOUR_PASSWORD@127.0.0.1:5433/${POSTGRES_DB:-grandplus_db}"
echo "Optional: crontab -e and add: 0 2 * * * $(pwd)/backup.sh >> $(pwd)/backup.log 2>&1"
