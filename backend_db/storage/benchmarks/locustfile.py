"""
Locust Load Testing for Storage Service API

This file contains load tests for the Storage Service endpoints:
- Bucket operations (create, list, get, update, delete)
- File operations (upload, download, delete)

Auto-discovers test files from the test-files/ directory and categorizes them by size:
- Small: < 10 MB
- Medium: 10 MB - 500 MB
- Large: 500 MB - 1 GB
- XLarge: > 1 GB

Run with:
    locust -f locustfile.py --host=http://localhost:8000

Then open http://localhost:8089 to access the Locust web UI.

For headless mode:
    locust -f locustfile.py --host=http://localhost:8000 --users 50 --spawn-rate 5 --run-time 2m --headless

Quick smoke test:
    locust -f locustfile.py --host=http://localhost:8000 --users 10 --spawn-rate 2 --run-time 30s --headless
"""

import os
import random
import string
from pathlib import Path
from locust import HttpUser, task, between, SequentialTaskSet, events
from locust.runners import MasterRunner

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Test files directory (relative to this script)
SCRIPT_DIR = Path(__file__).parent
TEST_FILES_DIR = SCRIPT_DIR / "test-files"

# Size thresholds in bytes
SIZE_SMALL = 10 * 1024 * 1024       # < 10 MB
SIZE_MEDIUM = 500 * 1024 * 1024     # 10 MB - 500 MB
SIZE_LARGE = 1024 * 1024 * 1024     # 500 MB - 1 GB
# XLarge: > 1 GB

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
        print("   Copy test files to the test-files/ directory first!")
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
    print("  TEST FILES DISCOVERED")
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


# Load test files when module is imported
load_test_files()


def generate_bucket_name():
    """Generate a valid S3-style bucket name."""
    # Pattern: ^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$
    prefix = random.choice(string.ascii_lowercase)
    middle = ''.join(random.choices(string.ascii_lowercase + string.digits + '-', k=10))
    suffix = random.choice(string.ascii_lowercase + string.digits)
    return f"{prefix}{middle}{suffix}"


def generate_file_path(original_name):
    """Generate a random file path preserving extension."""
    folders = ["uploads", "images", "documents", "data", "temp", "media", "backups"]
    
    # Get extension from original file
    ext = Path(original_name).suffix or ".bin"
    
    folder = random.choice(folders)
    filename = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    
    return f"{folder}/{filename}{ext}"


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


# ─────────────────────────────────────────────────────────────────────────────
# Storage User Behavior
# ─────────────────────────────────────────────────────────────────────────────

class StorageUserBehavior(SequentialTaskSet):
    """
    Sequential task set simulating storage user behavior.
    
    Users will:
    1. Create a bucket
    2. Upload files of various sizes
    3. Download uploaded files
    4. List bucket contents
    5. Delete files
    6. Delete bucket (cleanup)
    """
    
    bucket_name = None
    uploaded_files = []
    
    def on_start(self):
        """Create a test bucket for this user."""
        self.bucket_name = f"loadtest-{generate_bucket_name()}"
        self.uploaded_files = []
        
        # Create bucket
        with self.client.post(
            "/api/v1/buckets",
            json={"name": self.bucket_name, "public": False},
            catch_response=True,
            name="/api/v1/buckets [Create]"
        ) as response:
            if response.status_code in [200, 201]:
                response.success()
            else:
                response.failure(f"Failed to create bucket: {response.status_code} - {response.text}")
    
    def on_stop(self):
        """Clean up: delete uploaded files and bucket."""
        # Delete all uploaded files
        for file_path in self.uploaded_files:
            self.client.delete(
                f"/api/v1/files/{self.bucket_name}/{file_path}",
                name="/api/v1/files/{bucket}/{path} [Delete - Cleanup]"
            )
        
        # Delete bucket
        self.client.delete(
            f"/api/v1/buckets/{self.bucket_name}",
            name="/api/v1/buckets/{bucket} [Delete - Cleanup]"
        )
    
    # ─────────────────────────────────────────────────────────────────────────
    # Bucket Operations
    # ─────────────────────────────────────────────────────────────────────────
    
    @task(2)
    def list_buckets(self):
        """GET /api/v1/buckets - List all buckets."""
        with self.client.get(
            "/api/v1/buckets",
            catch_response=True,
            name="/api/v1/buckets [List]"
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Failed: {response.status_code}")
    
    @task(2)
    def get_bucket(self):
        """GET /api/v1/buckets/{bucket} - Get bucket details."""
        if not self.bucket_name:
            return
        
        with self.client.get(
            f"/api/v1/buckets/{self.bucket_name}",
            catch_response=True,
            name="/api/v1/buckets/{bucket} [Get]"
        ) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 404:
                response.success()  # Bucket might have been deleted
            else:
                response.failure(f"Failed: {response.status_code}")
    
    # ─────────────────────────────────────────────────────────────────────────
    # File Upload Operations (auto-discovered)
    # ─────────────────────────────────────────────────────────────────────────
    
    @task(5)
    def upload_small_file(self):
        """Upload a small file (< 10 MB)."""
        self._upload_from_category("small", "Upload Small")
    
    @task(3)
    def upload_medium_file(self):
        """Upload a medium file (10 MB - 500 MB)."""
        self._upload_from_category("medium", "Upload Medium")
    
    @task(1)
    def upload_large_file(self):
        """Upload a large file (500 MB - 1 GB)."""
        self._upload_from_category("large", "Upload Large")
    
    def _upload_from_category(self, category, operation_name):
        """Upload a random file from the given category."""
        if not self.bucket_name:
            return
        
        files_in_category = TEST_FILES.get(category, [])
        if not files_in_category:
            # Fall back to any available file
            files_in_category = TEST_FILES.get("all", [])
            if not files_in_category:
                return
        
        file_info = random.choice(files_in_category)
        file_path = generate_file_path(file_info["name"])
        content_type = get_content_type(file_info["name"])
        
        # Get file content
        try:
            content = get_file_content(file_info)
        except Exception as e:
            print(f"Error reading file {file_info['path']}: {e}")
            return
        
        # Create multipart form data
        files = {
            "file": (file_info["name"], content, content_type)
        }
        
        with self.client.post(
            f"/api/v1/files/{self.bucket_name}/{file_path}",
            files=files,
            catch_response=True,
            name=f"/api/v1/files/{{bucket}}/{{path}} [{operation_name}]"
        ) as response:
            if response.status_code in [200, 201]:
                self.uploaded_files.append(file_path)
                response.success()
            elif response.status_code == 404:
                response.success()  # Bucket might have been deleted
            else:
                response.failure(f"Upload failed: {response.status_code} - {response.text}")
    
    # ─────────────────────────────────────────────────────────────────────────
    # File Download Operations
    # ─────────────────────────────────────────────────────────────────────────
    
    @task(5)
    def download_file(self):
        """Download a previously uploaded file."""
        if not self.bucket_name or not self.uploaded_files:
            return
        
        file_path = random.choice(self.uploaded_files)
        
        with self.client.get(
            f"/api/v1/files/{self.bucket_name}/{file_path}",
            catch_response=True,
            name="/api/v1/files/{bucket}/{path} [Download]"
        ) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 404:
                # File might have been deleted, remove from list
                if file_path in self.uploaded_files:
                    self.uploaded_files.remove(file_path)
                response.success()
            else:
                response.failure(f"Download failed: {response.status_code}")
    
    # ─────────────────────────────────────────────────────────────────────────
    # File Delete Operations
    # ─────────────────────────────────────────────────────────────────────────
    
    @task(1)
    def delete_file(self):
        """Delete a previously uploaded file."""
        if not self.bucket_name or not self.uploaded_files:
            return
        
        # Only delete if we have more than 3 files
        if len(self.uploaded_files) <= 3:
            return
        
        file_path = self.uploaded_files.pop(random.randint(0, len(self.uploaded_files) - 1))
        
        with self.client.delete(
            f"/api/v1/files/{self.bucket_name}/{file_path}",
            catch_response=True,
            name="/api/v1/files/{bucket}/{path} [Delete]"
        ) as response:
            if response.status_code in [200, 204]:
                response.success()
            elif response.status_code == 404:
                response.success()  # Already deleted
            else:
                response.failure(f"Delete failed: {response.status_code}")


class BucketOnlyBehavior(SequentialTaskSet):
    """
    Task set for testing bucket operations only (no file operations).
    Useful for testing bucket management under load.
    """
    
    created_buckets = []
    
    @task(3)
    def list_buckets(self):
        """List all buckets."""
        with self.client.get(
            "/api/v1/buckets",
            catch_response=True,
            name="/api/v1/buckets [List]"
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Failed: {response.status_code}")
    
    @task(2)
    def create_bucket(self):
        """Create a new bucket."""
        bucket_name = f"bench-{generate_bucket_name()}"
        
        with self.client.post(
            "/api/v1/buckets",
            json={"name": bucket_name, "public": random.choice([True, False])},
            catch_response=True,
            name="/api/v1/buckets [Create]"
        ) as response:
            if response.status_code in [200, 201]:
                self.created_buckets.append(bucket_name)
                response.success()
            else:
                response.failure(f"Failed: {response.status_code} - {response.text}")
    
    @task(2)
    def get_bucket(self):
        """Get bucket details."""
        if not self.created_buckets:
            return
        
        bucket = random.choice(self.created_buckets)
        
        with self.client.get(
            f"/api/v1/buckets/{bucket}",
            catch_response=True,
            name="/api/v1/buckets/{bucket} [Get]"
        ) as response:
            if response.status_code in [200, 404]:
                response.success()
            else:
                response.failure(f"Failed: {response.status_code}")
    
    @task(1)
    def delete_bucket(self):
        """Delete a bucket."""
        if not self.created_buckets or len(self.created_buckets) <= 2:
            return
        
        bucket = self.created_buckets.pop(random.randint(0, len(self.created_buckets) - 1))
        
        with self.client.delete(
            f"/api/v1/buckets/{bucket}",
            catch_response=True,
            name="/api/v1/buckets/{bucket} [Delete]"
        ) as response:
            if response.status_code in [200, 204, 404]:
                response.success()
            else:
                response.failure(f"Failed: {response.status_code}")


# ─────────────────────────────────────────────────────────────────────────────
# Locust User Classes
# ─────────────────────────────────────────────────────────────────────────────

class StorageUser(HttpUser):
    """
    Simulated storage user performing full CRUD operations.
    
    Configuration:
    - wait_time: Random wait between 0.5-2 seconds between tasks
    - weight: 3 (most common user type)
    """
    tasks = [StorageUserBehavior]
    wait_time = between(0.5, 2)
    weight = 3
    
    def on_start(self):
        """Setup headers."""
        self.client.headers = {
            "User-Agent": "Locust Storage Test - Full CRUD"
        }


class BucketUser(HttpUser):
    """
    Simulated user performing bucket operations only.
    
    Configuration:
    - wait_time: Random wait between 0.5-1 second between tasks
    - weight: 1
    """
    tasks = [BucketOnlyBehavior]
    wait_time = between(0.5, 1)
    weight = 1
    
    def on_start(self):
        """Setup headers."""
        self.client.headers = {
            "User-Agent": "Locust Storage Test - Bucket Only"
        }


class LargeFileUser(HttpUser):
    """
    User that uploads and downloads large files (> 500 MB).
    Use this to test large file handling and throughput.
    
    Run specifically:
        locust -f locustfile.py --host=http://localhost:8000 -u 5 -r 1 --run-time 5m --headless LargeFileUser
    """
    wait_time = between(2, 5)  # Longer wait for large files
    weight = 0  # Exclude from normal runs
    
    bucket_name = None
    uploaded_files = []
    
    def on_start(self):
        """Create bucket for large files."""
        self.bucket_name = f"large-{generate_bucket_name()}"
        self.uploaded_files = []
        
        self.client.post(
            "/api/v1/buckets",
            json={"name": self.bucket_name, "public": False}
        )
    
    def on_stop(self):
        """Cleanup."""
        for f in self.uploaded_files:
            self.client.delete(f"/api/v1/files/{self.bucket_name}/{f}")
        self.client.delete(f"/api/v1/buckets/{self.bucket_name}")
    
    @task(3)
    def upload_large_file(self):
        """Upload a large or xlarge file."""
        # Get large or xlarge files
        available_files = TEST_FILES.get("large", []) + TEST_FILES.get("xlarge", [])
        if not available_files:
            # Fallback to medium files
            available_files = TEST_FILES.get("medium", [])
        if not available_files:
            return
        
        file_info = random.choice(available_files)
        file_path = generate_file_path(file_info["name"])
        content_type = get_content_type(file_info["name"])
        
        try:
            content = get_file_content(file_info)
        except Exception as e:
            print(f"Error reading file {file_info['path']}: {e}")
            return
        
        files = {
            "file": (file_info["name"], content, content_type)
        }
        
        with self.client.post(
            f"/api/v1/files/{self.bucket_name}/{file_path}",
            files=files,
            catch_response=True,
            name=f"/api/v1/files/{{bucket}}/{{path}} [Large Upload - {human_size(file_info['size'])}]"
        ) as response:
            if response.status_code in [200, 201]:
                self.uploaded_files.append(file_path)
                response.success()
            else:
                response.failure(f"Upload failed: {response.status_code}")
    
    @task(2)
    def download_large_file(self):
        """Download a large file."""
        if not self.uploaded_files:
            return
        
        file_path = random.choice(self.uploaded_files)
        
        with self.client.get(
            f"/api/v1/files/{self.bucket_name}/{file_path}",
            catch_response=True,
            name="/api/v1/files/{bucket}/{path} [Large Download]"
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Download failed: {response.status_code}")


class XLargeFileUser(HttpUser):
    """
    User specifically for testing extra-large files (> 1 GB).
    Tests unlimited storage capability.
    
    Run specifically:
        locust -f locustfile.py --host=http://localhost:8000 -u 2 -r 1 --run-time 10m --headless XLargeFileUser
    """
    wait_time = between(5, 10)  # Long wait for GB-sized files
    weight = 0  # Exclude from normal runs
    
    bucket_name = None
    uploaded_files = []
    
    def on_start(self):
        """Create bucket for xlarge files."""
        self.bucket_name = f"xlarge-{generate_bucket_name()}"
        self.uploaded_files = []
        
        self.client.post(
            "/api/v1/buckets",
            json={"name": self.bucket_name, "public": False}
        )
    
    def on_stop(self):
        """Cleanup."""
        for f in self.uploaded_files:
            self.client.delete(f"/api/v1/files/{self.bucket_name}/{f}")
        self.client.delete(f"/api/v1/buckets/{self.bucket_name}")
    
    @task
    def upload_xlarge_file(self):
        """Upload an extra-large file (> 1 GB)."""
        xlarge_files = TEST_FILES.get("xlarge", [])
        if not xlarge_files:
            print("No xlarge files available for testing")
            return
        
        file_info = random.choice(xlarge_files)
        file_path = generate_file_path(file_info["name"])
        content_type = get_content_type(file_info["name"])
        
        print(f"Uploading {file_info['name']} ({human_size(file_info['size'])})")
        
        try:
            content = get_file_content(file_info)
        except Exception as e:
            print(f"Error reading file {file_info['path']}: {e}")
            return
        
        files = {
            "file": (file_info["name"], content, content_type)
        }
        
        with self.client.post(
            f"/api/v1/files/{self.bucket_name}/{file_path}",
            files=files,
            catch_response=True,
            name=f"/api/v1/files/{{bucket}}/{{path}} [XLarge Upload - {human_size(file_info['size'])}]"
        ) as response:
            if response.status_code in [200, 201]:
                self.uploaded_files.append(file_path)
                response.success()
                print(f"✓ Uploaded {file_info['name']}")
            else:
                response.failure(f"Upload failed: {response.status_code}")
                print(f"✗ Failed to upload {file_info['name']}: {response.status_code}")


# ─────────────────────────────────────────────────────────────────────────────
# Event Hooks
# ─────────────────────────────────────────────────────────────────────────────

@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Called when test starts."""
    total_files = len(TEST_FILES.get("all", []))
    total_size = sum(f["size"] for f in TEST_FILES.get("all", []))
    
    print("\n" + "=" * 70)
    print("  STORAGE SERVICE LOAD TEST STARTED")
    print("=" * 70)
    print(f"  Host: {environment.host}")
    print(f"  Test files: {total_files} ({human_size(total_size)})")
    print(f"    - Small (<10MB): {len(TEST_FILES.get('small', []))}")
    print(f"    - Medium (10-500MB): {len(TEST_FILES.get('medium', []))}")
    print(f"    - Large (500MB-1GB): {len(TEST_FILES.get('large', []))}")
    print(f"    - XLarge (>1GB): {len(TEST_FILES.get('xlarge', []))}")
    print("=" * 70 + "\n")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Called when test stops."""
    print("\n" + "=" * 70)
    print("  STORAGE SERVICE LOAD TEST COMPLETED")
    print("=" * 70 + "\n")
