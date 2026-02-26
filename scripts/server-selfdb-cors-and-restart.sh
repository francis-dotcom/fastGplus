#!/usr/bin/env bash
# Run this ON the server after SSH:  bash -c "$(curl -sL https://...)"  OR  copy-paste, OR scp and run
cd ~/selfdb || exit 1
if ! grep -q 'grandpluscollege.com' .env 2>/dev/null; then
  sed -i.bak 's|CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:8000,http://localhost:3000,http://localhost:5173,https://grandpluscollege.com,https://www.grandpluscollege.com|' .env
fi
docker compose -f docker-compose-production.yml up -d
echo Done. SelfDB restarted with CORS for grandpluscollege.com
