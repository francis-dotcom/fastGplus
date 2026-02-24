## This is how I want the SDK to be structured. 

```python
from selfdb import SelfDB


selfdb = SelfDB(
    base_url="https://api.your-domain.local",
    api_key="your-api-key"
)
```

### Error Hierarchy

```python
from selfdb.exceptions import (
    SelfDBError,           # Base exception
    APIConnectionError,    # Network failures
    BadRequestError,       # 400
    AuthenticationError,   # 401
    PermissionDeniedError, # 403
    NotFoundError,         # 404
    ConflictError,         # 409
    InternalServerError,   # 500
)
```

### Models

```python
from selfdb.models import (
    # User models - NOTE: API uses camelCase for firstName/lastName
    UserCreate,    # email, password, firstName, lastName (all required)
    UserUpdate,    # firstName, lastName, password (all optional)
    UserRole,      # Enum: USER, ADMIN (uppercase values)
    
    # Table models - NOTE: table_schema is flat dict, not JSON Schema
    TableCreate,   # name, table_schema: {"column": {"type": "text", "nullable": True}}, public
    TableUpdate,   # name, public, realtime_enabled (uses realtime_enabled not realtime)
    ColumnDefinition,  # name, type, nullable, default_value
    ColumnUpdate,      # new_name, type, nullable, default_value
    
    # Storage models
    BucketCreate,  # name, public
    BucketUpdate,  # name, public
    
    # Response models
    FileUploadResponse,  # success, bucket, path, size, file_id
)

# Table schema format (flat dict, not JSON Schema):
table_schema = {
    "name": {"type": "text", "nullable": False},
    "age": {"type": "integer", "nullable": True},
    "active": {"type": "boolean", "nullable": True, "default": True}
}
# Supported types: text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
```

### Authentication (users)

```python
# All methods are async
await selfdb.auth.login(email="...", password="...")  # POST /users/token
await selfdb.auth.refresh(refresh_token="...")          # POST /users/token/refresh
await selfdb.auth.logout(refresh_token="...")           # POST /users/logout
await selfdb.auth.logout_all()                           # POST /users/logout/all
await selfdb.auth.me()                                   # GET /users/me
await selfdb.auth.count(search="eve")                   # GET /users/count?search=eve (search optional)

# exposed collection helpers
# NOTE: UserCreate uses camelCase: firstName, lastName (not first_name, last_name)
await selfdb.auth.users.create(payload=UserCreate(
    email="user@example.com",
    password="password123",
    firstName="John",      # camelCase required
    lastName="Doe"         # camelCase required
))  # POST /users/
await selfdb.auth.users.list(limit=25)                    # GET /users/
await selfdb.auth.users.get(user_id)
await selfdb.auth.users.update(user_id, payload=UserUpdate(...))
await selfdb.auth.users.delete(user_id)
```

### Tables

```python
# All methods are async
await selfdb.tables.count(search="docs")                # GET /tables/count?search=docs (search optional)

# NOTE: table_schema is flat dict format, not JSON Schema
table = await selfdb.tables.create(payload=TableCreate(
    name="users",
    table_schema={
        "name": {"type": "text", "nullable": False},
        "email": {"type": "varchar", "nullable": False}
    },
    public=False
))  # POST /tables/

tables = await selfdb.tables.list(skip=0, limit=50, search="docs", sort_by="created_at", sort_order="desc")  # GET /tables/

table = await selfdb.tables.get(table_id)

# NOTE: TableUpdate uses realtime_enabled (not realtime)
updated = await selfdb.tables.update(table_id, TableUpdate(
    name="new_name",
    public=True,
    realtime_enabled=True  # Enable realtime updates
))
await selfdb.tables.delete(table_id)

# columns
await selfdb.tables.columns.add(table_id, ColumnDefinition(...))
await selfdb.tables.columns.update(table_id, "name", ColumnUpdate(...))
await selfdb.tables.columns.remove(table_id, "name")

# data - basic methods
await selfdb.tables.data.fetch(table_id, page=2, page_size=25, sort_by="created_at", search="query")
await selfdb.tables.data.insert(table_id, {"text": "hi"})
await selfdb.tables.data.update_row(table_id, row_id, updates, id_column="id")
await selfdb.tables.data.delete_row(table_id, row_id, id_column="id")

# ─────────────────────────────────────────────────────────────────────────────
# Query Builder Pattern for Table Data (Fluent API)
# ─────────────────────────────────────────────────────────────────────────────
# The query builder provides a chainable interface for constructing queries
# that map directly to GET /tables/{table_id}/data endpoint parameters:
#   - page (int, >=1, default=1)
#   - page_size (int, 1-1000, default=100)
#   - search (string, max 100 chars) - searches across all text/varchar columns
#   - sort_by (column name) - must be valid column in table schema
#   - sort_order ("asc" | "desc", default="desc")

# Create a query builder instance
query = selfdb.tables.data.query(table_id)

# Available chainable methods:
result = await query \
    .search("hello") \              # Filter: ILIKE search across text columns
    .sort("created_at", "desc") \   # Sort by column (asc/desc)
    .page(2) \                      # Set page number (1-indexed)
    .page_size(50) \                # Set results per page (1-1000)
    .execute()                      # Execute query and return TableDataResponse

# Response structure:
# {
#     "data": [...],      # List of row dicts
#     "total": 150,       # Total matching rows (for pagination)
#     "page": 2,          # Current page
#     "page_size": 50     # Results per page
# }

# ─── Query Builder Examples ──────────────────────────────────────────────────

# Simple search with defaults
result = await selfdb.tables.data.query(table_id) \
    .search("hello") \
    .execute()
# GET /tables/{table_id}/data?search=hello

# Paginated results with sorting
result = await selfdb.tables.data.query(table_id) \
    .sort("created_at", "desc") \
    .page(2) \
    .page_size(25) \
    .execute()
# GET /tables/{table_id}/data?sort_by=created_at&sort_order=desc&page=2&page_size=25

# Full query with all parameters
result = await selfdb.tables.data.query(table_id) \
    .search("important") \
    .sort("updated_at", "asc") \
    .page(3) \
    .page_size(100) \
    .execute()
# GET /tables/{table_id}/data?search=important&sort_by=updated_at&sort_order=asc&page=3&page_size=100

# Reusable query builders (immutable - each method returns new instance)
base_query = selfdb.tables.data.query(table_id).sort("created_at", "desc")
page1 = await base_query.page(1).execute()
page2 = await base_query.page(2).execute()

# Query builder with ascending sort (useful for chronological data)
oldest_first = await selfdb.tables.data.query(table_id) \
    .sort("created_at", "asc") \
    .page_size(10) \
    .execute()

# Shorthand: one-liner query execution
result = await selfdb.tables.data.query(table_id).search("term").sort("name").execute()
```

### Realtime (Phoenix Channels WebSocket)

```python
# Realtime uses Phoenix Channels protocol over WebSocket
# WebSocket endpoint: WS /realtime/socket/websocket?vsn=2.0.0&X-API-Key=<key>&token=<jwt>

# Connect to the realtime server
await selfdb.realtime.connect()

# Channel-based API (fluent pattern)
# Create a channel for a topic and register event handlers
channel = selfdb.realtime.channel("table:users") \
    .on("INSERT", lambda payload: print(f"New user: {payload.new}")) \
    .on("UPDATE", lambda payload: print(f"Updated: {payload.old} -> {payload.new}")) \
    .on("DELETE", lambda payload: print(f"Deleted: {payload.old}")) \
    .on("*", lambda payload: print(f"Any event: {payload.event}"))  # Wildcard

# Subscribe to the channel (sends phx_join)
await channel.subscribe()

# Payload structure received in callbacks:
# RealtimePayload:
#   - event: str ("INSERT", "UPDATE", "DELETE")
#   - table: str (table name)
#   - new: dict | None (new row data for INSERT/UPDATE)
#   - old: dict | None (old row data for UPDATE/DELETE)
#   - raw: dict (full raw payload)

# Unsubscribe from a channel (sends phx_leave)
await channel.unsubscribe()

# Disconnect from realtime server
await selfdb.realtime.disconnect()

# ─── Usage Example ───────────────────────────────────────────────────────────

async def main():
    selfdb = SelfDB(base_url="http://localhost:8000", api_key="your-key")
    
    # Login to get JWT token (required for realtime)
    await selfdb.auth.login(email="admin@example.com", password="password")
    
    # Connect and subscribe
    await selfdb.realtime.connect()
    
    channel = selfdb.realtime.channel("table:orders") \
        .on("INSERT", lambda p: print(f"New order: {p.new}"))
    await channel.subscribe()
    
    # ... do work, events will be received ...
    
    # Cleanup
    await channel.unsubscribe()
    await selfdb.realtime.disconnect()

# ─── Protocol Details ────────────────────────────────────────────────────────
# The SDK implements Phoenix Channels protocol:
# - phx_join: Subscribe to a topic
# - phx_leave: Unsubscribe from a topic  
# - heartbeat: Sent every 30s to keep connection alive
# - Broadcast events: INSERT, UPDATE, DELETE on subscribed tables
```

### Storage (buckets + files)

```python
# All methods are async
# buckets
await selfdb.storage.buckets.count(search="uploads")   # GET /storage/buckets/count?search=uploads (search optional)
await selfdb.storage.buckets.create(payload=BucketCreate(...))
await selfdb.storage.buckets.list(limit=20)
await selfdb.storage.buckets.get(bucket_id)
await selfdb.storage.buckets.update(bucket_id, BucketUpdate(public=True))
await selfdb.storage.buckets.delete(bucket_id)

# files
await selfdb.storage.files.stats()                      # GET /storage/files/stats
await selfdb.storage.files.total_count(search="pdf")   # GET /storage/files/total-count?search=pdf (search optional)
await selfdb.storage.files.count(bucket_id=bucket_id)

# NOTE: Upload sends raw bytes body with query params (not multipart)
# POST /storage/buckets/{bucket_id}/files?filename=notes.pdf&path=/docs
response = await selfdb.storage.files.upload(bucket_id, filename="notes.pdf", data=file_bytes)
# Response: FileUploadResponse(success=True, bucket="bucket-name", path="/notes.pdf", size=1234, file_id="uuid")

await selfdb.storage.files.list(bucket_id=bucket_id, page_size=50)
await selfdb.storage.files.get(file_id)
await selfdb.storage.files.delete(file_id)  # Returns 204 No Content
await selfdb.storage.files.update_metadata(file_id, {"tag": "archive"})
await selfdb.storage.files.download(bucket_name="public", path="notes.pdf")
```

---

## Implementation Notes

These are important details discovered during SDK implementation that differ from typical conventions:

### API Field Naming
- **User fields use camelCase**: `firstName`, `lastName` (not `first_name`, `last_name`)
- **UserRole enum is uppercase**: `USER`, `ADMIN` (not `user`, `admin`)

### Table Schema Format
The `table_schema` field is a **flat dictionary**, not JSON Schema:
```python
# Correct format:
{
    "column_name": {
        "type": "text",       # Required: text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
        "nullable": True,     # Optional: default True
        "default": "value"    # Optional: default value
    }
}

# NOT JSON Schema format like:
# {"type": "object", "properties": {...}}
```

### File Upload
- Uses **raw bytes body** with query parameters (not multipart form-data)
- Query params: `filename`, `path` (optional)
- Response fields: `success`, `bucket`, `path`, `size`, `file_id`

### Realtime Protocol  
- Uses **Phoenix Channels** protocol (Elixir/Phoenix framework)
- WebSocket path: `/realtime/socket/websocket?vsn=2.0.0`
- Messages: `phx_join`, `phx_leave`, `heartbeat`
- Heartbeat interval: 30 seconds
- Events broadcast: `INSERT`, `UPDATE`, `DELETE`

### TableUpdate
- Uses `realtime_enabled` field (not `realtime`)

