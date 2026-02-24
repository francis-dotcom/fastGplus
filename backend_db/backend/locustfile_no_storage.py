"""
Locust Load Testing for FastAPI Application - NO STORAGE
Tests Users and Tables APIs (excludes Storage, Functions, Webhooks).
Separates Admin users (creators) from Regular users (consumers).

Run with:

    uv run locust -f locustfile_no_storage.py --host=http://localhost:8000

Headless
    uv run locust -f locustfile_no_storage.py --host=http://localhost:8000 --users 50 --spawn-rate 5 --run-time 2m --headless
"""

from locust import HttpUser, task, between, SequentialTaskSet
from uuid import uuid4
import random
import string
import os
import threading
from pathlib import Path
from dotenv import load_dotenv

# Load config
ENV_FILE = Path(__file__).parent.parent / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
    print(f"✅ Loaded environment from: {ENV_FILE}")

API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    raise SystemExit("❌ API_KEY not found in environment. Please set it in .env file.")
API_KEY_HEADER = "X-API-Key"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password")

print(f"\n{'='*70}\n  LOCUST CONFIGURATION (NO STORAGE)\n{'='*70}")
print(f"  API_KEY: {API_KEY[:10]}..." if len(API_KEY) > 10 else f"  API_KEY: {API_KEY}")
print(f"{'='*70}\n")

def generate_table_name():
    return f"{random.choice(string.ascii_lowercase)}{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}"

class AdminTokenManager:
    _instance, _lock, _token, _token_lock, _client = None, threading.Lock(), None, threading.Lock(), None
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None: cls._instance = super().__new__(cls)
        return cls._instance
    def get_admin_token(self, client=None) -> str | None:
        if client: self._client = client
        if not self._client: return None
        with self._token_lock:
            if self._token: return self._token
            try:
                r = self._client.post("/users/token", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, headers={API_KEY_HEADER: API_KEY, "Content-Type": "application/json"}, name="/users/token [Admin]")
                if r.status_code == 200: self._token = r.json().get("access_token")
            except: pass
            return self._token
    def get_admin_headers(self, client=None) -> dict:
        token = self.get_admin_token(client)
        h = {"Content-Type": "application/json", API_KEY_HEADER: API_KEY}
        if token: h["Authorization"] = f"Bearer {token}"
        return h

admin_token_manager = AdminTokenManager()

class BaseUserBehavior(SequentialTaskSet):
    """Base behavior with login helper."""
    access_token, user_id, user_email = None, None, None
    user_password = "TestPass123!"

    def _auth_headers(self):
        h = {"Content-Type": "application/json", API_KEY_HEADER: API_KEY}
        if self.access_token: h["Authorization"] = f"Bearer {self.access_token}"
        return h
    
    def _api_key_headers(self): return {API_KEY_HEADER: API_KEY, "Content-Type": "application/json"}

    def create_and_login(self, prefix="user"):
        self.user_email = f"{prefix}-{uuid4()}@example.com"
        with self.client.post("/users/", json={"email": self.user_email, "password": self.user_password, "firstName": prefix.capitalize(), "lastName": "User"}, headers=self._api_key_headers(), catch_response=True, name="/users/ [Create]") as r:
            if r.status_code in [200, 201]: self.user_id = r.json()["id"]; r.success()
        
        with self.client.post("/users/token", json={"email": self.user_email, "password": self.user_password}, headers=self._api_key_headers(), catch_response=True, name="/users/token [Login]") as r:
            if r.status_code == 200: self.access_token = r.json()["access_token"]; r.success()

    def on_stop(self):
        if self.user_id:
            try: self.client.delete(f"/users/{self.user_id}", headers=admin_token_manager.get_admin_headers(self.client), name="/users/{id} [Cleanup]")
            except: pass

class AdminBehavior(BaseUserBehavior):
    """Admin creates tables."""
    created_table_ids = []

    def on_start(self):
        self.create_and_login("admin")
        self.created_table_ids = []

    @task(3)
    def create_table(self):
        # Check existing tables limit (Max 5)
        with self.client.get("/tables/", params={"limit": 10}, headers=self._auth_headers(), catch_response=True, name="/tables/ [Check Count]") as r:
            if r.status_code == 200:
                data = r.json()
                items = data.get("items", []) if isinstance(data, dict) else data
                if len(items) >= 5:
                     return

        name = generate_table_name()
        with self.client.post("/tables/", json={"name": name, "table_schema": {"name": {"type": "TEXT"}, "value": {"type": "INTEGER"}}, "public": True}, headers=self._auth_headers(), catch_response=True, name="/tables/ [Create]") as r:
            if r.status_code in [200, 201]: self.created_table_ids.append(r.json()["id"]); r.success()
            else: r.failure(f"Got {r.status_code}")

    @task(1)
    def delete_oldest(self):
        if len(self.created_table_ids) > 10:
            tid = self.created_table_ids.pop(0)
            self.client.delete(f"/tables/{tid}", headers=self._auth_headers(), name="/tables/{id} [Delete]")

    def on_stop(self):
        for tid in self.created_table_ids:
            try: self.client.delete(f"/tables/{tid}", headers=self._auth_headers(), name="/tables/{id} [Cleanup]")
            except: pass
        super().on_stop()

class RegularUserBehavior(BaseUserBehavior):
    """Regular user consumes tables."""
    known_table_ids = []

    def on_start(self):
        self.create_and_login("regular")
        self.known_table_ids = []

    @task(1)
    def discover_tables(self):
        with self.client.get("/tables/", params={"skip": 0, "limit": 50}, headers=self._auth_headers(), catch_response=True, name="/tables/ [Discover]") as r:
            if r.status_code == 200:
                data = r.json()
                tables = data.get("items", []) if isinstance(data, dict) else data
                self.known_table_ids = [t["id"] for t in tables if t.get("public")]
                r.success()

    @task(3)
    def list_table_data(self):
        if not self.known_table_ids: self.discover_tables(); return
        if not self.known_table_ids: return
        tid = random.choice(self.known_table_ids)
        with self.client.get(f"/tables/{tid}/data", params={"page": 1, "page_size": 10}, headers=self._auth_headers(), catch_response=True, name="/tables/{id}/data [Get]") as r:
            if r.status_code == 404: 
                if tid in self.known_table_ids: self.known_table_ids.remove(tid)
                r.success()

    @task(3)
    def insert_row(self):
        if not self.known_table_ids: self.discover_tables(); return
        if not self.known_table_ids: return
        tid = random.choice(self.known_table_ids)
        with self.client.post(f"/tables/{tid}/data", json={"name": f"Item-{uuid4().hex[:6]}", "value": random.randint(1, 1000)}, headers=self._auth_headers(), catch_response=True, name="/tables/{id}/data [Insert]") as r:
            if r.status_code in [200, 201]: r.success()
            elif r.status_code == 404:
                if tid in self.known_table_ids: self.known_table_ids.remove(tid)
                r.success()
            else: r.failure(f"Got {r.status_code}")

class AdminUser(HttpUser):
    tasks = [AdminBehavior]
    wait_time = between(2, 5)
    weight = 1
    def on_start(self): self.client.headers = {"User-Agent": "Locust Admin", API_KEY_HEADER: API_KEY}

class RegularUser(HttpUser):
    tasks = [RegularUserBehavior]
    wait_time = between(1, 3)
    weight = 5
    def on_start(self): self.client.headers = {"User-Agent": "Locust Regular", API_KEY_HEADER: API_KEY}
