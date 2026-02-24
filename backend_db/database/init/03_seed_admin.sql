-- ═══════════════════════════════════════════════════════════════════════════════
-- Database Initialization: Seed Admin User
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- This script seeds the initial admin user using environment variables.
-- The password is hashed using PostgreSQL's pgcrypto extension with bcrypt.
-- This generates a hash compatible with pwdlib/BcryptHasher used in the backend.
--
-- Environment variables used:
--   ADMIN_EMAIL - Admin user email
--   ADMIN_PASSWORD - Plain text admin password (will be hashed with bcrypt)
--   ADMIN_FIRST_NAME - Admin first name (optional, defaults to 'Admin')
--   ADMIN_LAST_NAME - Admin last name (optional, defaults to 'User')
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    admin_id UUID := gen_random_uuid();
    admin_email TEXT := current_setting('app.admin_email', true);
    admin_password TEXT := current_setting('app.admin_password', true);
    admin_first_name TEXT := current_setting('app.admin_first_name', true);
    admin_last_name TEXT := current_setting('app.admin_last_name', true);
    hashed_password TEXT;
BEGIN
    -- Validate required environment variables
    IF admin_email IS NULL OR admin_email = '' THEN
        RAISE EXCEPTION 'ADMIN_EMAIL environment variable is required';
    END IF;
    
    IF admin_password IS NULL OR admin_password = '' THEN
        RAISE EXCEPTION 'ADMIN_PASSWORD environment variable is required';
    END IF;
    
    IF admin_first_name IS NULL OR admin_first_name = '' THEN
        RAISE EXCEPTION 'ADMIN_FIRST_NAME environment variable is required';
    END IF;
    
    IF admin_last_name IS NULL OR admin_last_name = '' THEN
        RAISE EXCEPTION 'ADMIN_LAST_NAME environment variable is required';
    END IF;

    -- Only insert if admin user doesn't exist
    IF NOT EXISTS (SELECT 1 FROM users WHERE email = admin_email) THEN
        
        -- Hash the password using bcrypt via pgcrypto
        -- gen_salt('bf', 10) generates a bcrypt salt with cost factor 10
        -- This produces a hash compatible with pwdlib/BcryptHasher(rounds=10)
        hashed_password := crypt(admin_password, gen_salt('bf', 10));
        
        INSERT INTO users (id, email, password, first_name, last_name, role, is_active)
        VALUES (
            admin_id,
            admin_email,
            hashed_password,
            admin_first_name,
            admin_last_name,
            'ADMIN',
            TRUE
        );
        
        RAISE NOTICE 'Admin user created: %', admin_email;
    ELSE
        RAISE NOTICE 'Admin user already exists: %', admin_email;
    END IF;
END $$;
