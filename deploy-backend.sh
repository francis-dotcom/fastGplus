#!/usr/bin/env bash
# Deploy GPC Node.js backend to production server
set -e

SERVER="femi@46.225.232.77"
REMOTE_DIR="/home/femi/gpc-backend"
SUDO_PASS="Simisola123#123#"

echo "─────────────────────────────────────────"
echo "🚀 Deploying GPC Backend..."
echo "─────────────────────────────────────────"

# 1. Sync backend code
echo "📦 Syncing backend files..."
rsync -az --progress \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.env' \
  -e "ssh -o StrictHostKeyChecking=accept-new" \
  ./backend/ "$SERVER:$REMOTE_DIR/"

# 2. Sync .env separately (not excluded from sync above, kept explicit)
echo "🔑 Syncing .env..."
scp -o StrictHostKeyChecking=accept-new ./backend/.env "$SERVER:$REMOTE_DIR/.env"

# 3. On server: install deps, build, restart service
echo "🔧 Installing & building on server..."
ssh -o StrictHostKeyChecking=accept-new "$SERVER" bash << ENDSSH
  # Load nvm so npm/node are available in non-interactive SSH
  export NVM_DIR="\$HOME/.nvm"
  [ -s "\$NVM_DIR/nvm.sh" ] && source "\$NVM_DIR/nvm.sh"

  # Fallback: find node in common locations
  export PATH="\$PATH:/usr/local/bin:/usr/bin"

  cd $REMOTE_DIR
  echo "Node: \$(node --version), npm: \$(npm --version)"

  npm install --omit=dev
  npm run build
  echo '✅ Build complete'

  # Write systemd service file
  echo '$SUDO_PASS' | sudo -S tee /etc/systemd/system/gpc-backend.service > /dev/null << 'SERVICE'
[Unit]
Description=GPC Node.js Backend
After=network.target

[Service]
Type=simple
User=femi
WorkingDirectory=/home/femi/gpc-backend
ExecStart=/bin/bash -c 'source /home/femi/.nvm/nvm.sh && node dist/index.js'
EnvironmentFile=/home/femi/gpc-backend/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

  echo '$SUDO_PASS' | sudo -S systemctl daemon-reload
  echo '$SUDO_PASS' | sudo -S systemctl enable gpc-backend
  echo '$SUDO_PASS' | sudo -S systemctl restart gpc-backend
  sleep 2
  echo '$SUDO_PASS' | sudo -S systemctl status gpc-backend --no-pager
ENDSSH

echo ""
echo "─────────────────────────────────────────"
echo "✅ Backend deployed at port 4000"
echo "─────────────────────────────────────────"
