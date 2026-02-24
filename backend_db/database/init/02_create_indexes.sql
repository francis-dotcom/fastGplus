-- ═══════════════════════════════════════════════════════════════════════════════
-- Database Initialization: Create Indexes
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Index on owner_id for faster queries when filtering by owner
CREATE INDEX IF NOT EXISTS idx_tables_owner_id ON tables(owner_id);

-- Index on public flag for faster public table queries
CREATE INDEX IF NOT EXISTS idx_tables_public ON tables(public) WHERE public = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Users Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Index on email for faster lookups (already has UNIQUE constraint, but explicit index helps)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index on role for filtering by user role
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ─────────────────────────────────────────────────────────────────────────────
-- SQL History Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Index on user_id for faster history retrieval per user
CREATE INDEX IF NOT EXISTS idx_sql_history_user_id ON sql_history(user_id);

-- Index on executed_at for ordering by time
CREATE INDEX IF NOT EXISTS idx_sql_history_executed_at ON sql_history(executed_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SQL Snippets Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Index on created_by for faster snippet retrieval per user
CREATE INDEX IF NOT EXISTS idx_sql_snippets_created_by ON sql_snippets(created_by);

-- Index on is_shared for finding shared snippets
CREATE INDEX IF NOT EXISTS idx_sql_snippets_shared ON sql_snippets(is_shared) WHERE is_shared = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Buckets Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Index on owner_id for filtering buckets by owner
CREATE INDEX IF NOT EXISTS idx_buckets_owner_id ON buckets(owner_id);

-- Index on public flag for listing public buckets
CREATE INDEX IF NOT EXISTS idx_buckets_public ON buckets(public) WHERE public = TRUE;

-- Index on created_at for ordering
CREATE INDEX IF NOT EXISTS idx_buckets_created_at ON buckets(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Files Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Index on bucket_id for listing files in a bucket
CREATE INDEX IF NOT EXISTS idx_files_bucket_id ON files(bucket_id);

-- Index on owner_id for filtering files by owner
CREATE INDEX IF NOT EXISTS idx_files_owner_id ON files(owner_id);

-- Index on path for file lookups (commonly searched)
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

-- Index on mime_type for filtering by file type
CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type);

-- Index on deleted_at for soft delete queries (find non-deleted files)
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at) WHERE deleted_at IS NULL;

-- Index on is_latest for finding current versions
CREATE INDEX IF NOT EXISTS idx_files_is_latest ON files(is_latest) WHERE is_latest = TRUE;

-- Index on created_at for ordering
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);

-- Composite index for common query: bucket + path lookup
CREATE INDEX IF NOT EXISTS idx_files_bucket_path ON files(bucket_id, path);

-- Partial unique index: enforce unique bucket + path for latest non-deleted files
-- This replaces the table constraint which can't use WHERE clause
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_unique_path ON files(bucket_id, path) 
    WHERE is_latest = TRUE AND deleted_at IS NULL;
