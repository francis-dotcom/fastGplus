#!/usr/bin/env bash
# Reset the admin user's password on the SERVER DB so server GUI login works.
# Use if create-admin on server still gives "Invalid email or password" (e.g. .env had newlines).
# Run from project root.
set -e
SELFDB_GPC_DIR="${SELFDB_GPC_DIR:-$HOME/Desktop/SELFDB-GPC}"
read_var() { grep -E "^${1}=" "$SELFDB_GPC_DIR/.env" 2>/dev/null | cut -d= -f2- | head -1 | tr -d '\r\n '; }
ADMIN_EMAIL="$(read_var ADMIN_EMAIL)"
ADMIN_PASSWORD="$(read_var ADMIN_PASSWORD)"
[ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ] || { echo "Missing ADMIN_EMAIL or ADMIN_PASSWORD in $SELFDB_GPC_DIR/.env"; exit 1; }
# Escape single quotes for SQL
E="$(echo "$ADMIN_EMAIL" | sed "s/'/''/g")"
P="$(echo "$ADMIN_PASSWORD" | sed "s/'/''/g")"
ssh femi@46.225.232.77 "cd ~/selfdb && docker exec -i \$(docker ps -qf 'name=db-1' | head -1) psql -U postgres -d gpc_selfdb -v ON_ERROR_STOP=1 -c \"UPDATE users SET password = crypt('$P', gen_salt('bf', 10)) WHERE email = '$E';\""
echo "Server password reset. Log in at http://localhost:3001 with your .env credentials."
