-- ═══════════════════════════════════════════════════════════════════════════════
-- Grand Plus College: Database Schema
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Applications Table
-- Stores student personal, academic, and application details
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    nationality VARCHAR(100),
    program_applied VARCHAR(255) NOT NULL, -- The specific program name
    academic_history JSONB DEFAULT '[]'::jsonb, -- Array of prior school objects
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, UNDER_REVIEW, APPROVED, REJECTED
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Application Documents Table
-- Tracks student document uploads linked to an application
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS application_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL, -- Passport, Transcript, CV, etc.
    file_id UUID NOT NULL, -- Refers to the 'files' table in storage service
    file_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Payments Table
-- Records fees paid by students
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    student_email VARCHAR(255) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    transaction_id VARCHAR(255) UNIQUE NOT NULL, -- From common payment gateways
    payment_method VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED', -- COMPLETED, FAILED, REFUNDED
    metadata JSONB DEFAULT '{}'::jsonb,
    paid_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime & Security Configuration
-- Enable realtime for state updates and security for public access (per project needs)
-- ─────────────────────────────────────────────────────────────────────────────

-- Register these as system tables if SELFDB's admin UI should manage them automatically
-- Note: SELFDB typically discovers tables via its internal 'tables' registry.
-- For now, we seed the registry so the Admin Dashboard sees them.

INSERT INTO tables (id, name, table_schema, public, owner_id, description, realtime_enabled)
SELECT 
    gen_random_uuid(), 
    'applications', 
    '{}'::jsonb, 
    true, 
    (SELECT id FROM users LIMIT 1), 
    'Student application records', 
    true
ON CONFLICT (name) DO NOTHING;

INSERT INTO tables (id, name, table_schema, public, owner_id, description, realtime_enabled)
SELECT 
    gen_random_uuid(), 
    'payments', 
    '{}'::jsonb, 
    true, 
    (SELECT id FROM users LIMIT 1), 
    'Student payment records', 
    true
ON CONFLICT (name) DO NOTHING;
