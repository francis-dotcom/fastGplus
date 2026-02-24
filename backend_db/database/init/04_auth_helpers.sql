-- ═══════════════════════════════════════════════════════════════════════════════
-- Auth Helper Functions for RLS
-- Provides Supabase-compatible auth.uid() and auth.role() functions
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create auth schema if not exists
CREATE SCHEMA IF NOT EXISTS auth;

-- ─────────────────────────────────────────────────────────────────────────────
-- auth.uid() - Returns the current user's UUID from session claims
-- Usage in RLS policies: auth.uid() = owner_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claims.user_id', TRUE), '')::UUID
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- auth.role() - Returns the current user's role from session claims
-- Usage in RLS policies: auth.role() = 'ADMIN'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claims.role', TRUE), '')
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grant execute permissions to public (all users can use these in RLS)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
