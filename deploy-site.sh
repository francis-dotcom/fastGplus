#!/bin/bash
# Deploy grandpluscollege.com site files to the production server

SERVER="femi@46.225.232.77"
REMOTE_DIR="/var/www/html/grandpluscollege"

echo "🚀 Deploying grandpluscollege.com..."

# Load Supabase credentials from .env
if [ -f .env ]; then
  # Use a safer way to export variables from .env
  set -a
  source .env
  set +a
  echo "🔑 Loaded Supabase credentials from .env"
else
  echo "⚠️  .env file not found! Deployment may fail if keys are missing."
fi

# Auto-bump cache buster with current timestamp
TIMESTAMP=$(date +%s)
# Update assets with cache buster
sed -i '' "s/styles\.css\([?\"' ]\)/styles.css?v=${TIMESTAMP}\1/g" *.html
sed -i '' "s/styles\.css?v=[^\"' ]*/styles.css?v=${TIMESTAMP}/g" *.html
sed -i '' "s/menu\.js\([?\"' ]\)/menu.js?v=${TIMESTAMP}\1/g" *.html
sed -i '' "s/menu\.js?v=[^\"' ]*/menu.js?v=${TIMESTAMP}/g" *.html

# Inject SelfDB API URL and key into support.html and apply.html
if [ ! -z "$SELFDB_API_URL" ] && [ ! -z "$SELFDB_API_KEY" ]; then
  sed -i '' "s|SELFDB_API_URL_PLACEHOLDER|${SELFDB_API_URL}|g" support.html apply.html
  sed -i '' "s|SELFDB_API_KEY_PLACEHOLDER|${SELFDB_API_KEY}|g" support.html apply.html
  echo "💉 Injected SelfDB API credentials into support.html and apply.html"
else
  echo "⚠️  SELFDB_API_URL and SELFDB_API_KEY not set in .env – support/apply forms will not work until you deploy SelfDB and set these."
fi

echo "🔄 Deployment preparation complete (v=${TIMESTAMP})"

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
