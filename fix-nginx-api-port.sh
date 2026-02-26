#!/usr/bin/env bash
# Fix Nginx: point /api/ to SelfDB on port 8000. You will be prompted for your server sudo password.
set -e
SERVER="femi@46.225.232.77"
echo "Connecting to server. You may be asked for your SSH password, then your sudo password."
ssh -t "$SERVER" 'sudo sed -i.bak "s|proxy_pass http://localhost:8001/|proxy_pass http://127.0.0.1:8000/|" /etc/nginx/sites-available/grandpluscollege && sudo nginx -t && sudo systemctl reload nginx && echo "✅ Nginx updated. /api/ now proxies to port 8000."'
