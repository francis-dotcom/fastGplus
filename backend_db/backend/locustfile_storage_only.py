"""
Locust Load Testing for FastAPI Application - STORAGE ONLY
Tests Storage (Buckets & Files) APIs exclusively.
Separates Admin users (creators of buckets) from Regular users (consumers/uploaders).

Run with:

    uv run locust -f locustfile_storage_only.py --host=http://localhost:8000

Headless
    uv run locust -f locustfile_storage_only.py --host=http://localhost:8000 --users 10 --spawn-rate 5 --run-time 2m --headless
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

print(f"\n{'='*70}\n  LOCUST CONFIGURATION (STORAGE ONLY)\n{'='*70}")
print(f"  API_KEY: {API_KEY[:10]}..." if len(API_KEY) > 10 else f"  API_KEY: {API_KEY}")
print(f"{'='*70}\n")

# Test files setup
SCRIPT_DIR = Path(__file__).parent.parent
TEST_FILES_DIR = SCRIPT_DIR / "storage" / "benchmarks" / "test-files"
SIZE_SMALL, SIZE_MEDIUM, SIZE_LARGE = 10*1024*1024, 500*1024*1024, 1024*1024*1024

TEST_FILES = {"small": [], "medium": [], "large": [], "xlarge": [], "all": []}
SMALL_FILE_CACHE = {}

def human_size(size_bytes):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024: return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"

def categorize_file(size_bytes):
    if size_bytes < SIZE_SMALL: return "small"
    elif size_bytes < SIZE_MEDIUM: return "medium"
    elif size_bytes < SIZE_LARGE: return "large"
    return "xlarge"

def load_test_files():
    global TEST_FILES, SMALL_FILE_CACHE
    if not TEST_FILES_DIR.exists():
        print(f"⚠️  Test files directory not found: {TEST_FILES_DIR}")
        return
    total_size = 0
    for file_path in TEST_FILES_DIR.iterdir():
        if file_path.is_file():
            size = file_path.stat().st_size
            category = categorize_file(size)
            file_info = {"name": file_path.name, "path": str(file_path), "size": size, "category": category}
            TEST_FILES[category].append(file_info)
            TEST_FILES["all"].append(file_info)
            total_size += size
            if category == "small":
                SMALL_FILE_CACHE[file_path.name] = file_path.read_bytes()
    print(f"  Found {len(TEST_FILES['all'])} test files, total: {human_size(total_size)}")

def get_file_content(file_info):
    if file_info["name"] in SMALL_FILE_CACHE:
        return SMALL_FILE_CACHE[file_info["name"]]
    with open(file_info["path"], "rb") as f:
        return f.read()

def get_content_type(filename):
    ext = Path(filename).suffix.lower()
    content_types = {".mp4": "video/mp4", ".zip": "application/zip", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json"}
    return content_types.get(ext, "application/octet-stream")

load_test_files()

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
                response = self._client.post("/users/token", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, headers={API_KEY_HEADER: API_KEY, "Content-Type": "application/json"}, name="/users/token [Admin Login]")
                if response.status_code == 200: self._token = response.json().get("access_token")
            except: pass
            return self._token
    def get_admin_headers(self, client=None) -> dict:
        token = self.get_admin_token(client)
        headers = {"Content-Type": "application/json", API_KEY_HEADER: API_KEY}
        if token: headers["Authorization"] = f"Bearer {token}"
        return headers

admin_token_manager = AdminTokenManager()

class BaseStorageBehavior(SequentialTaskSet):
    """Base specialized for storage."""
    access_token, user_id, user_email = None, None, None
    user_password = "TestPass123!"

    def _api_key_headers(self): return {API_KEY_HEADER: API_KEY, "Content-Type": "application/json"}
    def _auth_headers(self):
        h = self._api_key_headers()
        if self.access_token: h["Authorization"] = f"Bearer {self.access_token}"
        return h

    def create_and_login(self, prefix="storage"):
        self.user_email = f"{prefix}-{uuid4()}@example.com"
        with self.client.post("/users/", json={"email": self.user_email, "password": self.user_password, "firstName": prefix.capitalize(), "lastName": "Test"}, headers=self._api_key_headers(), catch_response=True, name="/users/ [Create]") as r:
            if r.status_code in [200, 201]: self.user_id = r.json().get("id"); r.success()
        
        with self.client.post("/users/token", json={"email": self.user_email, "password": self.user_password}, headers=self._api_key_headers(), catch_response=True, name="/users/token [Login]") as r:
            if r.status_code == 200: self.access_token = r.json()["access_token"]; r.success()

    def on_stop(self):
        if self.user_id:
            try: self.client.delete(f"/users/{self.user_id}", headers=admin_token_manager.get_admin_headers(self.client), name="/users/{id} [Cleanup]")
            except: pass

class AdminStorageBehavior(BaseStorageBehavior):
    """Admin creates buckets and manages storage structure."""
    created_bucket_ids = []

    def on_start(self):
        self.create_and_login("admin")
        self.created_bucket_ids = []

    def _generate_bucket_name(self): return f"loadtest-{''.join(random.choices(string.ascii_lowercase + string.digits, k=12))}"

    @task(3)
    def create_bucket(self):
        # Check existing buckets limit (Max 2)
        with self.client.get("/storage/buckets/", params={"limit": 10}, headers=self._auth_headers(), catch_response=True, name="/storage/buckets/ [Check Count]") as r:
            if r.status_code == 200:
                data = r.json()
                items = data.get("items", []) if isinstance(data, dict) else data
                if len(items) >= 2:
                     return

        payload = {"name": self._generate_bucket_name(), "public": True, "description": f"Load test {uuid4().hex[:8]}"}
        with self.client.post("/storage/buckets/", json=payload, headers=self._auth_headers(), catch_response=True, name="/storage/buckets/ [Create]") as r:
            if r.status_code in [200, 201]: self.created_bucket_ids.append(r.json()["id"]); r.success()
            else: r.failure(f"Got {r.status_code}")

    @task(1)
    def list_own_buckets(self):
        self.client.get("/storage/buckets/", headers=self._auth_headers(), name="/storage/buckets/ [List Own]")

    @task(1)
    def delete_oldest(self):
        if len(self.created_bucket_ids) > 10:
            bid = self.created_bucket_ids.pop(0)
            self.client.delete(f"/storage/buckets/{bid}", headers=self._auth_headers(), name="/storage/buckets/{id} [Delete]")

    def on_stop(self):
        for bid in self.created_bucket_ids:
            try: self.client.delete(f"/storage/buckets/{bid}", headers=self._auth_headers(), name="/storage/buckets/{id} [Cleanup]")
            except: pass
        super().on_stop()

class RegularStorageBehavior(BaseStorageBehavior):
    """Regular user uploads and downloads files in existing buckets."""
    known_bucket_ids = []
    
    def on_start(self):
        self.create_and_login("regular")
        self.known_bucket_ids = []

    @task(1)
    def discover_buckets(self):
        with self.client.get("/storage/buckets/", params={"skip": 0, "limit": 50}, headers=self._auth_headers(), catch_response=True, name="/storage/buckets/ [Discover]") as r:
            if r.status_code == 200:
                data = r.json()
                buckets = data.get("items", []) if isinstance(data, dict) else data
                self.known_bucket_ids = [b["id"] for b in buckets if b.get("public")]
                r.success()

    @task(4)
    def upload_file(self):
        if not self.known_bucket_ids: self.discover_buckets(); return
        if not self.known_bucket_ids: return
        
        available_files = TEST_FILES.get("all", [])
        if available_files:
            file_info = random.choice(available_files)
            try: file_content, content_type, file_name = get_file_content(file_info), get_content_type(file_info["name"]), file_info["name"]
            except: return
        else:
            file_content, file_name, content_type = f"Test content {uuid4().hex}".encode(), f"test-{uuid4().hex[:8]}.txt", "text/plain"
        
        bucket_id = random.choice(self.known_bucket_ids)
        
        # Streaming upload: query params for metadata, raw bytes as body
        upload_path = f"uploads/{uuid4().hex[:8]}_{file_name}"
        
        headers = {API_KEY_HEADER: API_KEY, "Content-Type": content_type}
        if self.access_token: headers["Authorization"] = f"Bearer {self.access_token}"
        
        with self.client.post(
            "/storage/files/upload",
            params={"bucket_id": str(bucket_id), "filename": file_name, "path": upload_path, "content_type": content_type},
            data=file_content,  # Raw bytes for streaming
            headers=headers,
            catch_response=True,
            name="/storage/files/upload [Streaming]"
        ) as r:
            if r.status_code in [200, 201]: r.success()
            elif r.status_code == 404:
                if bucket_id in self.known_bucket_ids: self.known_bucket_ids.remove(bucket_id)
                r.success()
            else: r.failure(f"Upload failed: {r.status_code}")

    @task(3)
    def list_files(self):
        if not self.known_bucket_ids: return
        bid = random.choice(self.known_bucket_ids)
        with self.client.get("/storage/files/", params={"bucket_id": str(bid), "page": 1, "page_size": 10}, headers=self._auth_headers(), catch_response=True, name="/storage/files/ [List]") as r:
            if r.status_code == 404:
                if bid in self.known_bucket_ids: self.known_bucket_ids.remove(bid)
                r.success()

class AdminStorageUser(HttpUser):
    tasks = [AdminStorageBehavior]
    wait_time = between(2, 5)
    weight = 1
    def on_start(self): self.client.headers = {"User-Agent": "Locust Admin Storage", API_KEY_HEADER: API_KEY}

class RegularStorageUser(HttpUser):
    tasks = [RegularStorageBehavior]
    wait_time = between(1, 3)
    weight = 5
    def on_start(self): self.client.headers = {"User-Agent": "Locust Regular Storage", API_KEY_HEADER: API_KEY}
