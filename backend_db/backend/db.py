from typing import AsyncGenerator
from pydantic_settings import BaseSettings, SettingsConfigDict
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncNullConnectionPool

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
class Settings(BaseSettings):
    # Connect to PgBouncer (port 6432) for connection pooling
    # NullConnectionPool delegates all pooling to PgBouncer - no double pooling!
    # In Docker: uses pgbouncer service name; Local dev: uses localhost
    DATABASE_URL: str  # Required - passed via docker-compose environment
    
    # Backup configuration - passed via docker-compose environment
    BACKUP_RETENTION_DAYS: int
    BACKUP_SCHEDULE_CRON: str
    
    # Direct database connection for pg_dump/pg_restore (bypasses pgbouncer)
    # All values passed via docker-compose environment section
    POSTGRES_HOST: str
    POSTGRES_PORT: int
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    
    # No env_file needed - all values come from docker-compose environment
    model_config = SettingsConfigDict(extra="ignore")

settings = Settings()


# ─────────────────────────────────────────────────────────────────────────────
# Database Connection
# ─────────────────────────────────────────────────────────────────────────────

# Global pool variable - using NullConnectionPool for PgBouncer compatibility
# NullConnectionPool creates connections on-demand and closes them immediately after use
# This delegates all connection pooling to PgBouncer, avoiding double-pooling issues
pool: AsyncNullConnectionPool | None = None


async def init_db() -> None:
    """Initialize the database connection.
    
    Using AsyncNullConnectionPool with PgBouncer:
    - No internal pooling - PgBouncer handles all connection management
    - Compatible with PgBouncer's transaction pooling mode
    - max_size limits concurrent connections to prevent overwhelming PgBouncer
    - No prepared statement issues (psycopg3 doesn't use server-side prepared statements by default)
    
    Note: Table creation, indexes, and seeding are handled by PostgreSQL's
    /docker-entrypoint-initdb.d/ scripts. This function only sets up the connection.
    """
    global pool
    pool = AsyncNullConnectionPool(
        conninfo=settings.DATABASE_URL,
        open=False,  # Don't open on creation, we'll open explicitly
        max_size=100,  # Limit concurrent connections
        # Configure connection defaults
        kwargs={
            "row_factory": dict_row,  # Return rows as dicts for easier access
            "autocommit": False,
        }
    )
    await pool.open()
    
    # Verify database is initialized by checking if system_config table exists
    async with pool.connection() as conn:
        result = await conn.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'system_config'
            );
        """)
        row = await result.fetchone()
        if not row or not row.get('exists', False):
            raise RuntimeError(
                "Database not initialized. Ensure PostgreSQL init scripts have run. "
                "Check /docker-entrypoint-initdb.d/ scripts."
            )


async def close_db() -> None:
    """Close the database connection pool."""
    global pool
    if pool:
        await pool.close()


async def get_db() -> AsyncGenerator[psycopg.AsyncConnection, None]:
    """Dependency to get a database connection from the pool."""
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    
    async with pool.connection() as conn:
        yield conn


# ─────────────────────────────────────────────────────────────────────────────
# RLS Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

async def set_jwt_claims(conn: psycopg.AsyncConnection, user_id: str | None, role: str | None) -> None:
    """
    Set JWT claims in the PostgreSQL session for RLS policies.
    
    This sets the request.jwt.claims.user_id and request.jwt.claims.role
    session variables that auth.uid() and auth.role() functions read.
    
    Args:
        conn: The database connection
        user_id: The user's UUID as a string (or None for anonymous)
        role: The user's role (e.g., 'USER', 'ADMIN', or None for anonymous)
    """
    # Set user_id claim
    if user_id:
        await conn.execute(
            "SELECT set_config('request.jwt.claims.user_id', %s, TRUE)",
            (user_id,)
        )
    else:
        await conn.execute(
            "SELECT set_config('request.jwt.claims.user_id', '', TRUE)"
        )
    
    # Set role claim
    if role:
        await conn.execute(
            "SELECT set_config('request.jwt.claims.role', %s, TRUE)",
            (role,)
        )
    else:
        await conn.execute(
            "SELECT set_config('request.jwt.claims.role', '', TRUE)"
        )
