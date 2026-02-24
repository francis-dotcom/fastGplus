# @selfdb/js-sdk

TypeScript/JavaScript SDK for SelfDB - Full Self-Hosted BaaS Built for AI Agents.

## Installation

```bash
npm install @selfdb/js-sdk
# or
yarn add @selfdb/js-sdk
# or
pnpm add @selfdb/js-sdk
```

## Quick Start

```typescript
import { SelfDB } from '@selfdb/js-sdk';

const selfdb = new SelfDB({
    baseUrl: 'https://api.your-domain.local',
    apiKey: 'your-api-key',
});

// Login
await selfdb.auth.login({ email: 'user@example.com', password: 'password' });

// Create a table
const table = await selfdb.tables.create({
    name: 'posts',
    table_schema: {
        title: { type: 'text', nullable: false },
        content: { type: 'text', nullable: true },
        published: { type: 'boolean', nullable: true, default: false }
    },
    public: true
});

// Insert data
await selfdb.tables.data.insert(table.id, { title: 'Hello World', content: 'First post!' });

// Query with builder pattern
const result = await selfdb.tables.data.query(table.id)
    .search('hello')
    .sort('created_at', 'desc')
    .page(1)
    .pageSize(25)
    .execute();
```

## Error Handling

```typescript
import {
    SelfDBError,
    APIConnectionError,
    BadRequestError,
    AuthenticationError,
    PermissionDeniedError,
    NotFoundError,
    ConflictError,
    InternalServerError,
} from '@selfdb/js-sdk';

try {
    await selfdb.tables.get('non-existent-id');
} catch (error) {
    if (error instanceof NotFoundError) {
        console.log('Table not found');
    } else if (error instanceof AuthenticationError) {
        console.log('Please login first');
    }
}
```

## Authentication

```typescript
// Login
await selfdb.auth.login({ email: 'user@example.com', password: 'password' });

// Get current user
const user = await selfdb.auth.me();

// Refresh token
await selfdb.auth.refresh({ refreshToken: 'your-refresh-token' });

// Logout
await selfdb.auth.logout();

// Logout from all devices
await selfdb.auth.logoutAll();

// User management
await selfdb.auth.users.create({
    email: 'new@example.com',
    password: 'password123',
    firstName: 'John',
    lastName: 'Doe'
});
await selfdb.auth.users.list({ limit: 25 });
await selfdb.auth.users.get(userId);
await selfdb.auth.users.update(userId, { firstName: 'Jane' });
await selfdb.auth.users.delete(userId);
```

## Tables

```typescript
// Create table
const table = await selfdb.tables.create({
    name: 'users',
    table_schema: {
        name: { type: 'text', nullable: false },
        email: { type: 'varchar', nullable: false },
        age: { type: 'integer', nullable: true }
    },
    public: false
});

// List tables
const tables = await selfdb.tables.list({ limit: 50, search: 'users' });

// Update table (enable realtime)
await selfdb.tables.update(tableId, { realtime_enabled: true });

// Column operations
await selfdb.tables.columns.add(tableId, { name: 'status', type: 'text' });
await selfdb.tables.columns.update(tableId, 'status', { new_name: 'user_status' });
await selfdb.tables.columns.remove(tableId, 'user_status');

// Data operations
await selfdb.tables.data.insert(tableId, { name: 'John', email: 'john@example.com' });
await selfdb.tables.data.updateRow(tableId, rowId, { name: 'Jane' });
await selfdb.tables.data.deleteRow(tableId, rowId);

// Query builder
const results = await selfdb.tables.data.query(tableId)
    .search('john')
    .sort('created_at', 'desc')
    .page(1)
    .pageSize(25)
    .execute();
```

## Storage

```typescript
// Buckets
const bucket = await selfdb.storage.buckets.create({ name: 'uploads', public: true });
await selfdb.storage.buckets.list();
await selfdb.storage.buckets.update(bucketId, { public: false });
await selfdb.storage.buckets.delete(bucketId);

// Files
const response = await selfdb.storage.files.upload(bucketId, {
    filename: 'document.pdf',
    data: fileContent,  // ArrayBuffer, Uint8Array, Blob, or string
    path: '/docs'
});

await selfdb.storage.files.list({ bucketId });
const fileData = await selfdb.storage.files.download({ bucketName: 'uploads', path: 'docs/document.pdf' });
await selfdb.storage.files.delete(fileId);

// Stats
const stats = await selfdb.storage.files.stats();
```

## Realtime

```typescript
// Connect to realtime server
await selfdb.realtime.connect();

// Subscribe to table changes
const channel = selfdb.realtime.channel('table:orders')
    .on('INSERT', (payload) => console.log('New order:', payload.new))
    .on('UPDATE', (payload) => console.log('Updated:', payload.new))
    .on('DELETE', (payload) => console.log('Deleted:', payload.old))
    .on('*', (payload) => console.log('Any event:', payload));

await channel.subscribe();

// Unsubscribe and disconnect
await channel.unsubscribe();
await selfdb.realtime.disconnect();
```

## Models

```typescript
import {
    // User models
    UserCreate,
    UserUpdate,
    UserRead,
    UserRole,  // 'USER' | 'ADMIN'
    
    // Table models
    TableCreate,
    TableUpdate,
    TableRead,
    ColumnDefinition,
    ColumnUpdate,
    TableDataResponse,
    
    // Storage models
    BucketCreate,
    BucketUpdate,
    BucketResponse,
    FileUploadResponse,
    FileResponse,
    
    // Realtime models
    RealtimePayload,
    RealtimeEvent,
} from '@selfdb/js-sdk';
```

## Table Schema Format

The `table_schema` field uses a flat object format:

```typescript
const schema = {
    column_name: {
        type: 'text',       // Required: text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid
        nullable: true,     // Optional: default true
        default: 'value'    // Optional: default value
    }
};
```

## License

MIT
