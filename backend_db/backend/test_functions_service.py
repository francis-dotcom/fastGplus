#!/usr/bin/env python3
"""
Functions Service Test Script

Tests the serverless functions endpoints via the backend API.
The functions service is internal (Docker network only) - all access goes through backend.

Usage:
    cd backend
    python test_functions_service.py

    # Or with uv
    uv run python test_functions_service.py

Prerequisites:
    - All services running via docker compose
    - Backend accessible at http://localhost:8000
"""

import os
import sys
import time
import json
import uuid
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from pathlib import Path
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Load environment from .env file
ENV_FILE = Path(__file__).parent.parent / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    raise SystemExit("❌ API_KEY not found in environment. Please set it in .env file.")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password")

# Headers
API_HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}


def get_auth_headers(token: str) -> Dict[str, str]:
    """Return headers with Bearer token and API key."""
    return {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }


def print_result(test_name: str, passed: bool, details: str = ""):
    """Print test result with formatting."""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} | {test_name}")
    if details:
        print(f"       └─ {details}")


def print_section(title: str):
    """Print section header."""
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}\n")


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def admin_login() -> Optional[str]:
    """Login as admin and return access token."""
    try:
        resp = requests.post(
            f"{BACKEND_URL}/users/token",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers=API_HEADERS,
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json().get("access_token")
        print(f"Admin login failed: {resp.status_code} - {resp.text}")
        return None
    except Exception as e:
        print(f"Admin login error: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Test: Backend Functions API (CRUD via Backend)
# ─────────────────────────────────────────────────────────────────────────────

def test_backend_functions_api():
    """Test functions CRUD via backend API (Admin only)."""
    print_section("Backend Functions API (Admin CRUD)")
    
    # Get admin token
    token = admin_login()
    if not token:
        print_result("Admin Login", False, "Could not authenticate as admin")
        return False
    
    print_result("Admin Login", True, f"Token acquired")
    
    headers = get_auth_headers(token)
    function_id = None
    function_name = f"test-func-{int(time.time())}"
    
    # Simple TypeScript function code
    function_code = '''
export default async function handler(req, ctx) {
  const body = await req.json().catch(() => ({}));
  console.log("[LOG] Function executed with body:", JSON.stringify(body));
  return new Response(JSON.stringify({ 
    message: "Hello from SelfDB function!",
    received: body,
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

export const triggers = [
  { type: "http", method: ["GET", "POST"] }
];
'''
    
    # 1) List functions
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/",
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 200
        if passed:
            data = resp.json()
            print_result("GET /functions/", True, f"Total: {data.get('total', 0)} functions")
        else:
            print_result("GET /functions/", False, f"Status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print_result("GET /functions/", False, str(e))
    
    # 2) Create function
    try:
        payload = {
            "name": function_name,
            "code": function_code,
            "description": "Test function created by test script",
            "timeout_seconds": 30,
            "env_vars": {"TEST_VAR": "test-value"}
        }
        resp = requests.post(
            f"{BACKEND_URL}/functions/",
            json=payload,
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 201
        if passed:
            data = resp.json()
            function_id = data.get("id")
            print_result("POST /functions/", True, f"Created: {function_name} (id={function_id})")
        else:
            print_result("POST /functions/", False, f"Status: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print_result("POST /functions/", False, str(e))
        return False
    
    # 3) Get function by ID
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/{function_id}",
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 200
        if passed:
            data = resp.json()
            print_result(
                f"GET /functions/{{{function_id}}}",
                True,
                f"deployment_status={data.get('deployment_status')}"
            )
        else:
            print_result(f"GET /functions/{{{function_id}}}", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result(f"GET /functions/{{{function_id}}}", False, str(e))
    
    # 4) Update function
    try:
        update_payload = {"description": "Updated description from test script"}
        resp = requests.patch(
            f"{BACKEND_URL}/functions/{function_id}",
            json=update_payload,
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 200
        if passed:
            print_result(f"PATCH /functions/{{{function_id}}}", True, "Description updated")
        else:
            print_result(f"PATCH /functions/{{{function_id}}}", False, f"Status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print_result(f"PATCH /functions/{{{function_id}}}", False, str(e))
    
    # 5) Update environment variables
    try:
        env_payload = {"env_vars": {"TEST_VAR": "updated-value", "NEW_VAR": "new-value"}}
        resp = requests.put(
            f"{BACKEND_URL}/functions/{function_id}/env",
            json=env_payload,
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 200
        if passed:
            print_result(f"PUT /functions/{{{function_id}}}/env", True, "Env vars updated")
        else:
            print_result(f"PUT /functions/{{{function_id}}}/env", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result(f"PUT /functions/{{{function_id}}}/env", False, str(e))
    
    # 6) Deploy function (backend proxies to internal functions service)
    try:
        resp = requests.post(
            f"{BACKEND_URL}/functions/{function_id}/deploy",
            headers=headers,
            timeout=30
        )
        passed = resp.status_code == 200
        if passed:
            data = resp.json()
            print_result(
                f"POST /functions/{{{function_id}}}/deploy",
                True,
                f"deployment_status={data.get('deployment_status')}"
            )
        else:
            print_result(f"POST /functions/{{{function_id}}}/deploy", False, f"Status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print_result(f"POST /functions/{{{function_id}}}/deploy", False, str(e))
    
    # 7) Get executions (should be empty)
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/{function_id}/executions",
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 200
        if passed:
            data = resp.json()
            print_result(
                f"GET /functions/{{{function_id}}}/executions",
                True,
                f"Total: {data.get('total', 0)} executions"
            )
        else:
            print_result(f"GET /functions/{{{function_id}}}/executions", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result(f"GET /functions/{{{function_id}}}/executions", False, str(e))
    
    # 8) Get logs (should be empty)
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/{function_id}/logs",
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 200
        if passed:
            data = resp.json()
            print_result(
                f"GET /functions/{{{function_id}}}/logs",
                True,
                f"Total: {data.get('total', 0)} logs"
            )
        else:
            print_result(f"GET /functions/{{{function_id}}}/logs", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result(f"GET /functions/{{{function_id}}}/logs", False, str(e))
    
    # 9) Delete function
    try:
        resp = requests.delete(
            f"{BACKEND_URL}/functions/{function_id}",
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 204
        if passed:
            print_result(f"DELETE /functions/{{{function_id}}}", True, "Function deleted")
        else:
            print_result(f"DELETE /functions/{{{function_id}}}", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result(f"DELETE /functions/{{{function_id}}}", False, str(e))
    
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Test: Execution Result Callback
# ─────────────────────────────────────────────────────────────────────────────

def test_execution_result_callback():
    """Test execution result callback endpoint (internal endpoint from Deno)."""
    print_section("Execution Result Callback")
    
    # This is the internal endpoint the Deno runtime calls back to report results
    # It doesn't require auth (internal service communication)
    
    function_name = "nonexistent-function"
    
    # 1) Test with nonexistent function (should return warning but 200)
    try:
        payload = {
            "execution_id": str(uuid.uuid4()),
            "function_name": function_name,
            "success": True,
            "result": {"message": "Test result"},
            "logs": ["[LOG] Test log message"],
            "execution_time_ms": 125.5,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        resp = requests.post(
            f"{BACKEND_URL}/functions/{function_name}/execution-result",
            json=payload,
            headers=API_HEADERS,
            timeout=10
        )
        passed = resp.status_code == 200
        if passed:
            data = resp.json()
            print_result(
                f"POST /functions/{{{function_name}}}/execution-result",
                True,
                f"received={data.get('received')}, warning={data.get('warning', 'none')}"
            )
        else:
            print_result(
                f"POST /functions/{{{function_name}}}/execution-result",
                False,
                f"Status: {resp.status_code} - {resp.text}"
            )
    except Exception as e:
        print_result(f"POST /functions/{{{function_name}}}/execution-result", False, str(e))
    
    # 2) Test with invalid success type (should return 422 after StrictBool fix)
    try:
        payload = {
            "execution_id": str(uuid.uuid4()),
            "function_name": function_name,
            "success": 0,  # Invalid: should be boolean, not int
            "result": {"message": "Test result"},
            "logs": ["[LOG] Test log message"],
            "execution_time_ms": 125.5,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        resp = requests.post(
            f"{BACKEND_URL}/functions/{function_name}/execution-result",
            json=payload,
            headers=API_HEADERS,
            timeout=10
        )
        passed = resp.status_code == 422  # Validation error expected
        if passed:
            print_result(
                "POST execution-result (invalid success=0)",
                True,
                "Correctly rejected with 422 validation error"
            )
        else:
            print_result(
                "POST execution-result (invalid success=0)",
                False,
                f"Expected 422, got: {resp.status_code} - {resp.text}"
            )
    except Exception as e:
        print_result("POST execution-result (invalid success=0)", False, str(e))
    
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Test: End-to-End Function Lifecycle
# ─────────────────────────────────────────────────────────────────────────────

def test_function_lifecycle_e2e():
    """Test complete function lifecycle: Create -> Deploy -> Simulate Execution -> Verify Metrics -> Delete."""
    print_section("End-to-End Function Lifecycle")
    
    token = admin_login()
    if not token:
        print_result("Admin Login", False, "Could not authenticate as admin")
        return False
    
    headers = get_auth_headers(token)
    function_name = f"e2e-test-{int(time.time())}"
    function_id = None
    
    # Simple function that echoes input
    function_code = '''
export default async function handler(req, ctx) {
  const body = await req.json().catch(() => ({}));
  console.log("[LOG] E2E test function executed");
  console.log("[LOG] Received:", JSON.stringify(body));
  return new Response(JSON.stringify({ 
    echo: body,
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

export const triggers = [
  { type: "http", method: ["GET", "POST"] }
];
'''
    
    # 1) Create function via backend
    try:
        payload = {
            "name": function_name,
            "code": function_code,
            "description": "E2E test function"
        }
        resp = requests.post(
            f"{BACKEND_URL}/functions/",
            json=payload,
            headers=headers,
            timeout=10
        )
        if resp.status_code == 201:
            data = resp.json()
            function_id = data.get("id")
            print_result("1. Create function", True, f"id={function_id}")
        else:
            print_result("1. Create function", False, f"Status: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print_result("1. Create function", False, str(e))
        return False
    
    # 2) Deploy function (backend proxies to internal Deno service)
    try:
        resp = requests.post(
            f"{BACKEND_URL}/functions/{function_id}/deploy",
            headers=headers,
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            deployment_status = data.get('deployment_status')
            print_result("2. Deploy function", True, f"status={deployment_status}")
            if deployment_status == 'failed':
                print(f"       └─ Deployment error: {data.get('deployment_error')}")
        else:
            print_result("2. Deploy function", False, f"Status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print_result("2. Deploy function", False, str(e))
    
    # Wait for deployment
    time.sleep(2)
    
    # 3) Simulate execution result (as if Deno runtime called back)
    # Since functions service is internal, we simulate the callback
    try:
        callback_payload = {
            "execution_id": str(uuid.uuid4()),
            "function_name": function_name,
            "success": True,
            "result": {"echo": {"message": "Hello from E2E test"}, "timestamp": datetime.now(timezone.utc).isoformat()},
            "logs": ["[LOG] E2E test function executed", "[LOG] Received: {\"message\":\"Hello from E2E test\"}"],
            "execution_time_ms": 42.5,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        resp = requests.post(
            f"{BACKEND_URL}/functions/{function_name}/execution-result",
            json=callback_payload,
            headers=API_HEADERS,
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            print_result("3. Simulate execution callback", True, f"execution_id={data.get('execution_id')}")
        else:
            print_result("3. Simulate execution callback", False, f"Status: {resp.status_code} - {resp.text}")
    except Exception as e:
        print_result("3. Simulate execution callback", False, str(e))
    
    # Wait for metrics update
    time.sleep(1)
    
    # 4) Check function metrics updated
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/{function_id}",
            headers=headers,
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            exec_count = data.get("execution_count", 0)
            print_result(
                "4. Check metrics",
                exec_count > 0,
                f"execution_count={exec_count}, last_executed_at={data.get('last_executed_at')}"
            )
        else:
            print_result("4. Check metrics", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result("4. Check metrics", False, str(e))
    
    # 5) Check executions logged
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/{function_id}/executions",
            headers=headers,
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            total = data.get("total", 0)
            print_result("5. Check executions", total > 0, f"total={total} executions logged")
        else:
            print_result("5. Check executions", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result("5. Check executions", False, str(e))
    
    # 6) Check logs captured
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/{function_id}/logs",
            headers=headers,
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            total = data.get("total", 0)
            print_result("6. Check logs", total > 0, f"total={total} logs captured")
        else:
            print_result("6. Check logs", False, f"Status: {resp.status_code}")
    except Exception as e:
        print_result("6. Check logs", False, str(e))
    
    # 7) Delete function
    try:
        resp = requests.delete(
            f"{BACKEND_URL}/functions/{function_id}",
            headers=headers,
            timeout=10
        )
        passed = resp.status_code == 204
        print_result("7. Delete function", passed, "Cleanup complete" if passed else f"Status: {resp.status_code}")
    except Exception as e:
        print_result("7. Delete function", False, str(e))
    
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Test: Non-Admin Access Denied
# ─────────────────────────────────────────────────────────────────────────────

def test_non_admin_access_denied():
    """Test that non-admin users cannot access functions endpoints."""
    print_section("Non-Admin Access Control")
    
    # Create a regular user
    unique_id = str(uuid.uuid4())[:8]
    email = f"regularuser-{unique_id}@test.com"
    password = "TestPass123!"
    
    # 1) Create regular user
    try:
        payload = {
            "email": email,
            "password": password,
            "firstName": "Regular",
            "lastName": "User"
        }
        resp = requests.post(
            f"{BACKEND_URL}/users/",
            json=payload,
            headers=API_HEADERS,
            timeout=10
        )
        if resp.status_code in [200, 201]:
            user_data = resp.json()
            user_id = user_data.get("id")
            print_result("Create regular user", True, f"id={user_id}")
        else:
            print_result("Create regular user", False, f"Status: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print_result("Create regular user", False, str(e))
        return False
    
    # 2) Login as regular user
    try:
        resp = requests.post(
            f"{BACKEND_URL}/users/token",
            json={"email": email, "password": password},
            headers=API_HEADERS,
            timeout=10
        )
        if resp.status_code == 200:
            token = resp.json().get("access_token")
            print_result("Login regular user", True, "Token acquired")
        else:
            print_result("Login regular user", False, f"Status: {resp.status_code}")
            return False
    except Exception as e:
        print_result("Login regular user", False, str(e))
        return False
    
    user_headers = get_auth_headers(token)
    
    # 3) Try to list functions (should be 403 Forbidden)
    try:
        resp = requests.get(
            f"{BACKEND_URL}/functions/",
            headers=user_headers,
            timeout=10
        )
        passed = resp.status_code == 403
        if passed:
            print_result("GET /functions/ (non-admin)", True, "Correctly denied with 403")
        else:
            print_result("GET /functions/ (non-admin)", False, f"Expected 403, got: {resp.status_code}")
    except Exception as e:
        print_result("GET /functions/ (non-admin)", False, str(e))
    
    # 4) Try to create function (should be 403 Forbidden)
    try:
        payload = {
            "name": f"unauthorized-func-{unique_id}",
            "code": "export default () => 'test'"
        }
        resp = requests.post(
            f"{BACKEND_URL}/functions/",
            json=payload,
            headers=user_headers,
            timeout=10
        )
        passed = resp.status_code == 403
        if passed:
            print_result("POST /functions/ (non-admin)", True, "Correctly denied with 403")
        else:
            print_result("POST /functions/ (non-admin)", False, f"Expected 403, got: {resp.status_code}")
    except Exception as e:
        print_result("POST /functions/ (non-admin)", False, str(e))
    
    # Cleanup: Delete regular user (requires admin)
    admin_token = admin_login()
    if admin_token:
        try:
            admin_headers = get_auth_headers(admin_token)
            requests.delete(
                f"{BACKEND_URL}/users/{user_id}",
                headers=admin_headers,
                timeout=10
            )
        except Exception:
            pass
    
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("\n")
    print("╔══════════════════════════════════════════════════════════════════════╗")
    print("║        SELFDB FUNCTIONS SERVICE TEST SUITE                           ║")
    print("╠══════════════════════════════════════════════════════════════════════╣")
    print(f"║  Backend URL:   {BACKEND_URL:<52} ║")
    print(f"║  Admin Email:   {ADMIN_EMAIL:<52} ║")
    print("║  Note: Functions service is internal (Docker network only)           ║")
    print("╚══════════════════════════════════════════════════════════════════════╝")
    
    results = []
    
    # Run tests
    results.append(("Backend Functions API", test_backend_functions_api()))
    results.append(("Execution Result Callback", test_execution_result_callback()))
    results.append(("E2E Function Lifecycle", test_function_lifecycle_e2e()))
    results.append(("Non-Admin Access Control", test_non_admin_access_denied()))
    
    # Summary
    print_section("TEST SUMMARY")
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for name, result in results:
        status = "✅" if result else "❌"
        print(f"  {status} {name}")
    
    print(f"\n  Total: {passed}/{total} test groups passed")
    
    if passed == total:
        print("\n  🎉 All tests passed!\n")
        return 0
    else:
        print(f"\n  ⚠️  {total - passed} test group(s) failed\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
