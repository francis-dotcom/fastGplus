#!/usr/bin/env bash
# Push SelfDB to Hetzner and start it. Run from grandpluscollege project root.
set -e
SELFDB_SRC="/Users/stfrancis/Desktop/SELFDB-V0.0.5.4"
SERVER="femi@46.225.232.77"
if [ ! -d "$SELFDB_SRC" ]; then
  echo "SelfDB folder not found: $SELFDB_SRC"
  exit 1
fi
echo "Syncing SelfDB to server..."
rsync -avz --exclude='.git' --exclude='node_modules' --exclude='SDKs/python/.venv' "$SELFDB_SRC/" "$SERVER:~/selfdb/"
echo "Starting SelfDB on server..."
ssh "$SERVER" 'cd ~/selfdb && docker compose -f docker-compose-production.yml up -d && docker compose -f docker-compose-production.yml ps'
echo "Done. Add Nginx proxy /api to port 8000 and CORS_ORIGINS for grandpluscollege.com in ~/selfdb/.env if needed."
