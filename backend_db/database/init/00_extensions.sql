-- ═══════════════════════════════════════════════════════════════════════════════
-- Database Initialization: Enable Extensions
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable pgcrypto for password hashing with crypt() and gen_salt()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
