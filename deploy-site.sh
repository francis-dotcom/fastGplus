#!/bin/bash
# Deploy grandpluscollege.com site files to the production server

SERVER="femi@46.225.232.77"
REMOTE_DIR="/var/www/html/grandpluscollege"

echo "🚀 Deploying grandpluscollege.com..."

# Auto-bump CSS cache buster with current timestamp so phones always get fresh styles
TIMESTAMP=$(date +%s)
sed -i '' "s/styles\.css?v=[^\"']*/styles.css?v=${TIMESTAMP}/" index.html
echo "🔄 Cache buster updated to v=${TIMESTAMP}"

rsync -az --progress \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='node_modules' \
  --exclude='backend_db' \
  --exclude='walkthrough.md' \
  --exclude='*.zip' \
  --exclude='stitch*' \
  --exclude='ssl' \
  -e "ssh -o StrictHostKeyChecking=accept-new" \
  ./ "$SERVER:$REMOTE_DIR/"

if [ $? -eq 0 ]; then
  echo "✅ Deployed successfully! Live at https://grandpluscollege.com"
else
  echo "❌ Deployment failed. Check your SSH connection."
  exit 1
fi
