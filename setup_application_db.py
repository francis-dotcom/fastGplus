import requests
import json
import os

API_URL = "https://grandpluscollege.com/api"
API_KEY = "selfdb-bd66637d-60dc-cf8a-a1aa-037f1b37d7b9"
ADMIN_EMAIL = "femioginos@gmail.com"
ADMIN_PASSWORD = "4211"

def get_token():
    print("Logging in...")
    resp = requests.post(f"{API_URL}/users/token", data={
        "username": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }, headers={"X-API-Key": API_KEY})
    resp.raise_for_status()
    return resp.json()["access_token"]

def execute_sql(token, query):
    print(f"Executing SQL: {query[:50]}...")
    resp = requests.post(f"{API_URL}/sql/query", json={"query": query}, headers={
        "Authorization": f"Bearer {token}",
        "X-API-Key": API_KEY
    })
    resp.raise_for_status()
    return resp.json()

def main():
    token = get_token()
    
    # 1. Update applications table
    # We drop and recreate to ensure schema is exactly what we want
    sql = """
    DROP TABLE IF EXISTS applications CASCADE;
    CREATE TABLE IF NOT EXISTS applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        date_of_birth DATE,
        permanent_address TEXT,
        faculty VARCHAR(255),
        program_applied VARCHAR(255) NOT NULL,
        study_mode VARCHAR(50),
        intake VARCHAR(50),
        highest_qualification VARCHAR(255),
        institution_name VARCHAR(255),
        graduation_year INTEGER,
        gpa VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Ensure it's in the registry
    DELETE FROM tables WHERE name = 'applications';
    INSERT INTO tables (id, name, table_schema, public, owner_id, description, realtime_enabled)
    VALUES (
        gen_random_uuid(), 
        'applications', 
        '{"full_name": {"type": "TEXT"}, "email": {"type": "TEXT"}, "program_applied": {"type": "TEXT"}}'::jsonb, 
        true, 
        (SELECT id FROM users WHERE email = 'femioginos@gmail.com' LIMIT 1), 
        'Student application records', 
        true
    );
    """
    execute_sql(token, sql)
    
    # 2. Get the table ID
    res = execute_sql(token, "SELECT id FROM tables WHERE name = 'applications'")
    table_id = res["data"][0]["id"]
    print(f"\nSUCCESS! Applications Table ID: {table_id}")

if __name__ == "__main__":
    main()
