## This is how I want the Swift SDK to be structured.

```swift
import SelfDB

let selfdb = SelfDB(
    baseUrl: "https://api.your-domain.local",
    apiKey: "your-api-key"
)
```

### Error Hierarchy

```swift
import SelfDB

// All errors conform to SelfDBError protocol
public enum SelfDBError: Error {
    case connectionError(Error)    // Network failures
    case badRequest(String)        // 400
    case authenticationError       // 401
    case permissionDenied          // 403
    case notFound                  // 404
    case conflict                  // 409
    case internalServerError       // 500
}
```

### Models

```swift
import SelfDB

// User models - NOTE: API uses camelCase for firstName/lastName
struct UserCreate: Codable {
    let email: String
    let password: String
    let firstName: String      // camelCase required
    let lastName: String       // camelCase required
}

struct UserUpdate: Codable {
    var firstName: String?     // camelCase required
    var lastName: String?      // camelCase required
    var password: String?
}

enum UserRole: String, Codable {
    case user = "USER"         // Uppercase values
    case admin = "ADMIN"       // Uppercase values
}

// Table models - NOTE: table_schema is flat dict, not JSON Schema
struct TableCreate: Codable {
    let name: String
    let tableSchema: [String: ColumnSchema]  // Flat dict format
    let `public`: Bool
}

struct TableUpdate: Codable {
    var name: String?
    var `public`: Bool?
    var realtimeEnabled: Bool?  // Uses realtime_enabled not realtime
}

struct ColumnSchema: Codable {
    let type: String           // text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
    var nullable: Bool?
    var `default`: Any?
}

// Storage models
struct FileUploadResponse: Codable {
    let success: Bool
    let bucket: String
    let path: String
    let size: Int
    let fileId: String
}

// Table schema format (flat dict, not JSON Schema):
let tableSchema: [String: ColumnSchema] = [
    "name": ColumnSchema(type: "text", nullable: false),
    "age": ColumnSchema(type: "integer", nullable: true),
    "active": ColumnSchema(type: "boolean", nullable: true, default: true)
]
// Supported types: text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
```

### Authentication (users)

```swift
// All methods are async
try await selfdb.auth.login(email: "...", password: "...")  // POST /users/token
try await selfdb.auth.refresh(refreshToken: "...")          // POST /users/token/refresh
try await selfdb.auth.logout(refreshToken: "...")           // POST /users/logout
try await selfdb.auth.logoutAll()                           // POST /users/logout/all
try await selfdb.auth.me()                                  // GET /users/me
try await selfdb.auth.count(search: "eve")                  // GET /users/count?search=eve (search optional)

// exposed collection helpers
// NOTE: UserCreate uses camelCase: firstName, lastName (not first_name, last_name)
try await selfdb.auth.users.create(payload: UserCreate(
    email: "user@example.com",
    password: "password123",
    firstName: "John",      // camelCase required
    lastName: "Doe"         // camelCase required
))  // POST /users/
try await selfdb.auth.users.list(limit: 25)                   // GET /users/
try await selfdb.auth.users.get(userId)
try await selfdb.auth.users.update(userId, payload: UserUpdate(...))
try await selfdb.auth.users.delete(userId)
```

### Tables

```swift
// All methods are async
try await selfdb.tables.count(search: "docs")               // GET /tables/count?search=docs (search optional)

// NOTE: table_schema is flat dict format, not JSON Schema
let table = try await selfdb.tables.create(payload: TableCreate(
    name: "users",
    tableSchema: [
        "name": ColumnSchema(type: "text", nullable: false),
        "email": ColumnSchema(type: "varchar", nullable: false)
    ],
    public: false
))  // POST /tables/

let tables = try await selfdb.tables.list(skip: 0, limit: 50, search: "docs", sortBy: .createdAt, sortOrder: .desc)  // GET /tables/

let table = try await selfdb.tables.get(tableId)

// NOTE: TableUpdate uses realtimeEnabled (not realtime)
let updated = try await selfdb.tables.update(tableId, payload: TableUpdate(
    name: "new_name",
    public: true,
    realtimeEnabled: true  // Enable realtime updates
))
try await selfdb.tables.delete(tableId)

// columns
try await selfdb.tables.columns.add(tableId, payload: ColumnDefinition(...))
try await selfdb.tables.columns.update(tableId, columnName: "name", payload: ColumnUpdate(...))
try await selfdb.tables.columns.remove(tableId, columnName: "name")

// data - basic methods
try await selfdb.tables.data.fetch(tableId, page: 2, pageSize: 25, sortBy: "created_at", search: "query")
try await selfdb.tables.data.insert(tableId, data: ["text": "hi"])
try await selfdb.tables.data.updateRow(tableId, rowId: rowId, updates: updates, idColumn: "id")
try await selfdb.tables.data.deleteRow(tableId, rowId: rowId, idColumn: "id")

// ─────────────────────────────────────────────────────────────────────────────
// Query Builder Pattern for Table Data (Fluent API)
// ─────────────────────────────────────────────────────────────────────────────
// The query builder provides a chainable interface for constructing queries
// that map directly to GET /tables/{table_id}/data endpoint parameters:
//   - page (Int, >=1, default=1)
//   - pageSize (Int, 1-1000, default=100)
//   - search (String, max 100 chars) - searches across all text/varchar columns
//   - sortBy (column name) - must be valid column in table schema
//   - sortOrder (.asc | .desc, default=.desc)

// Create a query builder instance
let query = selfdb.tables.data.query(tableId)

// Available chainable methods:
let result = try await query
    .search("hello")              // Filter: ILIKE search across text columns
    .sort("created_at", .desc)    // Sort by column (asc/desc)
    .page(2)                      // Set page number (1-indexed)
    .pageSize(50)                 // Set results per page (1-1000)
    .execute()                    // Execute query and return TableDataResponse

// Response structure:
// TableDataResponse {
//     data: [[String: Any]],  // Array of row dictionaries
//     total: Int,             // Total matching rows (for pagination)
//     page: Int,              // Current page
//     pageSize: Int           // Results per page
// }

// ─── Query Builder Examples ──────────────────────────────────────────────────

// Simple search with defaults
let result = try await selfdb.tables.data.query(tableId)
    .search("hello")
    .execute()
// GET /tables/{table_id}/data?search=hello

// Paginated results with sorting
let result = try await selfdb.tables.data.query(tableId)
    .sort("created_at", .desc)
    .page(2)
    .pageSize(25)
    .execute()
// GET /tables/{table_id}/data?sort_by=created_at&sort_order=desc&page=2&page_size=25

// Full query with all parameters
let result = try await selfdb.tables.data.query(tableId)
    .search("important")
    .sort("updated_at", .asc)
    .page(3)
    .pageSize(100)
    .execute()
// GET /tables/{table_id}/data?search=important&sort_by=updated_at&sort_order=asc&page=3&page_size=100

// Reusable query builders (immutable - each method returns new instance)
let baseQuery = selfdb.tables.data.query(tableId).sort("created_at", .desc)
let page1 = try await baseQuery.page(1).execute()
let page2 = try await baseQuery.page(2).execute()

// Shorthand: one-liner query execution
let result = try await selfdb.tables.data.query(tableId).search("term").sort("name").execute()
```

### Realtime (Phoenix Channels WebSocket)

```swift
// Realtime uses Phoenix Channels protocol over WebSocket
// WebSocket endpoint: WS /realtime/socket/websocket?vsn=2.0.0&X-API-Key=<key>&token=<jwt>

// Connect to the realtime server
try await selfdb.realtime.connect()

// Channel-based API (fluent pattern)
// Create a channel for a topic and register event handlers
let channel = selfdb.realtime.channel("table:users")
    .on(.insert) { payload in print("New user: \(payload.new)") }
    .on(.update) { payload in print("Updated: \(payload.old) -> \(payload.new)") }
    .on(.delete) { payload in print("Deleted: \(payload.old)") }
    .on(.all) { payload in print("Any event: \(payload.event)") }  // Wildcard

// Subscribe to the channel (sends phx_join)
try await channel.subscribe()

// Payload structure received in callbacks:
struct RealtimePayload {
    let event: RealtimeEvent      // .insert, .update, .delete
    let table: String             // table name
    let new: [String: Any]?       // new row data for INSERT/UPDATE
    let old: [String: Any]?       // old row data for UPDATE/DELETE
    let raw: [String: Any]        // full raw payload
}

enum RealtimeEvent {
    case insert
    case update
    case delete
    case all  // wildcard
}

// Unsubscribe from a channel (sends phx_leave)
try await channel.unsubscribe()

// Disconnect from realtime server
try await selfdb.realtime.disconnect()

// ─── Usage Example ───────────────────────────────────────────────────────────

func main() async throws {
    let selfdb = SelfDB(baseUrl: "http://localhost:8000", apiKey: "your-key")
    
    // Login to get JWT token (required for realtime)
    try await selfdb.auth.login(email: "admin@example.com", password: "password")
    
    // Connect and subscribe
    try await selfdb.realtime.connect()
    
    let channel = selfdb.realtime.channel("table:orders")
        .on(.insert) { p in print("New order: \(p.new)") }
    try await channel.subscribe()
    
    // ... do work, events will be received ...
    
    // Cleanup
    try await channel.unsubscribe()
    try await selfdb.realtime.disconnect()
}

// ─── Protocol Details ────────────────────────────────────────────────────────
// The SDK implements Phoenix Channels protocol:
// - phx_join: Subscribe to a topic
// - phx_leave: Unsubscribe from a topic  
// - heartbeat: Sent every 30s to keep connection alive
// - Broadcast events: INSERT, UPDATE, DELETE on subscribed tables
```

### Storage (buckets + files)

```swift
// All methods are async
// buckets
try await selfdb.storage.buckets.count(search: "uploads")   // GET /storage/buckets/count?search=uploads (search optional)
try await selfdb.storage.buckets.create(payload: BucketCreate(...))
try await selfdb.storage.buckets.list(limit: 20)
try await selfdb.storage.buckets.get(bucketId)
try await selfdb.storage.buckets.update(bucketId, payload: BucketUpdate(public: true))
try await selfdb.storage.buckets.delete(bucketId)

// files
try await selfdb.storage.files.stats()                      // GET /storage/files/stats
try await selfdb.storage.files.totalCount(search: "pdf")    // GET /storage/files/total-count?search=pdf (search optional)
try await selfdb.storage.files.count(bucketId: bucketId)

// NOTE: Upload sends raw bytes body with query params (not multipart)
// POST /storage/buckets/{bucket_id}/files?filename=notes.pdf&path=/docs
let response = try await selfdb.storage.files.upload(bucketId, filename: "notes.pdf", data: fileData)
// Response: FileUploadResponse(success: true, bucket: "bucket-name", path: "/notes.pdf", size: 1234, fileId: "uuid")

try await selfdb.storage.files.list(bucketId: bucketId, pageSize: 50)
try await selfdb.storage.files.get(fileId)
try await selfdb.storage.files.delete(fileId)  // Returns 204 No Content
try await selfdb.storage.files.updateMetadata(fileId, metadata: ["tag": "archive"])
try await selfdb.storage.files.download(bucketName: "public", path: "notes.pdf")
```

---

## Implementation Notes

These are important details discovered during SDK implementation that differ from typical conventions:

### API Field Naming
- **User fields use camelCase**: `firstName`, `lastName` (not `first_name`, `last_name`)
- **UserRole enum is uppercase**: `"USER"`, `"ADMIN"` (not `"user"`, `"admin"`)

### Table Schema Format
The `tableSchema` field is a **flat dictionary**, not JSON Schema:
```swift
// Correct format:
[
    "column_name": ColumnSchema(
        type: "text",       // Required: text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
        nullable: true,     // Optional: default true
        default: "value"    // Optional: default value
    )
]

// NOT JSON Schema format like:
// ["type": "object", "properties": [...]]
```

### File Upload
- Uses **raw bytes body** with query parameters (not multipart form-data)
- Query params: `filename`, `path` (optional)
- Response fields: `success`, `bucket`, `path`, `size`, `fileId`

### Realtime Protocol  
- Uses **Phoenix Channels** protocol (Elixir/Phoenix framework)
- WebSocket path: `/realtime/socket/websocket?vsn=2.0.0`
- Messages: `phx_join`, `phx_leave`, `heartbeat`
- Heartbeat interval: 30 seconds
- Events broadcast: `INSERT`, `UPDATE`, `DELETE`

### TableUpdate
- Uses `realtimeEnabled` field (not `realtime`)
