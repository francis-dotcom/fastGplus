# SelfDB Python SDK

Python SDK for SelfDB - Full Self-Hosted BaaS Built for AI Agents.

## Installation

```bash
pip install selfdb
```

Or install from source:

```bash
pip install -e .
```

## Quick Start

```python
import asyncio
from selfdb import SelfDB

async def main():
    # Initialize the client
    selfdb = SelfDB(
        base_url="http://localhost:8000",
        api_key="your-api-key"
    )

    # Authenticate
    await selfdb.auth.login(email="user@example.com", password="password")

    # Get current user
    user = await selfdb.auth.me()
    print(f"Logged in as: {user.email}")

    # List tables
    tables = await selfdb.tables.list()
    print(f"Found {len(tables)} tables")

    # Close the client
    await selfdb.close()

asyncio.run(main())
```

## Features

- **Authentication**: Login, logout, token refresh, user management
- **Tables**: CRUD operations, column management, data queries with fluent builder
- **Storage**: Bucket and file management, upload/download
- **Realtime**: WebSocket subscriptions for live updates

## Authentication

```python
# Login
await selfdb.auth.login(email="...", password="...")

# Get current user
user = await selfdb.auth.me()

# Refresh token
await selfdb.auth.refresh()

# Logout
await selfdb.auth.logout()

# Logout from all devices
await selfdb.auth.logout_all()

# User management (admin)
users = await selfdb.auth.users.list()
user = await selfdb.auth.users.create(UserCreate(email="...", password="..."))
await selfdb.auth.users.delete(user_id)
```

## Tables

```python
from selfdb.models import TableCreate, ColumnDefinition

# Create a table
table = await selfdb.tables.create(TableCreate(
    name="my_table",
    columns=[
        ColumnDefinition(name="id", type="UUID", primary_key=True),
        ColumnDefinition(name="title", type="TEXT"),
    ],
    public=False,
))

# List tables
tables = await selfdb.tables.list(search="my", sort_by="created_at")

# Insert data
await selfdb.tables.data.insert(table.id, {"id": "...", "title": "Hello"})

# Query with fluent builder
result = await selfdb.tables.data.query(table.id) \
    .search("hello") \
    .sort("created_at", "desc") \
    .page(1) \
    .page_size(25) \
    .execute()

# Update row
await selfdb.tables.data.update_row(table.id, row_id, {"title": "Updated"})

# Delete row
await selfdb.tables.data.delete_row(table.id, row_id)

# Delete table
await selfdb.tables.delete(table.id)
```

## Storage

```python
from selfdb.models import BucketCreate

# Create a bucket
bucket = await selfdb.storage.buckets.create(BucketCreate(
    name="my-bucket",
    public=False,
))

# Upload a file
with open("file.pdf", "rb") as f:
    result = await selfdb.storage.files.upload(bucket.id, "file.pdf", f)

# Download a file
content = await selfdb.storage.files.download("my-bucket", "file.pdf")

# List files
files = await selfdb.storage.files.list(bucket_id=bucket.id)

# Delete file
await selfdb.storage.files.delete(file_id)

# Delete bucket
await selfdb.storage.buckets.delete(bucket.id)
```

## Realtime

```python
# Connect to realtime
await selfdb.realtime.connect()

# Create a channel for a topic
channel = selfdb.realtime.channel("table:users")

# Register callbacks (chainable)
channel.on("INSERT", lambda p: print("New user:", p.new))
channel.on("UPDATE", lambda p: print("Updated:", p.new, "from:", p.old))
channel.on("DELETE", lambda p: print("Deleted:", p.old))
channel.on("*", lambda p: print("Any event:", p.event))

# Subscribe to start receiving events
await channel.subscribe()

# Access payload properties
# p.event  - "INSERT", "UPDATE", or "DELETE"
# p.table  - table name
# p.new    - new row data (dict or None)
# p.old    - old row data (dict or None)

# Unsubscribe from channel
await channel.unsubscribe()

# Disconnect from realtime
await selfdb.realtime.disconnect()
```

## Error Handling

```python
from selfdb.exceptions import (
    SelfDBError,
    APIConnectionError,
    BadRequestError,
    AuthenticationError,
    PermissionDeniedError,
    NotFoundError,
    ConflictError,
    InternalServerError,
)

try:
    await selfdb.tables.get("nonexistent-id")
except NotFoundError:
    print("Table not found")
except PermissionDeniedError:
    print("Access denied")
except SelfDBError as e:
    print(f"API error: {e}")
```

## Context Manager

```python
async with SelfDB(base_url="...", api_key="...") as selfdb:
    await selfdb.auth.login(email="...", password="...")
    # ... use the client
# Automatically closes when exiting context
```

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Type check
mypy selfdb

# Lint
ruff check selfdb
```

## License

MIT License
