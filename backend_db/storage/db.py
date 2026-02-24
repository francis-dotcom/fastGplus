# db.py - Database connection for Storage Service
# Connects to PgBouncer for file/bucket metadata operations

from typing import AsyncGenerator
from contextlib import asynccontextmanager
import os
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncNullConnectionPool


# ─────────────────────────────────────────────────────────────────────────────
# Configuration (from environment variables set by docker-compose)
# ─────────────────────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL")

# Global pool - NullConnectionPool delegates pooling to PgBouncer
pool: AsyncNullConnectionPool | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Database Lifecycle
# ─────────────────────────────────────────────────────────────────────────────

async def init_db() -> None:
    """Initialize database connection pool."""
    global pool
    
    if not DATABASE_URL:
        # Running without database (standalone mode for testing)
        return
    
    pool = AsyncNullConnectionPool(
        conninfo=DATABASE_URL,
        open=False,
        max_size=50,  # Lower than backend since storage is internal only
        kwargs={
            "row_factory": dict_row,
            "autocommit": False,
        }
    )
    await pool.open()
    
    # Verify connection
    async with pool.connection() as conn:
        result = await conn.execute("SELECT 1 as check")
        await result.fetchone()


async def close_db() -> None:
    """Close database connection pool."""
    global pool
    if pool:
        await pool.close()
        pool = None


async def get_db() -> AsyncGenerator[psycopg.AsyncConnection, None]:
    """Dependency to get a database connection."""
    if pool is None:
        raise RuntimeError("Database pool not initialized. Set DATABASE_URL environment variable.")
    
    async with pool.connection() as conn:
        yield conn


def is_db_configured() -> bool:
    """Check if database is configured."""
    return DATABASE_URL is not None and pool is not None
