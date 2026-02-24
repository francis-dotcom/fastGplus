-- ═══════════════════════════════════════════════════════════════════════════════
-- Database Initialization: Functions & Webhooks Tables (Simplified)
-- Runtime: Deno only
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Functions Table
-- Stores serverless function definitions (Deno runtime only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS functions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Metadata
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    code TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Function Status & Control
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deployment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    deployment_error TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Execution Configuration
    timeout_seconds INTEGER NOT NULL DEFAULT 30,
    
    -- Environment Variables (stored as JSONB)
    env_vars JSONB DEFAULT '{}'::jsonb,
    
    -- Execution Metrics
    execution_count INTEGER NOT NULL DEFAULT 0,
    execution_success_count INTEGER NOT NULL DEFAULT 0,
    execution_error_count INTEGER NOT NULL DEFAULT 0,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    avg_execution_time_ms INTEGER,
    
    -- Timestamps
    last_deployed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT functions_timeout_range CHECK (timeout_seconds >= 5 AND timeout_seconds <= 300),
    CONSTRAINT functions_deployment_status_valid CHECK (deployment_status IN ('pending', 'deployed', 'failed', 'undeployed'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Webhooks Table
-- Stores webhook configurations for external integrations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_id UUID NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Webhook Identity
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- External Integration Details
    provider VARCHAR(50),
    provider_event_type VARCHAR(255),
    
    -- Webhook Authentication
    webhook_token VARCHAR(255) NOT NULL UNIQUE,
    secret_key VARCHAR(255) NOT NULL,
    
    -- Enable/Disable Control
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Rate Limiting & Retry
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 100,
    retry_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    retry_attempts INTEGER NOT NULL DEFAULT 3,
    retry_delay_seconds INTEGER NOT NULL DEFAULT 60,
    
    -- Monitoring & Metrics
    last_received_at TIMESTAMP WITH TIME ZONE,
    last_delivery_status VARCHAR(20),
    successful_delivery_count INTEGER DEFAULT 0,
    failed_delivery_count INTEGER DEFAULT 0,
    total_delivery_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT webhooks_rate_limit_range CHECK (rate_limit_per_minute >= 1 AND rate_limit_per_minute <= 10000),
    CONSTRAINT webhooks_retry_attempts_range CHECK (retry_attempts >= 1 AND retry_attempts <= 10),
    CONSTRAINT webhooks_retry_delay_range CHECK (retry_delay_seconds >= 1 AND retry_delay_seconds <= 3600)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Function Executions Table
-- Stores execution history for function runs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS function_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_id UUID NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Trigger Information
    trigger_type VARCHAR(20) NOT NULL,
    webhook_delivery_id UUID,
    
    -- Execution State
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    
    -- Results & Errors
    result JSONB,
    error_message TEXT,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT function_executions_status_valid CHECK (status IN ('running', 'completed', 'failed', 'timeout')),
    CONSTRAINT function_executions_trigger_type_valid CHECK (trigger_type IN ('http', 'schedule', 'database', 'event', 'webhook', 'manual'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Webhook Deliveries Table
-- Audit trail for webhook deliveries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    function_id UUID NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
    
    -- Request Information
    source_ip VARCHAR(45),
    request_headers JSONB,
    request_body JSONB,
    
    -- Signature Verification
    signature_valid BOOLEAN,
    
    -- Execution Status
    status VARCHAR(20) NOT NULL DEFAULT 'received',
    delivery_attempt INTEGER NOT NULL DEFAULT 1,
    processing_started_at TIMESTAMP WITH TIME ZONE,
    function_execution_id UUID REFERENCES function_executions(id),
    execution_result JSONB,
    error_message TEXT,
    execution_time_ms INTEGER,
    response_status_code INTEGER,
    
    -- Retry Management
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT webhook_deliveries_status_valid CHECK (status IN ('received', 'queued', 'executing', 'completed', 'failed', 'retry_pending'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Function Logs Table
-- Log storage for function executions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS function_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES function_executions(id) ON DELETE CASCADE,
    function_id UUID NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
    
    -- Log Entry
    log_level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT function_logs_level_valid CHECK (log_level IN ('debug', 'info', 'warn', 'error'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Functions indexes
CREATE INDEX IF NOT EXISTS idx_functions_owner_id ON functions(owner_id);
CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
CREATE INDEX IF NOT EXISTS idx_functions_deployment_status ON functions(deployment_status);
CREATE INDEX IF NOT EXISTS idx_functions_is_active ON functions(is_active);
CREATE INDEX IF NOT EXISTS idx_functions_created_at ON functions(created_at DESC);

-- Webhooks indexes
CREATE INDEX IF NOT EXISTS idx_webhooks_function_id ON webhooks(function_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_owner_id ON webhooks(owner_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_webhook_token ON webhooks(webhook_token);
CREATE INDEX IF NOT EXISTS idx_webhooks_is_active ON webhooks(is_active);
CREATE INDEX IF NOT EXISTS idx_webhooks_created_at ON webhooks(created_at DESC);

-- Function executions indexes
CREATE INDEX IF NOT EXISTS idx_function_executions_function_id ON function_executions(function_id);
CREATE INDEX IF NOT EXISTS idx_function_executions_user_id ON function_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_function_executions_status ON function_executions(status);
CREATE INDEX IF NOT EXISTS idx_function_executions_trigger_type ON function_executions(trigger_type);
CREATE INDEX IF NOT EXISTS idx_function_executions_started_at ON function_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_executions_webhook_delivery_id ON function_executions(webhook_delivery_id);

-- Webhook deliveries indexes
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_function_id ON webhook_deliveries(function_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry_at ON webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- Function logs indexes
CREATE INDEX IF NOT EXISTS idx_function_logs_execution_id ON function_logs(execution_id);
CREATE INDEX IF NOT EXISTS idx_function_logs_function_id ON function_logs(function_id);
CREATE INDEX IF NOT EXISTS idx_function_logs_log_level ON function_logs(log_level);
CREATE INDEX IF NOT EXISTS idx_function_logs_timestamp ON function_logs(timestamp DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime triggers for Functions & Webhooks tables
-- Enable realtime notifications for dashboard subscriptions
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS functions_realtime_notify ON functions;
CREATE TRIGGER functions_realtime_notify
    AFTER INSERT OR UPDATE OR DELETE ON functions
    FOR EACH ROW
    EXECUTE FUNCTION realtime_notify();

DROP TRIGGER IF EXISTS webhooks_realtime_notify ON webhooks;
CREATE TRIGGER webhooks_realtime_notify
    AFTER INSERT OR UPDATE OR DELETE ON webhooks
    FOR EACH ROW
    EXECUTE FUNCTION realtime_notify();

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers for updated_at timestamps
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_functions_updated_at ON functions;
CREATE TRIGGER update_functions_updated_at
    BEFORE UPDATE ON functions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_webhooks_updated_at ON webhooks;
CREATE TRIGGER update_webhooks_updated_at
    BEFORE UPDATE ON webhooks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_function_executions_updated_at ON function_executions;
CREATE TRIGGER update_function_executions_updated_at
    BEFORE UPDATE ON function_executions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_webhook_deliveries_updated_at ON webhook_deliveries;
CREATE TRIGGER update_webhook_deliveries_updated_at
    BEFORE UPDATE ON webhook_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
