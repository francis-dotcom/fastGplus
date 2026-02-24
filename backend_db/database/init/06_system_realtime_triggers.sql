-- ═══════════════════════════════════════════════════════════════════════════════
-- System Tables Realtime Triggers
-- Enable realtime notifications for system tables (users, tables)
-- These triggers are always ON for the dashboard to show live updates
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger for users table
-- Broadcasts: INSERT, UPDATE, DELETE events to channel "table:users"
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS users_realtime_notify ON users;
CREATE TRIGGER users_realtime_notify
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION realtime_notify();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger for tables table
-- Broadcasts: INSERT, DELETE events to channel "table:tables"
-- NOTE: UPDATE is excluded to prevent duplicate events when row_count or
-- metadata is updated (each table creation + row insert would fire 2 events)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tables_realtime_notify ON tables;
CREATE TRIGGER tables_realtime_notify
    AFTER INSERT OR DELETE ON tables
    FOR EACH ROW
    EXECUTE FUNCTION realtime_notify();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger for buckets table
-- Broadcasts: INSERT, UPDATE, DELETE events to channel "table:buckets"
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS buckets_realtime_notify ON buckets;
CREATE TRIGGER buckets_realtime_notify
    AFTER INSERT OR UPDATE OR DELETE ON buckets
    FOR EACH ROW
    EXECUTE FUNCTION realtime_notify();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger for files table
-- Broadcasts: INSERT, UPDATE, DELETE events to channel "table:files"
-- Enables real-time file upload/delete notifications
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS files_realtime_notify ON files;
CREATE TRIGGER files_realtime_notify
    AFTER INSERT OR UPDATE OR DELETE ON files
    FOR EACH ROW
    EXECUTE FUNCTION realtime_notify();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification: List created triggers
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    RAISE NOTICE 'System realtime triggers created:';
    RAISE NOTICE '  - users_realtime_notify on users table';
    RAISE NOTICE '  - tables_realtime_notify on tables table';
    RAISE NOTICE '  - buckets_realtime_notify on buckets table';
    RAISE NOTICE '  - files_realtime_notify on files table';
END $$;
