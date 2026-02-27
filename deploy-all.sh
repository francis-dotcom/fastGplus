#!/usr/bin/env bash
# Unified Deployment Script for Grand Plus College
# Order: 1. Deploy Site (Frontend) -> 2. Deploy SelfDB (Backend) -> 3. Deploy GPC Backend (Node) -> 4. Git Sync (Backup)

set -e

echo "------------------------------------------------"
echo "🚀 PHASE 1: Deploying Static Site..."
echo "------------------------------------------------"
./deploy-site.sh

echo ""
echo "------------------------------------------------"
echo "🐳 PHASE 2: Deploying SelfDB Stack..."
echo "------------------------------------------------"
./deploy-selfdb.sh

echo ""
echo "------------------------------------------------"
echo "🟢 PHASE 3: Deploying GPC Backend (Node.js)..."
echo "------------------------------------------------"
./deploy-backend.sh

echo ""
# PHASE 4: Syncing with GitHub
echo "------------------------------------------------"
echo "📦 PHASE 4: Syncing with GitHub..."
echo "------------------------------------------------"
if command -v gacp >/dev/null 2>&1; then
  gacp
else
  git add .
  git commit -m "update: Automated site and SelfDB deployment"
  git push
fi

echo ""
echo "✅ ALL SYSTEMS DEPLOYED & SYNCED!"
echo "Site: https://grandpluscollege.com"
