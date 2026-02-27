#!/usr/bin/env bash
# Create SelfDB admin user via API then set role to ADMIN in DB.
# Run with SelfDB backend on http://localhost:8000 (e.g. ./selfdb.sh start).
# Usage: ./scripts/selfdb-create-admin.sh

set -e
API_URL="${SELFDB_API_URL:-http://localhost:8000}"
API_KEY="${SELFDB_API_KEY:-selfdb-bd66637d-60dc-cf8a-a1aa-037f1b37d7b9}"

# Password must be 8+ chars (SelfDB validation). Use this then change in UI.
EMAIL="femioginos@gmail.com"
PASSWORD="Password4211"
FIRST_NAME="femi"
LAST_NAME="ogini"

echo "Creating user $EMAIL via $API_URL ..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/users/" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\"}")

HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo "User created. Log in at http://localhost:3000 with:"
  echo "  Email:    $EMAIL"
  echo "  Password: $PASSWORD"
  echo ""
  echo "To make this user ADMIN (full dashboard), run the SQL below inside the Postgres container:"
  echo "  docker exec -it \$(docker ps -qf 'name=db' | head -1) psql -U postgres -d selfdb -c \"UPDATE users SET role = 'ADMIN' WHERE email = '$EMAIL';\""
  echo ""
  echo "Or if your DB name is gpc_selfdb:"
  echo "  docker exec -it \$(docker ps -qf 'name=db' | head -1) psql -U postgres -d gpc_selfdb -c \"UPDATE users SET role = 'ADMIN' WHERE email = '$EMAIL';\""
  exit 0
fi

if [ "$HTTP_CODE" = "409" ]; then
  echo "User already exists. Try logging in with:"
  echo "  Email:    $EMAIL"
  echo "  Password: (whatever you set when it was created)"
  echo "If you don't remember, set role to ADMIN and reset password via SQL or create a new user with a different email."
  exit 0
fi

echo "Request failed (HTTP $HTTP_CODE): $BODY"
exit 1
