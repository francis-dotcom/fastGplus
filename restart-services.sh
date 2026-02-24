#!/bin/bash
# Restart all production services on grandpluscollege.com

SERVER="femi@46.225.232.77"
SUDO_PASS="Simisola123#123#"

echo "🔄 Restarting services..."

ssh -o StrictHostKeyChecking=accept-new "$SERVER" "
  echo '$SUDO_PASS' | sudo -S systemctl restart nginx && echo '✅ Nginx restarted'
  cd /home/femi/Desktop/SelfDB && docker compose -f docker-compose-production.yml restart && echo '✅ SelfDB services restarted'
"

echo "🚀 All services restarted. Live at https://grandpluscollege.com"
