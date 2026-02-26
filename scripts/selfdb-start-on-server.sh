#!/usr/bin/env bash
# Run this ON the Hetzner server (e.g. after ssh femi@46.225.232.77)
# Usage: bash -c "$(cat scripts/selfdb-start-on-server.sh)"   OR  copy to server and run

cd ~/selfdb || { echo "~/selfdb not found. Run rsync from Mac first."; exit 1; }

# Ensure CORS allows the site (append if not present)
if ! grep -q 'grandpluscollege.com' .env 2>/dev/null; then
  echo "Adding grandpluscollege.com to CORS_ORIGINS in .env..."
  sed -i.bak 's|CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:8000,http://localhost:3000,http://localhost:5173,https://grandpluscollege.com,https://www.grandpluscollege.com|' .env 2>/dev/null || true
fi

docker compose -f docker-compose-production.yml up -d
docker compose -f docker-compose-production.yml ps
echo "Health: curl -s -H 'X-API-Key: YOUR_API_KEY' http://localhost:8000/health"
