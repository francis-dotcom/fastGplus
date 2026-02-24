## This is how I want the TypeScript SDK to be structured.

```typescript
import { SelfDB } from '@selfdb/js-sdk';

const selfdb = new SelfDB({
    baseUrl: 'https://api.your-domain.local',
    apiKey: 'your-api-key',
});
```

### Error Hierarchy

```typescript
import {
    SelfDBError,           // Base exception
    APIConnectionError,    // Network failures
    BadRequestError,       // 400
    AuthenticationError,   // 401
    PermissionDeniedError, // 403
    NotFoundError,         // 404
    ConflictError,         // 409
    InternalServerError,   // 500
} from '@selfdb/js-sdk';
```

### Models

```typescript
import {
    // User models - NOTE: API uses camelCase for firstName/lastName
    UserCreate,    // { email, password, firstName, lastName } (all required)
    UserUpdate,    // { firstName?, lastName?, password? } (all optional)
    UserRole,      // 'USER' | 'ADMIN' (uppercase values)
    
    // Table models - NOTE: table_schema is flat dict, not JSON Schema
    TableCreate,   // { name, table_schema, public }
    TableUpdate,   // { name?, public?, realtime_enabled? } (uses realtime_enabled not realtime)
    ColumnDefinition,  // { name, type, nullable?, default_value? }
    ColumnUpdate,      // { new_name?, type?, nullable?, default_value? }
    
    // Storage models
    BucketCreate,  // { name, public }
    BucketUpdate,  // { name?, public? }
    
    // Response models
    FileUploadResponse,  // { success, bucket, path, size, file_id }
} from '@selfdb/js-sdk';

// Table schema format (flat object, not JSON Schema):
const tableSchema = {
    name: { type: 'text', nullable: false },
    age: { type: 'integer', nullable: true },
    active: { type: 'boolean', nullable: true, default: true }
};
// Supported types: text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
```

### Authentication (users)

```typescript
// All methods are async
await selfdb.auth.login({ email: '...', password: '...' });  // POST /users/token
await selfdb.auth.refresh({ refreshToken: '...' });          // POST /users/token/refresh
await selfdb.auth.logout({ refreshToken: '...' });           // POST /users/logout
await selfdb.auth.logoutAll();                               // POST /users/logout/all
await selfdb.auth.me();                                      // GET /users/me
await selfdb.auth.count({ search: 'eve' });                  // GET /users/count?search=eve (search optional)

// exposed collection helpers
// NOTE: UserCreate uses camelCase: firstName, lastName (not first_name, last_name)
await selfdb.auth.users.create({
    email: 'user@example.com',
    password: 'password123',
    firstName: 'John',      // camelCase required
    lastName: 'Doe'         // camelCase required
});  // POST /users/
await selfdb.auth.users.list({ limit: 25 });                 // GET /users/
await selfdb.auth.users.get(userId);
await selfdb.auth.users.update(userId, { payload: UserUpdate });
await selfdb.auth.users.delete(userId);
```

### Tables

```typescript
// All methods are async
await selfdb.tables.count({ search: 'docs' });               // GET /tables/count?search=docs (search optional)

// NOTE: table_schema is flat object format, not JSON Schema
const table = await selfdb.tables.create({
    name: 'users',
    table_schema: {
        name: { type: 'text', nullable: false },
        email: { type: 'varchar', nullable: false }
    },
    public: false
});  // POST /tables/

const tables = await selfdb.tables.list({ skip: 0, limit: 50, search: 'docs', sortBy: 'created_at', sortOrder: 'desc' });  // GET /tables/

const table = await selfdb.tables.get(tableId);

// NOTE: TableUpdate uses realtime_enabled (not realtime)
const updated = await selfdb.tables.update(tableId, {
    name: 'new_name',
    public: true,
    realtime_enabled: true  // Enable realtime updates
});
await selfdb.tables.delete(tableId);

// columns
await selfdb.tables.columns.add(tableId, { payload: ColumnDefinition });
await selfdb.tables.columns.update(tableId, 'name', { payload: ColumnUpdate });
await selfdb.tables.columns.remove(tableId, 'name');

// data - basic methods
await selfdb.tables.data.fetch(tableId, { page: 2, pageSize: 25, sortBy: 'created_at', search: 'query' });
await selfdb.tables.data.insert(tableId, { text: 'hi' });
await selfdb.tables.data.updateRow(tableId, rowId, updates, { idColumn: 'id' });
await selfdb.tables.data.deleteRow(tableId, rowId, { idColumn: 'id' });

// ─────────────────────────────────────────────────────────────────────────────
// Query Builder Pattern for Table Data (Fluent API)
// ─────────────────────────────────────────────────────────────────────────────
// The query builder provides a chainable interface for constructing queries
// that map directly to GET /tables/{table_id}/data endpoint parameters:
//   - page (int, >=1, default=1)
//   - pageSize (int, 1-1000, default=100)
//   - search (string, max 100 chars) - searches across all text/varchar columns
//   - sortBy (column name) - must be valid column in table schema
//   - sortOrder ("asc" | "desc", default="desc")

// Create a query builder instance
const query = selfdb.tables.data.query(tableId);

// Available chainable methods:
const result = await query
    .search('hello')              // Filter: ILIKE search across text columns
    .sort('created_at', 'desc')   // Sort by column (asc/desc)
    .page(2)                      // Set page number (1-indexed)
    .pageSize(50)                 // Set results per page (1-1000)
    .execute();                   // Execute query and return TableDataResponse

// Response structure:
// {
//     data: [...],      // Array of row objects
//     total: 150,       // Total matching rows (for pagination)
//     page: 2,          // Current page
//     pageSize: 50      // Results per page
// }

// ─── Query Builder Examples ──────────────────────────────────────────────────

// Simple search with defaults
const result = await selfdb.tables.data.query(tableId)
    .search('hello')
    .execute();
// GET /tables/{table_id}/data?search=hello

// Paginated results with sorting
const result = await selfdb.tables.data.query(tableId)
    .sort('created_at', 'desc')
    .page(2)
    .pageSize(25)
    .execute();
// GET /tables/{table_id}/data?sort_by=created_at&sort_order=desc&page=2&page_size=25

// Full query with all parameters
const result = await selfdb.tables.data.query(tableId)
    .search('important')
    .sort('updated_at', 'asc')
    .page(3)
    .pageSize(100)
    .execute();
// GET /tables/{table_id}/data?search=important&sort_by=updated_at&sort_order=asc&page=3&page_size=100

// Reusable query builders (immutable - each method returns new instance)
const baseQuery = selfdb.tables.data.query(tableId).sort('created_at', 'desc');
const page1 = await baseQuery.page(1).execute();
const page2 = await baseQuery.page(2).execute();

// Shorthand: one-liner query execution
const result = await selfdb.tables.data.query(tableId).search('term').sort('name').execute();
```

### Realtime (Phoenix Channels WebSocket)

```typescript
// Realtime uses Phoenix Channels protocol over WebSocket
// WebSocket endpoint: WS /realtime/socket/websocket?vsn=2.0.0&X-API-Key=<key>&token=<jwt>

// Connect to the realtime server
await selfdb.realtime.connect();

// Channel-based API (fluent pattern)
// Create a channel for a topic and register event handlers
const channel = selfdb.realtime.channel('table:users')
    .on('INSERT', (payload) => console.log(`New user: ${payload.new}`))
    .on('UPDATE', (payload) => console.log(`Updated: ${payload.old} -> ${payload.new}`))
    .on('DELETE', (payload) => console.log(`Deleted: ${payload.old}`))
    .on('*', (payload) => console.log(`Any event: ${payload.event}`));  // Wildcard

// Subscribe to the channel (sends phx_join)
await channel.subscribe();

// Payload structure received in callbacks:
interface RealtimePayload {
    event: 'INSERT' | 'UPDATE' | 'DELETE';
    table: string;           // table name
    new: object | null;      // new row data for INSERT/UPDATE
    old: object | null;      // old row data for UPDATE/DELETE
    raw: object;             // full raw payload
}

// Unsubscribe from a channel (sends phx_leave)
await channel.unsubscribe();

// Disconnect from realtime server
await selfdb.realtime.disconnect();

// ─── Usage Example ───────────────────────────────────────────────────────────

async function main() {
    const selfdb = new SelfDB({ baseUrl: 'http://localhost:8000', apiKey: 'your-key' });
    
    // Login to get JWT token (required for realtime)
    await selfdb.auth.login({ email: 'admin@example.com', password: 'password' });
    
    // Connect and subscribe
    await selfdb.realtime.connect();
    
    const channel = selfdb.realtime.channel('table:orders')
        .on('INSERT', (p) => console.log(`New order: ${p.new}`));
    await channel.subscribe();
    
    // ... do work, events will be received ...
    
    // Cleanup
    await channel.unsubscribe();
    await selfdb.realtime.disconnect();
}

// ─── Protocol Details ────────────────────────────────────────────────────────
// The SDK implements Phoenix Channels protocol:
// - phx_join: Subscribe to a topic
// - phx_leave: Unsubscribe from a topic  
// - heartbeat: Sent every 30s to keep connection alive
// - Broadcast events: INSERT, UPDATE, DELETE on subscribed tables
```

### Storage (buckets + files)

```typescript
// All methods are async
// buckets
await selfdb.storage.buckets.count({ search: 'uploads' });   // GET /storage/buckets/count?search=uploads (search optional)
await selfdb.storage.buckets.create({ payload: BucketCreate });
await selfdb.storage.buckets.list({ limit: 20 });
await selfdb.storage.buckets.get(bucketId);
await selfdb.storage.buckets.update(bucketId, { payload: BucketUpdate });
await selfdb.storage.buckets.delete(bucketId);

// files
await selfdb.storage.files.stats();                          // GET /storage/files/stats
await selfdb.storage.files.totalCount({ search: 'pdf' });    // GET /storage/files/total-count?search=pdf (search optional)
await selfdb.storage.files.count({ bucketId });

// NOTE: Upload sends raw bytes body with query params (not multipart)
// POST /storage/buckets/{bucket_id}/files?filename=notes.pdf&path=/docs
const response = await selfdb.storage.files.upload(bucketId, { filename: 'notes.pdf', data: fileBytes });
// Response: { success: true, bucket: 'bucket-name', path: '/notes.pdf', size: 1234, file_id: 'uuid' }

await selfdb.storage.files.list({ bucketId, pageSize: 50 });
await selfdb.storage.files.get(fileId);
await selfdb.storage.files.delete(fileId);  // Returns 204 No Content
await selfdb.storage.files.updateMetadata(fileId, { tag: 'archive' });
await selfdb.storage.files.download({ bucketName: 'public', path: 'notes.pdf' });
```

---

## Implementation Notes

These are important details discovered during SDK implementation that differ from typical conventions:

### API Field Naming
- **User fields use camelCase**: `firstName`, `lastName` (not `first_name`, `last_name`)
- **UserRole enum is uppercase**: `'USER'`, `'ADMIN'` (not `'user'`, `'admin'`)

### Table Schema Format
The `table_schema` field is a **flat object**, not JSON Schema:
```typescript
// Correct format:
{
    column_name: {
        type: 'text',       // Required: text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
        nullable: true,     // Optional: default true
        default: 'value'    // Optional: default value
    }
}

// NOT JSON Schema format like:
// { type: 'object', properties: {...} }
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
