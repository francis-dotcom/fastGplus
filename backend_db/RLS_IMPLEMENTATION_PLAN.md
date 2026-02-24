# Row-Level Security (RLS) & Realtime Implementation Plan

This document outlines the plan to implement Row-Level Security (RLS) and Realtime features in SELFDB-V0.05, following Supabase's proven architecture patterns.

## Architecture Overview

### Component Roles

| Component | Responsibility |
|-----------|---------------|
| **PostgreSQL** | Stores data, emits NOTIFY on changes (if realtime enabled), enforces RLS |
| **Phoenix Realtime** | **Listens directly to PostgreSQL NOTIFY**, manages WebSocket connections, checks RLS per-subscriber, broadcasts authorized changes |
| **FastAPI Backend** | REST API for CRUD, manages realtime toggle (create/drop triggers), manages RLS policies |
| **Frontend/External Apps** | Subscribe to table changes via WebSocket, receive real-time updates |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Realtime + RLS Architecture                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User toggles "Realtime ON" for "users" table (via UI)          │
│  ↓                                                               │
│  FastAPI creates trigger on users table:                        │
│    CREATE TRIGGER users_realtime_notify                         │
│      AFTER INSERT/UPDATE/DELETE ON users                        │
│      EXECUTE FUNCTION realtime_notify()                         │
│  ↓                                                               │
│  Row changes in "users" table (e.g., new user registered)       │
│  ↓                                                               │
│  PostgreSQL: NOTIFY 'table:users', {pk: 'uuid-123', op: 'INSERT'}│
│  ↓                                                               │
│  Phoenix (LISTEN 'table:*') receives notification directly      │
│  ↓                                                               │
│  For each WebSocket subscriber to "table:users":                │
│    - Set their JWT claims in a PostgreSQL connection            │
│    - Query: SELECT * FROM users WHERE id = 'uuid-123'           │
│    - If RLS allows (row returned) → broadcast to them           │
│    - If RLS denies (no rows) → skip (user can't see this row)   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Phoenix Direct Connection
✅ **Phoenix connects directly to PostgreSQL** using `LISTEN` command
- **No Python intermediary** (eliminates round trip)
- PostgreSQL emits `NOTIFY` when triggers fire
- Phoenix receives notifications in real-time

### 2. Table-Level Realtime Toggle
✅ **Realtime OFF by default** on all user-created tables
- Add `realtime_enabled BOOLEAN DEFAULT FALSE` to `tables` table
- User toggles realtime ON → FastAPI creates trigger
- User toggles realtime OFF → FastAPI drops trigger
- Trigger existence = realtime status (drop trigger when disabled)

### 3. Channel Naming Convention
✅ **Format:** `table:tablename`
- Example: `table:messages`, `table:users`, `table:orders`
- Phoenix subscribes to `table:*` pattern
- Clients subscribe to specific channels like `table:users`
- Schema omitted (only using `public` schema)

### 4. RLS Policy Management
✅ **SQL Editor with RLS Examples Tab**
- Users write custom RLS policies in SQL Editor
- Add right-hand sidebar tab with **common RLS policy templates**:
  - Owner-only access
  - Team/organization access
  - Public read, authenticated write
  - Role-based access
- No additional UI needed in TableDetail

### 5. Admin Bypass RLS
✅ **Admin users can optionally bypass RLS**
- Users can add `OR auth.role() = 'ADMIN'` to their policies
- Shown as a pattern in RLS Examples tab
- Gives users full control over admin access
- Enables admin dashboards, analytics, background processors

### 6. Realtime Metadata Storage
✅ **Store in `tables` table itself**
- Add column: `realtime_enabled BOOLEAN DEFAULT FALSE`
- When `realtime_enabled = TRUE` → trigger exists
- When `realtime_enabled = FALSE` → trigger dropped
- Simple, no additional tables needed

---

## Implementation Plan Summary

### Phase 1: Database Setup
1. Add `realtime_enabled BOOLEAN DEFAULT FALSE` to `tables` table in `01_create_tables.sql`
2. Create `database/init/04_auth_helpers.sql` with `auth.uid()` and `auth.role()` functions
3. Create `database/init/05_realtime_function.sql` with `realtime_notify()` trigger function (emits minimal payload with PK only)

### Phase 2: Backend API
1. Add `set_jwt_claims(conn, user_id, role)` function in `db.py`
2. Call `set_jwt_claims()` before all database queries in endpoints
3. Modify existing `PATCH /tables/{table_id}` endpoint:
   - When `realtime_enabled` changes from `false` → `true`: create trigger
   - When `realtime_enabled` changes from `true` → `false`: drop trigger
4. Add `GET /tables/{table_id}/policies` endpoint (list RLS policies from `pg_policies`)
5. Add `POST /tables/{table_id}/rls` endpoint (toggle RLS on/off with `ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY`)

### Phase 3: Phoenix Realtime Service
1. Connect Phoenix directly to PostgreSQL
2. Use `LISTEN table:*` to receive all table notifications
3. For each subscriber:
   - Decode their JWT
   - Set `auth.uid()` and `auth.role()` in connection
   - Query row with RLS enforced
   - Broadcast only if authorized

### Phase 4: Frontend
1. Add `realtime_enabled` boolean column to Tables.tsx DataGrid (same pattern as `public` column)
2. Wire checkbox to call existing table `update` API when toggled
3. Add "RLS Examples" tab in SQL Editor right sidebar with policy templates

---

## RLS Policy Examples

These templates will appear in the SQL Editor "RLS Examples" tab:

```sql
-- Enable RLS on a table
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY;

-- Owner-only access (all operations)
CREATE POLICY "owner_access" ON {table_name}
  FOR ALL USING (owner_id = auth.uid());

-- Public read, authenticated write
CREATE POLICY "public_read" ON {table_name}
  FOR SELECT USING (true);

CREATE POLICY "authenticated_write" ON {table_name}
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "owner_update" ON {table_name}
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "owner_delete" ON {table_name}
  FOR DELETE USING (owner_id = auth.uid());

-- Team/organization access
CREATE POLICY "team_access" ON {table_name}
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members 
      WHERE user_id = auth.uid()
    )
  );

-- Admin bypass pattern (optional - add to any policy)
-- Example: Allow admins OR owners
CREATE POLICY "owner_or_admin" ON {table_name}
  FOR ALL USING (
    owner_id = auth.uid() OR auth.role() = 'ADMIN'
  );
```

---

## Listening to Realtime Table Changes

```typescript
import { createClient } from '@selfdb/client'

const selfdb = createClient('YOUR_SELFDB_URL', 'YOUR_API_KEY')

// Subscribe to users table
const channel = selfdb
  .channel('table:users')
  .on('*', (payload) => {
    console.log('Change:', payload)
  })
  .subscribe()

// Unsubscribe when done
channel.unsubscribe()
```

### Example: Update User Count in Realtime

```typescript
const [userCount, setUserCount] = useState(0)

const channel = selfdb
  .channel('table:users')
  .on('*', (payload) => {
    if (payload.operation === 'INSERT') setUserCount(prev => prev + 1)
    if (payload.operation === 'DELETE') setUserCount(prev => prev - 1)
  })
  .subscribe()

// Cleanup
channel.unsubscribe()
```