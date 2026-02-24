-- ═══════════════════════════════════════════════════════════════════════════════
-- Database Initialization: Create Tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- System Configuration Table
-- Tracks initialization state and version
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    initialized BOOLEAN NOT NULL DEFAULT FALSE,
    installed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    version VARCHAR(50) DEFAULT '1.0.0',
    CONSTRAINT single_row CHECK (id = 1)
);

-- Insert default system_config if not exists
INSERT INTO system_config (id, initialized, version)
VALUES (1, FALSE, '1.0.0')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Users Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'USER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables Table
-- Stores metadata about user-created dynamic tables
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tables (
    id UUID PRIMARY KEY,
    name VARCHAR(63) UNIQUE NOT NULL,
    table_schema JSONB NOT NULL,
    public BOOLEAN NOT NULL DEFAULT FALSE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description VARCHAR(500),
    metadata JSONB DEFAULT '{}'::jsonb,
    row_count INTEGER DEFAULT 0,
    realtime_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SQL Query History Table
-- Stores executed SQL queries for history tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sql_history (
    id UUID PRIMARY KEY,
    query TEXT NOT NULL,
    is_read_only BOOLEAN NOT NULL DEFAULT TRUE,
    execution_time FLOAT NOT NULL DEFAULT 0.0,
    row_count INTEGER DEFAULT 0,
    error TEXT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SQL Snippets Table
-- Stores saved SQL code snippets for reuse
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sql_snippets (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sql_code TEXT NOT NULL,
    description TEXT,
    is_shared BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage Buckets Table
-- Stores metadata about storage buckets (containers for files)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buckets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(63) UNIQUE NOT NULL,
    public BOOLEAN NOT NULL DEFAULT FALSE,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    file_count INTEGER DEFAULT 0,
    total_size BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- S3-compatible bucket naming: lowercase, alphanumeric, hyphens, 3-63 chars
    CONSTRAINT bucket_name_valid CHECK (name ~ '^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage Files Table
-- Stores metadata about files (actual blobs stored in storage service)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id UUID NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    path VARCHAR(1000) NOT NULL,
    size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    checksum_sha256 VARCHAR(64),
    version INTEGER NOT NULL DEFAULT 1,
    is_latest BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
