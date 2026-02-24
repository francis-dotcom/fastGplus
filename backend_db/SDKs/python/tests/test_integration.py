"""
SelfDB Python SDK Integration Tests.

Based on SDK-testing.MD criteria.
Requires a running SelfDB instance at http://localhost:8000.

Run with: python -m pytest tests/test_integration.py -v
Or standalone: python tests/test_integration.py
"""

import asyncio
import sys
import uuid
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(__file__).rsplit("/", 2)[0])

from selfdb import SelfDB
from selfdb.exceptions import PermissionDeniedError
from selfdb.models import (
    UserCreate,
    TableCreate,
    TableUpdate,
    BucketCreate,
)


# Test configuration
BASE_URL = "http://localhost:8000"
API_KEY = "selfdb-a213f2c0-71cd-8660-074c-ccc9dbde830a"
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "password"


class IntegrationTest:
    """Integration test runner for SelfDB SDK."""

    def __init__(self):
        self.admin_client: Optional[SelfDB] = None
        self.user_client: Optional[SelfDB] = None
        self.test_user_id: Optional[str] = None
        self.test_user_email: Optional[str] = None
        self.test_user_password: str = "testpass123"
        self.public_table_id: Optional[str] = None
        self.public_table_name: Optional[str] = None
        self.public_bucket_id: Optional[str] = None
        self.public_bucket_name: Optional[str] = None
        self.inserted_row_id: Optional[str] = None
        self.uploaded_file_id: Optional[str] = None
        self.errors: list[str] = []
        self.passed: list[str] = []

    def log_pass(self, test_name: str) -> None:
        """Log a passed test."""
        print(f"  ✅ {test_name}")
        self.passed.append(test_name)

    def log_fail(self, test_name: str, error: str) -> None:
        """Log a failed test."""
        print(f"  ❌ {test_name}: {error}")
        self.errors.append(f"{test_name}: {error}")

    async def run_all(self) -> bool:
        """Run all integration tests."""
        print("\n" + "=" * 60)
        print("SelfDB Python SDK Integration Tests")
        print("=" * 60)

        try:
            await self.test_1_client_setup_and_auth()
            await self.test_2_admin_creates_public_resources()
            await self.test_3_regular_user_consumes_public_resources()
            await self.test_4_regular_user_manages_own_resources()
            await self.test_5_realtime_updates()
        finally:
            await self.test_6_cleanup()

        # Summary
        print("\n" + "=" * 60)
        print("Test Summary")
        print("=" * 60)
        print(f"  Passed: {len(self.passed)}")
        print(f"  Failed: {len(self.errors)}")
        
        if self.errors:
            print("\nFailed tests:")
            for error in self.errors:
                print(f"  - {error}")
            return False
        
        print("\n✅ All tests passed!")
        return True

    async def test_1_client_setup_and_auth(self) -> None:
        """Test 1: Client Setup & Authentication."""
        print("\n📋 Test 1: Client Setup & Authentication")

        # Initialize admin client
        self.admin_client = SelfDB(base_url=BASE_URL, api_key=API_KEY)

        # Admin signs in
        try:
            await self.admin_client.auth.login(
                email=ADMIN_EMAIL,
                password=ADMIN_PASSWORD,
            )
            self.log_pass("Admin login")
        except Exception as e:
            self.log_fail("Admin login", str(e))
            raise

        # Create a new regular user via admin client
        self.test_user_email = f"testuser_{uuid.uuid4().hex[:8]}@example.com"
        try:
            user = await self.admin_client.auth.users.create(
                UserCreate(
                    email=self.test_user_email,
                    password=self.test_user_password,
                    firstName="Test",
                    lastName="User",
                )
            )
            self.test_user_id = user.id
            self.log_pass("Create regular user via admin")
        except Exception as e:
            self.log_fail("Create regular user via admin", str(e))
            raise

        # Initialize user client and sign in
        self.user_client = SelfDB(base_url=BASE_URL, api_key=API_KEY)
        try:
            await self.user_client.auth.login(
                email=self.test_user_email,
                password=self.test_user_password,
            )
            self.log_pass("Regular user login")
        except Exception as e:
            self.log_fail("Regular user login", str(e))
            raise

    async def test_2_admin_creates_public_resources(self) -> None:
        """Test 2: Admin Creates Public Resources."""
        print("\n📋 Test 2: Admin Creates Public Resources")

        # Create a PUBLIC table with schema
        self.public_table_name = f"test_table_{uuid.uuid4().hex[:8]}"
        try:
            table = await self.admin_client.tables.create(
                TableCreate(
                    name=self.public_table_name,
                    table_schema={
                        "id": {"type": "UUID", "nullable": False},
                        "title": {"type": "TEXT", "nullable": True},
                        "count": {"type": "INTEGER", "nullable": True},
                    },
                    public=True,
                    description="Integration test table",
                )
            )
            self.public_table_id = table.id
            self.log_pass("Create PUBLIC table")
        except Exception as e:
            self.log_fail("Create PUBLIC table", str(e))
            raise

        # Create a PUBLIC bucket
        self.public_bucket_name = f"test-bucket-{uuid.uuid4().hex[:8]}"
        try:
            bucket = await self.admin_client.storage.buckets.create(
                BucketCreate(
                    name=self.public_bucket_name,
                    public=True,
                    description="Integration test bucket",
                )
            )
            self.public_bucket_id = bucket.id
            self.log_pass("Create PUBLIC bucket")
        except Exception as e:
            self.log_fail("Create PUBLIC bucket", str(e))
            raise

    async def test_3_regular_user_consumes_public_resources(self) -> None:
        """Test 3: Regular User Consumes Public Resources."""
        print("\n📋 Test 3: Regular User Consumes Public Resources")

        # === Tables ===
        
        # Insert row into public table (should succeed)
        row_id = str(uuid.uuid4())
        try:
            result = await self.user_client.tables.data.insert(
                self.public_table_id,
                {"id": row_id, "title": "Test Title", "count": 42},
            )
            self.inserted_row_id = row_id
            self.log_pass("Insert row into public table")
        except Exception as e:
            self.log_fail("Insert row into public table", str(e))

        # Update row in public table (should fail with 403 - not owner)
        try:
            await self.user_client.tables.data.update_row(
                self.public_table_id,
                row_id,
                {"title": "Updated Title"},
            )
            self.log_fail("Update row in public table", "Expected 403 but succeeded")
        except PermissionDeniedError:
            self.log_pass("Update row in public table (403 expected)")
        except Exception as e:
            self.log_fail("Update row in public table", f"Expected 403, got: {e}")

        # Delete row in public table (should fail with 403 - not owner)
        try:
            await self.user_client.tables.data.delete_row(
                self.public_table_id,
                row_id,
            )
            self.log_fail("Delete row in public table", "Expected 403 but succeeded")
        except PermissionDeniedError:
            self.log_pass("Delete row in public table (403 expected)")
        except Exception as e:
            self.log_fail("Delete row in public table", f"Expected 403, got: {e}")

        # === Storage ===
        
        # Upload file to public bucket (should succeed)
        test_content = b"Hello, SelfDB Integration Test!"
        try:
            upload_result = await self.user_client.storage.files.upload(
                self.public_bucket_id,
                filename="test_file.txt",
                data=test_content,
            )
            self.uploaded_file_id = upload_result.file_id
            self.log_pass("Upload file to public bucket")
        except Exception as e:
            self.log_fail("Upload file to public bucket", str(e))

        # Download file from public bucket (should succeed, verify content matches)
        try:
            downloaded = await self.user_client.storage.files.download(
                self.public_bucket_name,
                "test_file.txt",
            )
            if downloaded == test_content:
                self.log_pass("Download file from public bucket (content matches)")
            else:
                self.log_fail("Download file from public bucket", "Content mismatch")
        except Exception as e:
            self.log_fail("Download file from public bucket", str(e))

    async def test_4_regular_user_manages_own_resources(self) -> None:
        """Test 4: Regular User Manages Own Resources."""
        print("\n📋 Test 4: Regular User Manages Own Resources")

        # === Tables ===
        
        # Create private table
        private_table_name = f"private_table_{uuid.uuid4().hex[:8]}"
        private_table_id = None
        try:
            table = await self.user_client.tables.create(
                TableCreate(
                    name=private_table_name,
                    table_schema={
                        "id": {"type": "UUID", "nullable": False},
                        "data": {"type": "TEXT", "nullable": True},
                    },
                    public=False,
                )
            )
            private_table_id = table.id
            self.log_pass("Create private table")
        except Exception as e:
            self.log_fail("Create private table", str(e))
            return

        # Insert row
        row_id = str(uuid.uuid4())
        try:
            await self.user_client.tables.data.insert(
                private_table_id,
                {"id": row_id, "data": "Initial data"},
            )
            self.log_pass("Insert row in own table")
        except Exception as e:
            self.log_fail("Insert row in own table", str(e))

        # Update own row
        try:
            await self.user_client.tables.data.update_row(
                private_table_id,
                row_id,
                {"data": "Updated data"},
            )
            self.log_pass("Update own row")
        except Exception as e:
            self.log_fail("Update own row", str(e))

        # Delete own row
        try:
            await self.user_client.tables.data.delete_row(
                private_table_id,
                row_id,
            )
            self.log_pass("Delete own row")
        except Exception as e:
            self.log_fail("Delete own row", str(e))

        # Delete own table
        try:
            await self.user_client.tables.delete(private_table_id)
            self.log_pass("Delete own table")
        except Exception as e:
            self.log_fail("Delete own table", str(e))

        # === Storage ===
        
        # Create private bucket
        private_bucket_name = f"private-bucket-{uuid.uuid4().hex[:8]}"
        private_bucket_id = None
        try:
            bucket = await self.user_client.storage.buckets.create(
                BucketCreate(
                    name=private_bucket_name,
                    public=False,
                )
            )
            private_bucket_id = bucket.id
            self.log_pass("Create private bucket")
        except Exception as e:
            self.log_fail("Create private bucket", str(e))
            return

        # Upload file to own bucket
        try:
            await self.user_client.storage.files.upload(
                private_bucket_id,
                filename="private_file.txt",
                data=b"Private content",
            )
            self.log_pass("Upload file to own bucket")
        except Exception as e:
            self.log_fail("Upload file to own bucket", str(e))

        # Delete own bucket
        try:
            await self.user_client.storage.buckets.delete(private_bucket_id)
            self.log_pass("Delete own bucket")
        except Exception as e:
            self.log_fail("Delete own bucket", str(e))

    async def test_5_realtime_updates(self) -> None:
        """Test 5: Realtime Updates."""
        print("\n📋 Test 5: Realtime Updates")

        received_events = []

        def on_insert(payload):
            print(f"  [Realtime] Received INSERT event: {payload}")
            received_events.append(payload)

        # Connect to WebSocket
        try:
            await self.user_client.realtime.connect()
            self.log_pass("Connect to WebSocket")
        except Exception as e:
            self.log_fail("Connect to WebSocket", str(e))
            return

        # Enable realtime on public table (admin)
        try:
            await self.admin_client.tables.update(
                self.public_table_id,
                TableUpdate(realtime_enabled=True),
            )
            self.log_pass("Enable realtime on table")
        except Exception as e:
            self.log_fail("Enable realtime on table", str(e))

        # Subscribe to table topic using channel API
        topic = f"table:{self.public_table_name}"
        try:
            channel = self.user_client.realtime.channel(topic)
            channel.on("INSERT", on_insert)
            await channel.subscribe()
            self.log_pass("Subscribe to table topic")
            self.log_pass("Register INSERT callback")
        except Exception as e:
            self.log_fail("Subscribe to table topic", str(e))
            return

        # Small delay to ensure subscription is active
        await asyncio.sleep(0.5)

        # Trigger insert via API (admin inserts into their own table)
        insert_id = str(uuid.uuid4())
        try:
            await self.admin_client.tables.data.insert(
                self.public_table_id,
                {"id": insert_id, "title": "Realtime Test", "count": 99},
            )
        except Exception as e:
            self.log_fail("Trigger insert", str(e))

        # Wait for event (up to 5 seconds)
        for _ in range(50):
            if received_events:
                break
            await asyncio.sleep(0.1)

        if received_events:
            self.log_pass("Receive realtime event within timeout")
        else:
            self.log_fail("Receive realtime event", "Timeout - no event received")

        # Disconnect
        try:
            await self.user_client.realtime.disconnect()
            self.log_pass("Disconnect from WebSocket")
        except Exception as e:
            self.log_fail("Disconnect from WebSocket", str(e))

    async def test_6_cleanup(self) -> None:
        """Test 6: Cleanup."""
        print("\n📋 Test 6: Cleanup")

        # Delete uploaded file
        if self.uploaded_file_id:
            try:
                await self.admin_client.storage.files.delete(self.uploaded_file_id)
                self.log_pass("Delete uploaded file")
            except Exception as e:
                self.log_fail("Delete uploaded file", str(e))

        # Delete public table
        if self.public_table_id:
            try:
                await self.admin_client.tables.delete(self.public_table_id)
                self.log_pass("Delete public table")
            except Exception as e:
                self.log_fail("Delete public table", str(e))

        # Delete public bucket
        if self.public_bucket_id:
            try:
                await self.admin_client.storage.buckets.delete(self.public_bucket_id)
                self.log_pass("Delete public bucket")
            except Exception as e:
                self.log_fail("Delete public bucket", str(e))

        # Delete regular user
        if self.test_user_id:
            try:
                await self.admin_client.auth.users.delete(self.test_user_id)
                self.log_pass("Delete regular user")
            except Exception as e:
                self.log_fail("Delete regular user", str(e))

        # Close clients
        if self.user_client:
            await self.user_client.close()
        if self.admin_client:
            await self.admin_client.close()
        self.log_pass("Close both clients")


async def main():
    """Run integration tests."""
    test = IntegrationTest()
    success = await test.run_all()
    return 0 if success else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
