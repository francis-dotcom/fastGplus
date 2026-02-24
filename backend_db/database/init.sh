#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Database Initialization Script
# ═══════════════════════════════════════════════════════════════════════════════
# This script runs on PostgreSQL container startup via /docker-entrypoint-initdb.d/
# It auto-discovers and executes SQL files in order from init/ and migrations/.
# ═══════════════════════════════════════════════════════════════════════════════

set -e

INIT_DIR="/docker-entrypoint-initdb.d/init"
MIGRATIONS_DIR="/docker-entrypoint-initdb.d/migrations"

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "Starting database initialization..."
echo "═══════════════════════════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────────
# Auto-discover and run all SQL files in init/ folder (sorted by filename)
# Special handling for 03_seed_admin.sql which needs environment variables
# ─────────────────────────────────────────────────────────────────────────────
if [ -d "$INIT_DIR" ]; then
    echo "Processing init scripts..."
    
    for sql_file in $(ls -1 "$INIT_DIR"/*.sql 2>/dev/null | sort); do
        filename=$(basename "$sql_file")
        echo "Executing: $filename"
        
        # Special handling for admin seeding script - needs environment variables
        if [[ "$filename" == "03_seed_admin.sql" ]]; then
            psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
                -c "SET app.admin_email = '$ADMIN_EMAIL';" \
                -c "SET app.admin_password = '$ADMIN_PASSWORD';" \
                -c "SET app.admin_first_name = '$ADMIN_FIRST_NAME';" \
                -c "SET app.admin_last_name = '$ADMIN_LAST_NAME';" \
                -f "$sql_file"
        else
            psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$sql_file"
        fi
        
        echo "  ✓ $filename completed"
    done
else
    echo "No init directory found, skipping..."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Auto-discover and run all SQL files in migrations/ folder (sorted by filename)
# ─────────────────────────────────────────────────────────────────────────────
if [ -d "$MIGRATIONS_DIR" ] && [ "$(ls -A "$MIGRATIONS_DIR"/*.sql 2>/dev/null)" ]; then
    echo ""
    echo "Processing migrations..."
    
    for migration in $(ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
        filename=$(basename "$migration")
        echo "Applying migration: $filename"
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$migration"
        echo "  ✓ $filename completed"
    done
else
    echo ""
    echo "No migrations found, skipping..."
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "Database initialization completed successfully!"
echo "═══════════════════════════════════════════════════════════════════════════════"
