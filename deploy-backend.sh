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

# 2. Sync .env separately then force NODE_ENV=production on server
echo "🔑 Syncing .env..."
if [ -f ./backend/.env ]; then
  scp -o StrictHostKeyChecking=accept-new ./backend/.env "$SERVER:$REMOTE_DIR/.env"
else
  echo "⚠️  ./backend/.env not found locally — skipping (server .env unchanged)"
fi
ssh -o StrictHostKeyChecking=accept-new "$SERVER" "sed -i 's/NODE_ENV=.*/NODE_ENV=production/' $REMOTE_DIR/.env"

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

  npm install
  npm run build
  npm prune --omit=dev
  echo '✅ Build complete'

  # Restart via PM2
  pm2 restart gpc-backend --update-env || pm2 start dist/index.js --name gpc-backend
  pm2 save
  pm2 status
ENDSSH

echo ""
echo "─────────────────────────────────────────"
echo "✅ Backend deployed at port 4000"
echo "─────────────────────────────────────────"
