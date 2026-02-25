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

# Inject Supabase Credentials into apply.html
if [ ! -z "$SUPABASE_URL" ] && [ ! -z "$SUPABASE_ANON_KEY" ]; then
  sed -i '' "s|SUPABASE_URL_PLACEHOLDER|${SUPABASE_URL}|g" apply.html
  sed -i '' "s|SUPABASE_KEY_PLACEHOLDER|${SUPABASE_ANON_KEY}|g" apply.html
  sed -i '' "s|SUPABASE_TABLE_PLACEHOLDER|${SUPABASE_TABLE_NAME}|g" apply.html
  echo "💉 Injected Supabase credentials into apply.html"
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
