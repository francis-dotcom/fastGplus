# SelfDB Swift SDK

A Swift SDK for interacting with SelfDB - a full self-hosted Backend as a Service (BaaS) built for AI Agents.

## Requirements

- Swift 5.9+
- macOS 12+, iOS 15+, tvOS 15+, watchOS 8+

## Installation

### Swift Package Manager

Add the following to your `Package.swift` file:

```swift
dependencies: [
    .package(url: "https://github.com/your-org/selfdb-swift", from: "0.0.5")
]
```

Or add it directly in Xcode via File > Add Packages.

## Quick Start

```swift
import SelfDB

let selfdb = SelfDB(
    baseUrl: "http://localhost:8000",
    apiKey: "your-api-key"
)

// Login
let tokens = try await selfdb.auth.login(email: "user@example.com", password: "password")

// Create a table
let table = try await selfdb.tables.create(payload: TableCreate(
    name: "tasks",
    tableSchema: [
        "title": ColumnSchema(type: "text", nullable: false),
        "completed": ColumnSchema(type: "boolean", nullable: true, defaultValue: false)
    ],
    public: false
))

// Insert data
let row = try await selfdb.tables.data.insert(table.id, data: [
    "title": AnyCodable("My first task"),
    "completed": AnyCodable(false)
])
```

## Modules

### Authentication (`selfdb.auth`)

```swift
// Login
try await selfdb.auth.login(email: "...", password: "...")

// Refresh token
try await selfdb.auth.refresh(refreshToken: "...")

// Logout
try await selfdb.auth.logout(refreshToken: "...")
try await selfdb.auth.logoutAll()

// Get current user
let me = try await selfdb.auth.me()

// Get user count
let count = try await selfdb.auth.count(search: "eve")

// User CRUD via users collection
try await selfdb.auth.users.create(payload: UserCreate(...))
try await selfdb.auth.users.list(limit: 25)
try await selfdb.auth.users.get(userId)
try await selfdb.auth.users.update(userId, payload: UserUpdate(...))
try await selfdb.auth.users.delete(userId)
```

### Tables (`selfdb.tables`)

```swift
// Create table
let table = try await selfdb.tables.create(payload: TableCreate(
    name: "users",
    tableSchema: [
        "name": ColumnSchema(type: "text", nullable: false),
        "email": ColumnSchema(type: "varchar", nullable: false)
    ],
    public: false
))

// List tables
let tables = try await selfdb.tables.list(sortBy: .createdAt, sortOrder: .desc)

// Get, update, delete
try await selfdb.tables.get(tableId)
try await selfdb.tables.update(tableId, payload: TableUpdate(realtimeEnabled: true))
try await selfdb.tables.delete(tableId)

// Column operations
try await selfdb.tables.columns.add(tableId, payload: ColumnDefinition(...))
try await selfdb.tables.columns.update(tableId, columnName: "name", payload: ColumnUpdate(...))
try await selfdb.tables.columns.remove(tableId, columnName: "name")

// Data operations
try await selfdb.tables.data.fetch(tableId, page: 1, pageSize: 50)
try await selfdb.tables.data.insert(tableId, data: ["name": AnyCodable("John")])
try await selfdb.tables.data.updateRow(tableId, rowId: rowId, updates: updates)
try await selfdb.tables.data.deleteRow(tableId, rowId: rowId)

// Query builder (fluent API)
let result = try await selfdb.tables.data.query(tableId)
    .search("hello")
    .sort("created_at", .desc)
    .page(2)
    .pageSize(50)
    .execute()
```

### Storage (`selfdb.storage`)

```swift
// Buckets
try await selfdb.storage.buckets.create(payload: BucketCreate(name: "uploads", public: true))
try await selfdb.storage.buckets.list()
try await selfdb.storage.buckets.get(bucketId)
try await selfdb.storage.buckets.update(bucketId, payload: BucketUpdate(public: false))
try await selfdb.storage.buckets.delete(bucketId)

// Files
try await selfdb.storage.files.stats()
try await selfdb.storage.files.upload(bucketId, filename: "notes.pdf", data: fileData)
try await selfdb.storage.files.list(bucketId: bucketId)
try await selfdb.storage.files.get(fileId)
try await selfdb.storage.files.delete(fileId)
try await selfdb.storage.files.download(bucketName: "public", path: "notes.pdf")
```

### Realtime (`selfdb.realtime`)

```swift
// Connect
try await selfdb.realtime.connect()

// Check connection status
if selfdb.realtime.isConnected {
    print("Connected to realtime server")
}

// Subscribe to a table channel
let channel = selfdb.realtime.channel("table:users")
    .on(.insert) { payload in print("New user: \(payload.new)") }
    .on(.update) { payload in print("Updated: \(payload.new)") }
    .on(.delete) { payload in print("Deleted: \(payload.old)") }

try await channel.subscribe()

// ... later ...

try await channel.unsubscribe()
try await selfdb.realtime.disconnect()
```

## Error Handling

All SDK methods can throw `SelfDBError`:

```swift
public enum SelfDBError: Error {
    case connectionError(Error)    // Network failures
    case badRequest(String)        // 400
    case authenticationError       // 401
    case permissionDenied          // 403
    case notFound                  // 404
    case conflict                  // 409
    case internalServerError       // 500
    case unexpectedStatusCode(Int, String?)
    case invalidResponse
    case encodingError(Error)
    case decodingError(Error)
    case webSocketError(String)
}
```

Example:

```swift
do {
    let table = try await selfdb.tables.get(tableId)
} catch SelfDBError.notFound {
    print("Table not found")
} catch SelfDBError.permissionDenied {
    print("Access denied")
} catch {
    print("Error: \(error)")
}
```

## Models

### User Models
- `UserCreate` - Create user (email, password, firstName, lastName)
- `UserUpdate` - Update user (firstName?, lastName?, password?)
- `UserRead` - User response
- `UserRole` - `.user` or `.admin`

### Table Models
- `TableCreate` - Create table (name, tableSchema, public)
- `TableUpdate` - Update table (name?, public?, realtimeEnabled?)
- `TableRead` - Table response
- `ColumnSchema` - Column definition (type, nullable?, default?)
- `ColumnDefinition` - Add column request
- `ColumnUpdate` - Update column request
- `TableDataResponse` - Paginated data response

### Storage Models
- `BucketCreate` - Create bucket
- `BucketUpdate` - Update bucket
- `BucketResponse` - Bucket response
- `FileUploadResponse` - Upload response
- `FileResponse` - File response

## Column Types

Supported column types for table schemas:
- `text` - Unlimited text
- `varchar` - Variable character (limited)
- `integer` - 32-bit integer
- `bigint` - 64-bit integer
- `boolean` - True/false
- `timestamp` - Date/time
- `jsonb` - JSON binary
- `uuid` - UUID

## Testing

Run integration tests:

```bash
RUN_INTEGRATION_TESTS=1 swift test
```

## License

MIT
