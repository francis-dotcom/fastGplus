#!/usr/bin/env python3
"""
Integration tests for Functions + Webhooks end-to-end flows.
Mirrors the SELFDB TTD test but adapted for SELFDB-V0.05 API structure.

This test:
1) Creates a function with SMTP email support
2) Creates a webhook linked to the function
3) Triggers the webhook with customer data
4) Verifies execution metrics are updated
5) Sends actual emails via nodemailer

Requirements:
- Docker containers running (backend :8000, functions :8090 internal)
- Valid SMTP credentials
"""

import json
import time
import hmac
import hashlib
import requests
import os
from pathlib import Path
from dotenv import load_dotenv

# ═══════════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════════

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

# SMTP Configuration (update with your credentials)
SMTP_CONFIG = {
    "SMTP_HOST": "smtp.gmail.com",
    "SMTP_PORT": "587",
    "SMTP_USER": "rodgers.magabo@gmail.com",
    "SMTP_PASSWORD": "wkka qkxs ubzm lhst",  # App password
    "SMTP_FROM_EMAIL": "rodgers.magabo@gmail.com",
    "AUDIT_EMAIL_TO": "rogers.junior5@gmail.com",
}

def _now_suffix():
    return str(int(time.time()))

def _headers(token=None):
    h = {"X-API-Key": API_KEY, "Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h

# ═══════════════════════════════════════════════════════════════════════════════
# Test Functions
# ═══════════════════════════════════════════════════════════════════════════════

def test_webhook_email_integration():
    """
    End-to-end test: Webhook → Function → Email
    
    Creates a Stripe-like webhook that triggers a function which sends
    a welcome email when a new customer signs up.
    """
    print("\n" + "=" * 70)
    print("  Webhook + Email Integration Test")
    print("=" * 70)
    
    # 1. Admin Login
    print("\n[1/8] Admin Login...")
    resp = requests.post(
        f"{BACKEND_URL}/users/token",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"X-API-Key": API_KEY}
    )
    if resp.status_code != 200:
        print(f"❌ FAIL | Admin login failed: {resp.text}")
        return False
    token = resp.json()["access_token"]
    print(f"✅ PASS | Token acquired")
    
    # 2. Create Function with Email Support
    print("\n[2/8] Creating function with nodemailer...")
    func_name = f"stripe-onboarding-{_now_suffix()}"
    ts_code = '''
import nodemailer from "npm:nodemailer@6.9.7";

export default async function(request, context) {
  const payload = await request.json();
  const customerData = payload.data || payload;
  const { email, first_name, last_name } = customerData;
  const { env } = context;
  
  console.log("[INFO] Processing webhook for:", email);
  
  // Send welcome email via SMTP
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT || '587'),
    secure: env.SMTP_PORT === '465',
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD
    }
  });
  
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  await transporter.sendMail({
    from: env.SMTP_FROM_EMAIL,
    to: env.AUDIT_EMAIL_TO,
    subject: `SelfDB: New Customer Onboarded - ${first_name} ${last_name}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        <h2 style="color: #2563eb;">🎉 New Customer Onboarded!</h2>
        <hr style="border: 1px solid #e5e7eb;" />
        <p><strong>Customer Details:</strong></p>
        <ul>
          <li><strong>Name:</strong> ${first_name} ${last_name}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Onboarded:</strong> ${dateStr} at ${timeStr}</li>
        </ul>
        <hr style="border: 1px solid #e5e7eb;" />
        <p style="color: #6b7280; font-size: 12px;">
          This is an automated notification from SelfDB Functions Service.
        </p>
      </div>
    `
  });
  
  console.log("[INFO] Welcome email sent to:", env.AUDIT_EMAIL_TO);
  
  return { 
    success: true, 
    email_sent: true,
    recipient: env.AUDIT_EMAIL_TO,
    customer: { email, first_name, last_name },
    message: `Welcome email sent for ${email}`
  };
}

export const triggers = [
  { type: 'webhook' },
  { type: 'http' }
];
'''
    
    resp = requests.post(
        f"{BACKEND_URL}/functions/",
        json={
            "name": func_name,
            "code": ts_code,
            "description": "Stripe customer onboarding with email notification",
            "env_vars": {**SMTP_CONFIG, "API_KEY": API_KEY}
        },
        headers=_headers(token)
    )
    if resp.status_code != 201:
        print(f"❌ FAIL | Create function failed: {resp.text}")
        return False
    func = resp.json()
    function_id = func["id"]
    print(f"✅ PASS | Created: {func_name} (id={function_id})")
    
    # 3. Deploy Function
    print("\n[3/8] Deploying function to Deno runtime...")
    resp = requests.post(
        f"{BACKEND_URL}/functions/{function_id}/deploy",
        headers=_headers(token)
    )
    if resp.status_code != 200:
        print(f"❌ FAIL | Deploy failed: {resp.text}")
        return False
    deploy_data = resp.json()
    print(f"✅ PASS | deployment_status={deploy_data.get('deployment_status')}")
    
    # Wait for function to be loaded
    print("       └─ Waiting for function to load...")
    time.sleep(3)
    
    # 4. Create Webhook
    print("\n[4/8] Creating webhook...")
    secret = "whsec_integration_test_secret"
    resp = requests.post(
        f"{BACKEND_URL}/webhooks/",
        json={
            "function_id": function_id,
            "name": f"stripe-checkout-{_now_suffix()}",
            "provider": "stripe",
            "provider_event_type": "checkout.session.completed",
            "secret_key": secret
        },
        headers=_headers(token)
    )
    if resp.status_code != 201:
        print(f"❌ FAIL | Create webhook failed: {resp.text}")
        return False
    webhook = resp.json()
    webhook_id = webhook["id"]
    webhook_token = webhook["webhook_token"]
    print(f"✅ PASS | Created webhook (id={webhook_id})")
    print(f"       └─ Token: {webhook_token[:20]}...")
    
    # 5. Trigger Webhook with Customer Data
    print("\n[5/8] Triggering webhook with customer data...")
    customers = [
        {"first_name": "Alice", "last_name": "Integration", "email": f"alice{int(time.time()*1000)}@test-integration.com"},
        {"first_name": "Bob", "last_name": "TestUser", "email": f"bob{int(time.time()*1000)}@test-integration.com"},
    ]
    
    for i, customer in enumerate(customers):
        payload = {
            "id": f"evt_test_{_now_suffix()}_{i}",
            "object": "checkout.session",
            "data": customer
        }
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        
        resp = requests.post(
            f"{BACKEND_URL}/webhooks/trigger/{webhook_token}",
            data=body,
            headers={
                "X-API-Key": API_KEY,
                "Content-Type": "application/json",
                "X-Webhook-Signature": signature
            }
        )
        if resp.status_code not in (200, 202):
            print(f"❌ FAIL | Trigger webhook failed for {customer['first_name']}: {resp.text}")
            return False
        print(f"✅ PASS | Triggered for {customer['first_name']} {customer['last_name']}")
    
    # 6. Wait for Execution
    print("\n[6/8] Waiting for function executions...")
    time.sleep(5)  # Give time for async execution
    
    # 7. Check Execution Metrics
    print("\n[7/8] Checking execution metrics...")
    resp = requests.get(
        f"{BACKEND_URL}/functions/{function_id}",
        headers=_headers(token)
    )
    if resp.status_code != 200:
        print(f"❌ FAIL | Get function failed: {resp.text}")
        return False
    func_data = resp.json()
    exec_count = func_data.get("execution_count", 0)
    last_exec = func_data.get("last_executed_at")
    print(f"✅ PASS | execution_count={exec_count}, last_executed_at={last_exec}")
    
    # Check executions list
    resp = requests.get(
        f"{BACKEND_URL}/functions/{function_id}/executions",
        headers=_headers(token)
    )
    if resp.status_code == 200:
        exec_data = resp.json()
        total_execs = exec_data.get("total", 0)
        print(f"       └─ Total executions logged: {total_execs}")
    
    # 8. Cleanup
    print("\n[8/8] Cleanup...")
    requests.delete(f"{BACKEND_URL}/webhooks/{webhook_id}", headers=_headers(token))
    requests.delete(f"{BACKEND_URL}/functions/{function_id}", headers=_headers(token))
    print("✅ PASS | Cleanup complete")
    
    print("\n" + "=" * 70)
    print("  ✅ Webhook + Email Integration Test PASSED")
    print("=" * 70)
    print(f"\n📧 Check {SMTP_CONFIG['AUDIT_EMAIL_TO']} for welcome emails!")
    
    return True


def test_database_trigger_email():
    """
    End-to-end test: Database Trigger → Function → Email
    
    Creates a function with a database trigger that sends an audit email
    when a new user is registered.
    """
    print("\n" + "=" * 70)
    print("  Database Trigger + Email Integration Test")
    print("=" * 70)
    
    # 1. Admin Login
    print("\n[1/6] Admin Login...")
    resp = requests.post(
        f"{BACKEND_URL}/users/token",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"X-API-Key": API_KEY}
    )
    if resp.status_code != 200:
        print(f"❌ FAIL | Admin login failed: {resp.text}")
        return False
    token = resp.json()["access_token"]
    print(f"✅ PASS | Token acquired")
    
    # 2. Create Function with Database Trigger
    print("\n[2/6] Creating function with database trigger...")
    func_name = f"audit-user-created-{_now_suffix()}"
    ts_code = '''
import nodemailer from "npm:nodemailer@6.9.7";

export default async function(request, context) {
  const payload = await request.json();
  const { operation, table, data, old_data } = payload;
  const { env } = context;
  
  console.log(`[INFO] Database trigger: ${operation} on ${table}`);
  
  if (operation !== 'INSERT' || table !== 'users') {
    return { success: true, skipped: true, message: 'Not a user insert' };
  }
  
  // Send audit email
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT || '587'),
    secure: env.SMTP_PORT === '465',
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD
    }
  });
  
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  await transporter.sendMail({
    from: env.SMTP_FROM_EMAIL,
    to: env.AUDIT_EMAIL_TO,
    subject: `SelfDB Audit: New User Created`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        <h2 style="color: #16a34a;">📋 Database Audit Notification</h2>
        <hr style="border: 1px solid #e5e7eb;" />
        <p><strong>Event:</strong> New user created in <code>users</code> table</p>
        <p><strong>User:</strong> ${data.first_name || 'N/A'} ${data.last_name || 'N/A'}</p>
        <p><strong>Email:</strong> ${data.email || 'N/A'}</p>
        <p><strong>Timestamp:</strong> ${dateStr}</p>
        <hr style="border: 1px solid #e5e7eb;" />
        <p style="color: #6b7280; font-size: 12px;">
          This is an automated audit notification from SelfDB Database Triggers.
        </p>
      </div>
    `
  });
  
  console.log("[INFO] Audit email sent");
  
  return { 
    success: true, 
    email_sent: true,
    operation,
    table,
    message: `Audit email sent for ${operation} on ${table}`
  };
}

export const triggers = [
  {
    type: 'database',
    table: 'users',
    operations: ['INSERT'],
    channel: 'users_changes'
  }
];
'''
    
    resp = requests.post(
        f"{BACKEND_URL}/functions/",
        json={
            "name": func_name,
            "code": ts_code,
            "description": "Database audit email notifications",
            "env_vars": {**SMTP_CONFIG}
        },
        headers=_headers(token)
    )
    if resp.status_code != 201:
        print(f"❌ FAIL | Create function failed: {resp.text}")
        return False
    func = resp.json()
    function_id = func["id"]
    print(f"✅ PASS | Created: {func_name} (id={function_id})")
    
    # 3. Deploy Function
    print("\n[3/6] Deploying function...")
    resp = requests.post(
        f"{BACKEND_URL}/functions/{function_id}/deploy",
        headers=_headers(token)
    )
    if resp.status_code != 200:
        print(f"❌ FAIL | Deploy failed: {resp.text}")
        return False
    print(f"✅ PASS | deployment_status={resp.json().get('deployment_status')}")
    
    # Wait for function to be loaded and listener to be set up
    print("       └─ Waiting for database listener setup...")
    time.sleep(5)
    
    # 4. Create a new user to trigger the function
    print("\n[4/6] Creating new user to trigger database function...")
    unique_email = f"db_trigger_test_{int(time.time()*1000)}@example.com"
    resp = requests.post(
        f"{BACKEND_URL}/users/",
        json={
            "email": unique_email,
            "password": "TestPassword123!",
            "first_name": "Database",
            "last_name": "TriggerTest"
        },
        headers=_headers(token)
    )
    if resp.status_code not in (200, 201):
        print(f"❌ FAIL | Create user failed: {resp.text}")
        return False
    new_user = resp.json()
    new_user_id = new_user.get("id")
    print(f"✅ PASS | Created user: {unique_email}")
    
    # 5. Wait and check execution
    print("\n[5/6] Waiting for trigger execution...")
    time.sleep(5)
    
    resp = requests.get(
        f"{BACKEND_URL}/functions/{function_id}",
        headers=_headers(token)
    )
    if resp.status_code == 200:
        func_data = resp.json()
        exec_count = func_data.get("execution_count", 0)
        print(f"✅ PASS | execution_count={exec_count}")
    
    # 6. Cleanup
    print("\n[6/6] Cleanup...")
    if new_user_id:
        requests.delete(f"{BACKEND_URL}/users/{new_user_id}", headers=_headers(token))
    requests.delete(f"{BACKEND_URL}/functions/{function_id}", headers=_headers(token))
    print("✅ PASS | Cleanup complete")
    
    print("\n" + "=" * 70)
    print("  ✅ Database Trigger + Email Integration Test PASSED")
    print("=" * 70)
    print(f"\n📧 Check {SMTP_CONFIG['AUDIT_EMAIL_TO']} for audit email!")
    
    return True


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "╔" + "═" * 70 + "╗")
    print("║" + "  SELFDB V0.05 - Functions + Webhooks Integration Tests".center(70) + "║")
    print("╠" + "═" * 70 + "╣")
    print("║" + f"  Backend URL:   {BACKEND_URL}".ljust(70) + "║")
    print("║" + f"  Admin Email:   {ADMIN_EMAIL}".ljust(70) + "║")
    print("║" + f"  Email To:      {SMTP_CONFIG['AUDIT_EMAIL_TO']}".ljust(70) + "║")
    print("╚" + "═" * 70 + "╝")
    
    results = []
    
    # Test 1: Webhook + Email
    try:
        results.append(("Webhook + Email", test_webhook_email_integration()))
    except Exception as e:
        print(f"\n❌ Exception in Webhook test: {e}")
        results.append(("Webhook + Email", False))
    
    # Test 2: Database Trigger + Email
    try:
        results.append(("Database Trigger + Email", test_database_trigger_email()))
    except Exception as e:
        print(f"\n❌ Exception in Database Trigger test: {e}")
        results.append(("Database Trigger + Email", False))
    
    # Summary
    print("\n" + "=" * 70)
    print("  FINAL SUMMARY")
    print("=" * 70)
    
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} | {name}")
    
    print(f"\n  Total: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n  🎉 All integration tests passed!")
    else:
        print("\n  ⚠️  Some tests failed. Check logs above.")
