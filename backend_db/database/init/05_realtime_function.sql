-- ═══════════════════════════════════════════════════════════════════════════════
-- Realtime Notify Function
-- Trigger function that broadcasts changes via pg_notify for realtime subscriptions
-- Channel format: table:<tablename>
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- realtime_notify() - Trigger function for broadcasting table changes
-- 
-- Payload format:
-- {
--   "event": "INSERT" | "UPDATE" | "DELETE",
--   "table": "<table_name>",
--   "new": { ...row data... } | null,
--   "old": { ...row data... } | null
-- }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION realtime_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    channel TEXT;
    payload JSONB;
    record_new JSONB;
    record_old JSONB;
BEGIN
    -- Channel format: table:<tablename>
    channel := 'table:' || TG_TABLE_NAME;
    
    -- Build the payload based on operation type
    IF TG_OP = 'INSERT' THEN
        record_new := to_jsonb(NEW);
        payload := jsonb_build_object(
            'event', TG_OP,
            'table', TG_TABLE_NAME,
            'new', record_new,
            'old', NULL
        );
    ELSIF TG_OP = 'UPDATE' THEN
        record_new := to_jsonb(NEW);
        record_old := to_jsonb(OLD);
        payload := jsonb_build_object(
            'event', TG_OP,
            'table', TG_TABLE_NAME,
            'new', record_new,
            'old', record_old
        );
    ELSIF TG_OP = 'DELETE' THEN
        record_old := to_jsonb(OLD);
        payload := jsonb_build_object(
            'event', TG_OP,
            'table', TG_TABLE_NAME,
            'new', NULL,
            'old', record_old
        );
    END IF;
    
    -- Broadcast to the channel
    PERFORM pg_notify(channel, payload::TEXT);
    
    -- Return appropriate record
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper function to enable realtime on a table
-- Creates the trigger that calls realtime_notify()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enable_realtime_for_table(table_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    trigger_name TEXT;
BEGIN
    trigger_name := 'realtime_' || table_name || '_trigger';
    
    -- Drop existing trigger if it exists
    EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON %I',
        trigger_name,
        table_name
    );
    
    -- Create the trigger
    EXECUTE format(
        'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION realtime_notify()',
        trigger_name,
        table_name
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper function to disable realtime on a table
-- Removes the trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION disable_realtime_for_table(table_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    trigger_name TEXT;
BEGIN
    trigger_name := 'realtime_' || table_name || '_trigger';
    
    EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON %I',
        trigger_name,
        table_name
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grant execute permissions
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION realtime_notify() TO PUBLIC;
GRANT EXECUTE ON FUNCTION enable_realtime_for_table(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION disable_realtime_for_table(TEXT) TO PUBLIC;
