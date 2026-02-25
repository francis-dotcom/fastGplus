#!/bin/bash
# Deploy grandpluscollege.com site files to the production server

SERVER="femi@46.225.232.77"
REMOTE_DIR="/var/www/html/grandpluscollege"

echo "🚀 Deploying grandpluscollege.com..."

# Auto-bump cache buster with current timestamp so phones always get fresh assets
TIMESTAMP=$(date +%s)
# Update all HTML files that use styles.css?v=...
sed -i '' "s/styles\.css?v=[^\"' ]*/styles.css?v=${TIMESTAMP}/g" *.html
# Update all HTML files that use menu.js?v=...
sed -i '' "s/menu\.js?v=[^\"' ]*/menu.js?v=${TIMESTAMP}/g" *.html
# Also add cache buster to menu.js references that don't have one yet
sed -i '' "s/menu\.js\"/menu.js?v=${TIMESTAMP}\"/g" *.html
echo "🔄 Cache buster updated to v=${TIMESTAMP} in all HTML files"

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
