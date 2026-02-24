"""
Locust Load Testing for FastAPI Application (Day-One Backend)

This file contains load tests for Users, Tables, and Storage APIs.
It simulates realistic user behavior patterns and measures performance.
Separates Admin users (creators) from Regular users (consumers).

Run with:
    uv run locust -f locustfile.py --host=http://localhost:8000

Then open http://localhost:8089 to access the Locust web UI.

For headless mode:
    uv run locust -f locustfile.py --host=http://localhost:8000 --users 100 --spawn-rate 10 --run-time 1m --headless

Configuration is loaded from the .env file in the parent directory (SELFDB-V0.05/.env).
Environment variables used:
    - API_KEY: API key for authentication (required)
    - ADMIN_EMAIL: Admin email for admin-only endpoints (default: "admin@example.com")
    - ADMIN_PASSWORD: Admin password (default: "password")
"""

from locust import HttpUser, task, between, SequentialTaskSet, events
from uuid import uuid4
import random
import string
import os
import threading
from pathlib import Path
from dotenv import load_dotenv


# ─────────────────────────────────────────────────────────────────────────────
# Configuration - Load from .env file
# ─────────────────────────────────────────────────────────────────────────────

# Try to load .env from parent directory (SELFDB-V0.05/.env)
ENV_FILE = Path(__file__).parent.parent / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
    print(f"✅ Loaded environment from: {ENV_FILE}")
else:
    print(f"⚠️  No .env file found at: {ENV_FILE}")
    print("   Using default values or existing environment variables.")

# Load configuration from environment variables
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    raise SystemExit("❌ API_KEY not found in environment. Please set it in .env file.")
API_KEY_HEADER = "X-API-Key"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password")

print(f"\n{'='*70}")
print("  LOCUST CONFIGURATION")
print(f"{'='*70}")
print(f"  API_KEY: {API_KEY[:10]}..." if len(API_KEY) > 10 else f"  API_KEY: {API_KEY}")
print(f"  ADMIN_EMAIL: {ADMIN_EMAIL}")
print(f"  ADMIN_PASSWORD: {'*' * len(ADMIN_PASSWORD)}")
print(f"{'='*70}\n")

# Test files directory (shared with storage service benchmarks)
SCRIPT_DIR = Path(__file__).parent.parent  # Go up to SELFDB-V0.05
TEST_FILES_DIR = SCRIPT_DIR / "storage" / "benchmarks" / "test-files"

# Size thresholds in bytes
SIZE_SMALL = 10 * 1024 * 1024       # < 10 MB
SIZE_MEDIUM = 500 * 1024 * 1024     # 10 MB - 500 MB
SIZE_LARGE = 1024 * 1024 * 1024     # 500 MB - 1 GB

# File registry - stores file metadata (NOT content for large files)
TEST_FILES = {
    "small": [],   # < 10 MB - loaded into memory
    "medium": [],  # 10-500 MB - streamed from disk
    "large": [],   # 500MB-1GB - streamed from disk
    "xlarge": [],  # > 1GB - streamed from disk
    "all": []      # All files
}

# Small files can be loaded into memory for faster uploads
SMALL_FILE_CACHE = {}


def human_size(size_bytes):
    """Convert bytes to human readable format."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def categorize_file(size_bytes):
    """Categorize file by size."""
    if size_bytes < SIZE_SMALL:
        return "small"
    elif size_bytes < SIZE_MEDIUM:
        return "medium"
    elif size_bytes < SIZE_LARGE:
        return "large"
    else:
        return "xlarge"


def load_test_files():
    """Discover and categorize test files."""
    global TEST_FILES, SMALL_FILE_CACHE
    
    if not TEST_FILES_DIR.exists():
        print(f"⚠️  Test files directory not found: {TEST_FILES_DIR}")
        print("   Run storage benchmarks or copy test files first!")
        return
    
    total_size = 0
    
    for file_path in TEST_FILES_DIR.iterdir():
        if file_path.is_file():
            size = file_path.stat().st_size
            category = categorize_file(size)
            
            file_info = {
                "name": file_path.name,
                "path": str(file_path),
                "size": size,
                "category": category
            }
            
            TEST_FILES[category].append(file_info)
            TEST_FILES["all"].append(file_info)
            total_size += size
            
            # Cache small files in memory for faster uploads
            if category == "small":
                SMALL_FILE_CACHE[file_path.name] = file_path.read_bytes()
    
    print(f"\n{'='*70}")
    print("  BACKEND TEST FILES DISCOVERED")
    print(f"{'='*70}")
    print(f"  Directory: {TEST_FILES_DIR}")
    print(f"  Total size: {human_size(total_size)}")
    print(f"  Total files: {len(TEST_FILES['all'])}")
    print()
    
    for category in ["small", "medium", "large", "xlarge"]:
        files = TEST_FILES[category]
        if files:
            print(f"  {category.upper()} files ({len(files)}):")
            for f in files:
                cached = " [cached]" if f["name"] in SMALL_FILE_CACHE else ""
                print(f"    - {f['name']}: {human_size(f['size'])}{cached}")
    
    print(f"{'='*70}\n")


def get_file_content(file_info):
    """Get file content - from cache if small, from disk if large."""
    if file_info["name"] in SMALL_FILE_CACHE:
        return SMALL_FILE_CACHE[file_info["name"]]
    else:
        # Stream from disk for large files
        with open(file_info["path"], "rb") as f:
            return f.read()


def get_content_type(filename):
    """Get content type based on file extension."""
    ext = Path(filename).suffix.lower()
    content_types = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".zip": "application/zip",
        ".rar": "application/x-rar-compressed",
        ".7z": "application/x-7z-compressed",
        ".tar": "application/x-tar",
        ".gz": "application/gzip",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".txt": "text/plain",
        ".json": "application/json",
        ".xml": "application/xml",
        ".csv": "text/csv",
        ".bin": "application/octet-stream",
    }
    return content_types.get(ext, "application/octet-stream")


# Load test files when module is imported
load_test_files()


# ─────────────────────────────────────────────────────────────────────────────
# Shared Tokens and Helpers
# ─────────────────────────────────────────────────────────────────────────────

class AdminTokenManager:
    """
    Thread-safe manager for shared admin authentication token.
    Reuses the admin token across all tests to reduce login overhead.
    """
    _instance = None
    _lock = threading.Lock()
    _token = None
    _token_lock = threading.Lock()
    _client = None
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance
    
    def set_client(self, client):
        """Set the HTTP client for making login requests."""
        self._client = client
    
    def get_admin_token(self, client=None) -> str | None:
        """
        Get the admin token, logging in if necessary.
        Thread-safe and reuses existing valid token.
        """
        if client:
            self._client = client
        
        if not self._client:
            return None
        
        with self._token_lock:
            if self._token:
                return self._token
            
            try:
                response = self._client.post(
                    "/users/token",
                    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                    headers={API_KEY_HEADER: API_KEY, "Content-Type": "application/json"},
                    name="/users/token [Admin Login - Shared]"
                )
                if response.status_code == 200:
                    self._token = response.json().get("access_token")
                    return self._token
            except Exception as e:
                print(f"Admin login failed: {e}")
            return None
    
    def get_admin_headers(self, client=None) -> dict:
        """Get headers with admin Bearer token and API key."""
        token = self.get_admin_token(client)
        headers = {
            "Content-Type": "application/json",
            API_KEY_HEADER: API_KEY
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers
    
    def invalidate_token(self):
        """Invalidate the cached token (e.g., on 401 response)."""
        with self._token_lock:
            self._token = None


# Global admin token manager instance
admin_token_manager = AdminTokenManager()


def generate_table_name():
    """Generate a valid table name (lowercase, starts with letter)."""
    prefix = random.choice(string.ascii_lowercase)
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"{prefix}{suffix}"

def generate_bucket_name():
    """Generate a valid bucket name."""
    return f"loadtest-{''.join(random.choices(string.ascii_lowercase + string.digits, k=10))}"


# ─────────────────────────────────────────────────────────────────────────────
# Base Behavior
# ─────────────────────────────────────────────────────────────────────────────

class BaseUserBehavior(SequentialTaskSet):
    """Base class for user behaviors."""
    access_token = None
    user_email = None
    user_password = "TestPass123!"
    user_id = None

    def _api_key_headers(self):
        return {
            API_KEY_HEADER: API_KEY,
            "Content-Type": "application/json"
        }

    def _auth_headers(self):
        headers = self._api_key_headers()
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        return headers

    def create_and_login_user(self, prefix="user"):
        self.user_email = f"{prefix}-{uuid4()}@example.com"
        
        # Create user
        with self.client.post(
            "/users/",
            json={
                "email": self.user_email,
                "password": self.user_password,
                "firstName": prefix.capitalize(),
                "lastName": "User"
            },
            headers=self._api_key_headers(),
            catch_response=True,
            name="/users/ [Register]"
        ) as response:
            if response.status_code in [200, 201]:
                self.user_id = response.json().get("id")
                response.success()
            else:
                response.failure(f"Registration failed: {response.status_code}")
                return False

        # Login
        with self.client.post(
            "/users/token",
            json={"email": self.user_email, "password": self.user_password},
            headers=self._api_key_headers(),
            catch_response=True,
            name="/users/token [Login]"
        ) as response:
            if response.status_code == 200:
                self.access_token = response.json().get("access_token")
                response.success()
                return True
            else:
                response.failure(f"Login failed: {response.status_code}")
                return False

    def on_stop(self):
        """Cleanup user."""
        if self.user_id:
            try:
                self.client.delete(
                    f"/users/{self.user_id}",
                    headers=admin_token_manager.get_admin_headers(self.client),
                    name="/users/{id} [Cleanup User]"
                )
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# Admin Behavior (Creator)
# ─────────────────────────────────────────────────────────────────────────────

class AdminBehavior(BaseUserBehavior):
    """
    Admin user behavior.
    
    Responsibilities:
    1. Create Tables
    2. Create Buckets
    3. Perform administrative tasks
    4. Cleanup resources occasionally
    """
    created_table_ids = []
    created_bucket_ids = []
    
    def on_start(self):
        self.create_and_login_user(prefix="admin")
        self.created_table_ids = []
        self.created_bucket_ids = []

    @task(3)
    def create_table(self):
        """Create a new table."""
        # Check existing tables limit (Max 3)
        with self.client.get("/tables/", params={"limit": 10}, headers=self._auth_headers(), catch_response=True, name="/tables/ [Check Count]") as r:
            if r.status_code == 200:
                data = r.json()
                items = data.get("items", []) if isinstance(data, dict) else data
                if len(items) >= 3:
                     return

        table_name = generate_table_name()
        payload = {
            "name": table_name,
            "table_schema": {
                "name": {"type": "TEXT", "nullable": False},
                "value": {"type": "INTEGER", "nullable": True},
                "active": {"type": "BOOLEAN", "nullable": True}
            },
            "public": True, # Make public so regular users can access
            "description": f"Load test table {uuid4().hex[:8]}"
        }
        
        with self.client.post(
            "/tables/",
            json=payload,
            headers=self._auth_headers(),
            catch_response=True,
            name="/tables/ [Create]"
        ) as response:
            if response.status_code in [200, 201]:
                self.created_table_ids.append(response.json()["id"])
                response.success()
            else:
                response.failure(f"Create table failed: {response.status_code}")

    @task(3)
    def create_bucket(self):
        """Create a new storage bucket."""
        # Check existing buckets limit (Max 2)
        with self.client.get("/storage/buckets/", params={"limit": 10}, headers=self._auth_headers(), catch_response=True, name="/storage/buckets/ [Check Count]") as r:
            if r.status_code == 200:
                data = r.json()
                items = data.get("items", []) if isinstance(data, dict) else data
                if len(items) >= 2:
                     return

        bucket_name = generate_bucket_name()
        payload = {
            "name": bucket_name,
            "public": True, # Make public for regular users
            "description": f"Load test bucket {uuid4().hex[:8]}"
        }
        
        with self.client.post(
            "/storage/buckets/",
            json=payload,
            headers=self._auth_headers(),
            catch_response=True,
            name="/storage/buckets/ [Create]"
        ) as response:
            if response.status_code in [200, 201]:
                self.created_bucket_ids.append(response.json()["id"])
                response.success()
            else:
                response.failure(f"Create bucket failed: {response.status_code}")

    @task(1)
    def list_own_resources(self):
        """List resources created by this admin."""
        self.client.get("/tables/", headers=self._auth_headers(), name="/tables/ [List Own]")
        self.client.get("/storage/buckets/", headers=self._auth_headers(), name="/storage/buckets/ [List Own]")

    @task(1)
    def cleanup_oldest(self):
        """Delete oldest created resources to keep count stable."""
        if len(self.created_table_ids) > 10:
            tid = self.created_table_ids.pop(0)
            self.client.delete(f"/tables/{tid}", headers=self._auth_headers(), name="/tables/{id} [Delete]")
            
        if len(self.created_bucket_ids) > 5:
            bid = self.created_bucket_ids.pop(0)
            self.client.delete(f"/storage/buckets/{bid}", headers=self._auth_headers(), name="/storage/buckets/{id} [Delete]")

    def on_stop(self):
        """Cleanup all created resources."""
        for tid in self.created_table_ids:
            try:
                self.client.delete(f"/tables/{tid}", headers=self._auth_headers(), name="/tables/{id} [Cleanup]")
            except: pass
        
        for bid in self.created_bucket_ids:
            try:
                self.client.delete(f"/storage/buckets/{bid}", headers=self._auth_headers(), name="/storage/buckets/{id} [Cleanup]")
            except: pass
            
        super().on_stop()


# ─────────────────────────────────────────────────────────────────────────────
# Regular User Behavior (Consumer)
# ─────────────────────────────────────────────────────────────────────────────

class RegularUserBehavior(BaseUserBehavior):
    """
    Regular user behavior.
    
    Responsibilities:
    1. Consumes Tables (CRUD on rows)
    2. Consumes Buckets (Upload/Download files)
    3. Does NOT create tables or buckets.
    """
    known_table_ids = []
    known_bucket_ids = []
    uploaded_file_ids = []

    def on_start(self):
        self.create_and_login_user(prefix="regular")
        self.known_table_ids = []
        self.known_bucket_ids = []
        self.uploaded_file_ids = []

    def _discover_resources(self):
        """Discover available public tables and buckets."""
        # Discover tables
        with self.client.get("/tables/", params={"limit": 50}, headers=self._auth_headers(), catch_response=True, name="/tables/ [Discover]") as r:
            if r.status_code == 200:
                data = r.json()
                tables = data.get("items", []) if isinstance(data, dict) else data
                # Filter for public tables or ones we have access to
                self.known_table_ids = [t["id"] for t in tables if t.get("public", False)]
            else:
                r.failure(f"Discover tables failed: {r.status_code}")

        # Discover buckets
        with self.client.get("/storage/buckets/", params={"limit": 50}, headers=self._auth_headers(), catch_response=True, name="/storage/buckets/ [Discover]") as r:
             if r.status_code == 200:
                data = r.json()
                buckets = data.get("items", []) if isinstance(data, dict) else data
                self.known_bucket_ids = [b["id"] for b in buckets if b.get("public", False)]
             else:
                r.failure(f"Discover buckets failed: {r.status_code}")

    @task(1)
    def refresh_resources(self):
        self._discover_resources()

    # --- Table Operations ---

    @task(3)
    def insert_row(self):
        if not self.known_table_ids:
            self._discover_resources()
            if not self.known_table_ids: return

        table_id = random.choice(self.known_table_ids)
        row_data = {
            "name": f"Item-{uuid4().hex[:6]}",
            "value": random.randint(1, 1000),
            "active": random.choice([True, False])
        }
        
        with self.client.post(
            f"/tables/{table_id}/data",
            json=row_data,
            headers=self._auth_headers(),
            catch_response=True,
            name="/tables/{id}/data [Insert]"
        ) as response:
            if response.status_code in [200, 201]:
                response.success()
            else:
                # 404 might happen if admin deleted the table meanwhile
                if response.status_code == 404:
                    if table_id in self.known_table_ids:
                        self.known_table_ids.remove(table_id)
                    response.success()
                else:
                    response.failure(f"Insert row failed: {response.status_code}")

    @task(3)
    def list_table_data(self):
        if not self.known_table_ids: return
        table_id = random.choice(self.known_table_ids)
        with self.client.get(
            f"/tables/{table_id}/data",
            params={"page": 1, "page_size": 10},
            headers=self._auth_headers(),
            catch_response=True,
            name="/tables/{id}/data [List]"
        ) as r:
            if r.status_code == 404:
                if table_id in self.known_table_ids: self.known_table_ids.remove(table_id)
                r.success()

    # --- Storage Operations ---

    @task(2)
    def upload_file(self):
        if not self.known_bucket_ids:
            self._discover_resources()
            if not self.known_bucket_ids: return

        bucket_id = random.choice(self.known_bucket_ids)
        
        # Pick a file to upload
        available_files = TEST_FILES.get("all", [])
        if available_files:
            file_info = random.choice(available_files)
            try:
                file_content = get_file_content(file_info)
                content_type = get_content_type(file_info["name"])
                file_name = file_info["name"]
            except: return
        else:
            file_content = f"Test content {uuid4().hex}".encode()
            file_name = f"test-{uuid4().hex[:8]}.txt"
            content_type = "text/plain"

        # Streaming upload: query params for metadata, raw bytes as body
        upload_path = f"uploads/{uuid4().hex[:8]}_{file_name}"
        
        headers = {
            API_KEY_HEADER: API_KEY,
            "Content-Type": content_type,
        }
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        with self.client.post(
            "/storage/files/upload",
            params={
                "bucket_id": str(bucket_id),
                "filename": file_name,
                "path": upload_path,
                "content_type": content_type,
            },
            data=file_content,  # Raw bytes for streaming
            headers=headers,
            catch_response=True,
            name="/storage/files/upload [Streaming]"
        ) as r:
            if r.status_code in [200, 201]:
                file_id = r.json().get("file_id")
                if file_id:
                    self.uploaded_file_ids.append(file_id)
                r.success()
            elif r.status_code == 404:
                if bucket_id in self.known_bucket_ids: self.known_bucket_ids.remove(bucket_id)
                r.success()
            else:
                r.failure(f"Upload failed: {r.status_code}")

    @task(2)
    def list_files(self):
        if not self.known_bucket_ids: return
        bucket_id = random.choice(self.known_bucket_ids)
        with self.client.get(
            "/storage/files/",
            params={"bucket_id": str(bucket_id), "page": 1, "page_size": 10},
            headers=self._auth_headers(),
            catch_response=True,
            name="/storage/files/ [List]"
        ) as r:
            if r.status_code == 404:
                if bucket_id in self.known_bucket_ids: self.known_bucket_ids.remove(bucket_id)
                r.success()


# ─────────────────────────────────────────────────────────────────────────────
# Locust User Classes
# ─────────────────────────────────────────────────────────────────────────────

class AdminUser(HttpUser):
    """
    Simulates Admin users who create resources.
    Lower weight (fewer admins than users).
    """
    tasks = [AdminBehavior]
    wait_time = between(2, 5)
    weight = 1
    
    def on_start(self):
        self.client.headers = {
            "User-Agent": "Locust Admin",
            API_KEY_HEADER: API_KEY
        }

class RegularUser(HttpUser):
    """
    Simulates Regular users who consume resources.
    Higher weight (more users than admins).
    """
    tasks = [RegularUserBehavior]
    wait_time = between(1, 3)
    weight = 5
    
    def on_start(self):
        self.client.headers = {
            "User-Agent": "Locust Regular",
            API_KEY_HEADER: API_KEY
        }

# Removed: FunctionsWebhooksAPIUser
