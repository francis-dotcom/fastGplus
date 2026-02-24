# SelfDB Developer Guide & API Reference

**Version:** 0.0.5  
**Last Updated:** 2025-12-12

---

## 📖 Introduction

This document is the definitive technical reference for the SelfDB Backend API. It goes beyond a simple list of endpoints to explain the **business logic**, **architectural decisions**, and **constraints** that govern the system.

SelfDB is designed as a "Backend-as-a-Service" (BaaS) for AI agents and modern web apps, providing:
*   **Dynamic Database**: On-the-fly table creation and schema evolution.
*   **Object Storage**: S3-compatible file storage with true streaming.
*   **Serverless Functions**: Deno-based runtime for custom backend logic.
*   **Realtime Engine**: WebSocket subscriptions for database changes.

---

## 🚀 Quick Start

*(This section is identical to the README for consistency)*

### 1. Generate Secure Keys

Before starting, generate unique `SECRET_KEY` and `API_KEY` values for your installation:

```bash
# Make the script executable (first time only)
chmod +x generate_keys.sh

# Generate and configure your security keys
./generate_keys.sh
```

The script will:
- Prompt you to generate `SECRET_KEY`, `API_KEY`, or both
- Generate cryptographically secure keys
- Update your `.env` file automatically
- Show the generated keys for your records

> ⚠️ **Important:** Always generate new keys for production deployments. Never use the default development keys.

For production performance, update your `.env` file to match your machine's CPU resources:

- Increase `BACKEND_WORKERS` (recommended: 1 worker per CPU core + 1)
- Increase `STORAGE_WORKERS` (recommended: 1 worker per CPU core)

### 2. Start SelfDB Services

Use the `selfdb.sh` management script to start all services:

```bash
# Make the script executable (first time only)
chmod +x selfdb.sh

# Start all services (downloads PgBouncer, builds, and starts)
./selfdb.sh start

# Or simply:
./selfdb.sh
```

**Available commands:**

| Command | Description |
|---------|-------------|
| `./selfdb.sh start` | Download PgBouncer, build, and start all services |
| `./selfdb.sh stop` | Stop all Docker services |
| `./selfdb.sh rebuild` | Rebuild all services with no cache |
| `./selfdb.sh test` | Test health endpoints for all services |
| `./selfdb.sh logs` | Show logs for all services (follow mode) |
| `./selfdb.sh ps` | Show status of all containers |
| `./selfdb.sh help` | Show all available commands |

### Access Your Installation

Once started, access:
- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

### Default Admin Credentials

Login with the default admin account:
- **Email**: `admin@example.com`
- **Password**: `password`

> ⚠️ **Change these immediately in production!** Update `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before deploying.

---

## 🔐 Authentication & Security

SelfDB employs a **Dual-Layer Authentication** system to support both programmatic access (AI Agents/Scripts) and user sessions (Dashboard/App).

### 1. System-Level Access (`X-API-Key`)
*   **Used By**: Scripts, fast-running agents, external tools.
*   **Scope**: Bypasses user-level permissions for certain system endpoints, but most endpoints *also* require a user token.
*   **Header**: `X-API-Key: <your_api_key_from_env>`
*   **Validation**: Checked against `API_KEY` in `.env`.
*   **Error**: `406 Not Acceptable` if missing on protected routes.

### 2. User-Level Access (Bearer Token)
*   **Used By**: Frontend Dashboard, Mobile Apps, Users.
*   **Scope**: Identifies the specific user (`owner_id`) and Role (`ADMIN` vs `USER`).
*   **Header**: `Authorization: Bearer <jwt_access_token>`
*   **Format**: JWT (JSON Web Token) signed with `SECRET_KEY`.
*   **Expiration**: Defaults to 30 minutes (configurable).
*   **Error**: `401 Unauthorized` if invalid/expired.

### Role-Based Access Control (RBAC)
*   **ADMIN**: Full access to all resources, including system backups, SQL execution, and other users' data.
*   **USER**:
    *   **Can**: CRUD their own Users, Tables, Buckets, Files.
    *   **Cannot**: Execute raw SQL, manage backups, deploy functions (unless explicitly allowed), or access other users' private resources.

---

## 📚 API Reference

### 👤 Users API

Manage user identities, authentication, and profiles.

**Base Path**: `/users`

#### Models & Constraints

| Model | Field | Type | Constraints | Description |
|-------|-------|------|-------------|-------------|
| **UserCreate** | `email` | string | Valid email format | Unique in system. |
| | `password` | string | `^[A-Za-z0-9@$!%*?&]{8,72}$` | **Strictly enforced**: Min 8 chars, max 72. Only uppercase, lowercase, digits, and specific symbols (`@$!%*?&`) allowed. |
| | `first_name` | string | `^[^\x00]+$` | Max 50 chars. Any character allowed except NUL bytes. |
| | `last_name` | string | `^[^\x00]+$` | Max 50 chars. Any character allowed except NUL bytes. |
| **UserUpdate** | `role` | enum | `admin`, `user` | Only Admins can change roles. |
| **UserList** | `search` | string | `^[\x20-\x7E]*$` | Printable ASCII only. No control characters or Unicode allowed to ensure safe ILIKE queries. |

---

#### 1. Login (Get Token)
**POST** `/users/token`

Exchanges credentials for a JWT access token. This is the entry point for all user sessions.

*   **Logic**:
    1.  Verifies email exists and password matches hash (bcrypt).
    2.  Checks if user is `is_active=True`.
    3.  If this is the *very first* user, system marks as "Initialized".
    4.  Returns a signed JWT containing `sub` (user_id) and `role`.
*   **Request Body**: `application/x-www-form-urlencoded` or JSON `LoginRequest`.
    *   `email`: User email.
    *   `password`: Plaintext password.
*   **Response**: `200 OK`
    ```json
    {
      "access_token": "eyJhbG...",
      "token_type": "bearer"
    }
    ```
*   **Errors**:
    *   `401 Unauthorized`: Incorrect email or password.
    *   `400 Bad Request`: Inactive user.

#### 2. Get Current User
**GET** `/users/me`

Returns the profile of the currently logged-in user.

*   **Logic**: Decodes JWT from `Authorization` header, verifies signature and expiration, and fetches fresh data from DB.
*   **Requires**: `Authorization: Bearer <token>`
*   **Response**: `200 OK` (UserRead model)
    ```json
    {
      "id": "uuid...",
      "email": "user@example.com",
      "is_active": true,
      "role": "USER",
      "created_at": "2023-..."
    }
    ```

#### 3. Register User
**POST** `/users/`

Create a new user account.

*   **Logic**:
    1.  Validates password complexity (length, case, numbers).
    2.  Hashes password using `bcrypt`.
    3.  Generates new UUID.
    4.  **Constraint**: Enforces unique `email`.
*   **Request Body**: `UserCreate`
*   **Response**: `201 Created` (UserRead model)
*   **Errors**:
    *   `400 Bad Request`: Weak password or invalid data.
    *   `409 Conflict`: Email already exists.

#### 4. List Users
**GET** `/users/`

List users with pagination and search.

*   **Requires**: `ADMIN` role OR valid user (depending on configuration, currently open to authenticated users).
*   **Parameters**:
    *   `skip` (int, default 0): Offset.
    *   `limit` (int, default 100): Max records (capped at 100).
    *   `search` (string): `^[\x20-\x7E]*$` (Printable ASCII only). Filters by `email`, `first_name`, or `last_name` (Case-insensitive ILIKE).
    *   `sort_by` (string): `created_at`, `email`, `last_name`.
    *   `sort_order` (string): `asc` or `desc`.
*   **Response**: `200 OK` (Array of UserRead)

#### 5. Update User
**PATCH** `/users/{user_id}`

Update user profile.

*   **Logic**:
    *   **Self Update**: Users can update their own `first_name`, `last_name`, `password`.
    *   **Admin Update**: Admins can update *any* field, including `role` and `is_active`.
    *   **Restriction**: Users cannot change their own `role` or `is_active` status.
*   **Request Body**: `UserUpdate` (all fields optional)
*   **Response**: `200 OK` (Updated UserRead)
*   **Errors**:
    *   `403 Forbidden`: User trying to update another user (without Admin role) or trying to escalate their own privileges.
    *   `409 Conflict`: Changing email to one that already exists.

#### 6. Delete User
**DELETE** `/users/{user_id}`

Permanently remove a user.

*   **Requires**: `ADMIN` role or Self (if self-deletion is enabled).
*   **Logic**: deletes record from `users` table. Note that cascading deletes (e.g., owned tables/files) depend on database foreign keys.
*   **Response**: `204 No Content`

### 🗄️ Tables API (Dynamic Database)

Create, modify, and query SQL tables dynamically via API. This is the core "Backend-as-a-Service" feature.

**Base Path**: `/tables`

#### Models & Constraints

| Model | Field | Type | Constraints | Description |
|-------|-------|------|-------------|-------------|
| **TableCreate** | `name` | string | `^[a-z][a-z0-9_]*$` | **Strictly enforced**: Must start with a lowercase letter. Only lowercase letters, numbers, and underscores allowed. Max 63 characters. |
| | `table_schema` | JSON | Non-empty Dict | Must be a valid JSON object defining columns and types. |

#### The Core Concept: Schema-as-a-Service
When you create a "Table" via this API, SelfDB actually executes a `CREATE TABLE` statement in the underlying PostgreSQL database.
*   **Owner Isolation**: Each table has an `owner_id`.
*   **Realtime**: If `realtime_enabled` is true, a PostgreSQL trigger (`notify_changes`) is attached to the table, sending JSON payloads to the `pg_notify` channel for WebSocket broadcasting.

---

#### 1. Create Table
**POST** `/tables/`

Creates a new physical table in the database and registers its metadata.

*   **Request Body**: `TableCreate`
    *   `name`: (Required) Table name.
    *   `schema`: List of columns. Each column has:
        *   `name`: Column name (lowercase alphanumeric).
        *   `type`: `text`, `integer`, `boolean`, `timestamp`, `jsonb`, `uuid`, `real`.
        *   `constraints`: `primary_key`, `unique`, `not_null`, `foreign_key`.
    *   `realtime_enabled`: (bool) Auto-create notification triggers.
*   **Business Logic**:
    1.  Validates name against reserved words (e.g., "user", "select" are banned).
    2.  Constructs a safe `CREATE TABLE` string using `psycopg.sql`.
    3.  Adds standard columns if missing: `id` (UUID PK), `created_at`, `updated_at`.
    4.  Executes DDL.
*   **Response**: `201 Created` (TableRead)

#### 2. Get Table Structure
**GET** `/tables/{table_id}`

Returns the definition (columns, types, metadata) of a table, not the data.

*   **Logic**: Queries `information_schema.columns` to reconstruct the exact current state of the database table, ensuring truth.

#### 3. Update Table (Schema Migration)
**PATCH** `/tables/{table_id}`

Modify table metadata (e.g., toggle realtime). To modify *columns*, use the Column endpoints.

*   **Note**: Changing `realtime_enabled` adds/removes the SQL trigger dynamically.

#### 4. Delete Table
**DELETE** `/tables/{table_id}`

**Destructive Operation**: Executes `DROP TABLE {name}`. All data is permanently lost.

---

#### 5. Data Operations (CRUD)
**GET** `/tables/{table_id}/data`
**POST** `/tables/{table_id}/data`
**PATCH** `/tables/{table_id}/data/{row_id}`
**DELETE** `/tables/{table_id}/data/{row_id}`

Interact with the actual rows in your dynamically created table.

*   **Query Params (GET)**:
    *   `_page`: Page number (1-based).
    *   `_limit`: Rows per page.
    *   `_sort`: Column to sort by.
    *   `_order`: `asc` or `desc`.
    *   `{column_name}`: Filter by exact match (e.g., `?status=active`).
*   **Logic**:
    *   Auto-maps JSON values to SQL types.
    *   `POST`: Auto-generates `id` (UUID) if not provided. Sets `created_at`/`updated_at`.
    *   `PATCH`: Partial updates. Updates `updated_at` automatically.
    *   **Security**: Prevents SQL injection by using parameterized queries (`%s`) for all values. Column names are validated against the known schema.

#### 6. Columns Management
**POST** `/tables/{table_id}/columns`
**DELETE** `/tables/{table_id}/columns/{column_name}`

Evolve your schema without writing SQL.

*   **POST**: Executes `ALTER TABLE ADD COLUMN`.
*   **DELETE**: Executes `ALTER TABLE DROP COLUMN`.
*   **Warning**: Dropping a column deletes all data in that column.

### 📦 Storage API (S3-Compatible Object Store)

Manage file uploads, buckets, and downloads with high performance.

**Base Path**: `/storage`

#### Models & Constraints

| Model | Field | Type | Constraints | Description |
|-------|-------|------|-------------|-------------|
| **BucketCreate** | `name` | string | `^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$` | **S3 Compatible**: 3-63 chars. Lowercase alphanumeric and hyphens only. Must start/end with alphanumeric. |

#### Architecture: "True Streaming"
The storage endpoints use Python's asynchronous generators to stream data directly from the client request to the disk (or underlying storage service) **without loading the entire file into RAM**. This allows uploading multi-gigabyte files on low-memory servers.

*   **File Handling**:
    *   **Duplicate Strategy**: "MacOS Style". If `file.pdf` exists, upload becomes `file (1).pdf`, then `file (2).pdf`. No overwrites via POST.
    *   **Security**: `path` traversal (`../`) is blocked.

---

#### 1. Buckets
**POST** `/storage/buckets/`
**GET** `/storage/buckets/`
**DELETE** `/storage/buckets/{id}`

*   **Public Buckets**: Files are accessible to *anyone* (even unauthenticated users) via the download URL.
*   **Private Buckets**: Files require `Authorization` header and ownership check to download.
*   **Logic**: Creates a folder on the filesystem (or S3 key prefix). Deleting a bucket recursively deletes all files within it.

#### 2. Upload File
**POST** `/storage/files/upload`

Stream a file to a bucket.

*   **QueryParams**:
    *   `bucket_id` (UUID): Target bucket.
    *   `filename`: Original filename.
    *   `path` (optional): Specific directory path.
*   **Body**: **Raw Binary Content** (Not `multipart/form-data`). This is crucial for performance.
*   **Headers**: `Content-Length` (Recommended).
*   **Response**: `201 Created`
    ```json
    {
      "success": true,
      "path": "documents/report.pdf",
      "original_path": "report.pdf",  // If renamed
      "message": "File uploaded successfully (renamed...)"
    }
    ```

#### 3. Download File
**GET** `/storage/files/download/{bucket_name}/{path}`

Stream a file to the client.

*   **Logic**:
    *   Checks Bucket privacy.
    *   If Public: Streams immediately.
    *   If Private: Checks `Authorization` header matches Bucket Owner.
*   **Response**: Binary stream with `Content-Type` and `Content-Disposition: attachment`.

#### 4. File Metadata
**GET** `/storage/files/`
**GET** `/storage/files/{id}`
**DELETE** `/storage/files/{id}`

Manage file records without downloading content.
*   `GET /`: List files with pagination. Supports `search` (name/path) and `sort_by` (size, date).
*   `DELETE`: Physically removes the file and cleans up the database record.

### ⚡ Serverless Functions API

Deploy and execute custom backend logic using the **Deno Runtime**.

**Base Path**: `/functions`
**Access**: **ADMIN ONLY** (Strict enforcement).

#### Models & Constraints

| Model | Field | Type | Constraints | Description |
|-------|-------|------|-------------|-------------|
| **FunctionCreate** | `name` | string | `^[a-zA-Z][a-zA-Z0-9_-]*$` | Must start with a letter. Alphanumeric, underscores, and hyphens allowed. Max 255 chars. |
| | `code` | string | Non-empty | Source code cannot be empty or whitespace only. |

#### The Runtime Environment
Functions are TypeScript/JavaScript code executed in a secure, isolated Deno environment.
*   **Host**: Internal service at `http://functions:8090`.
*   **Isolation**: Each function runs in a sandboxed context.
*   **Persistence**: Logs and execution results are callbacks stored in PostgreSQL.

---

#### 1. Create Function
**POST** `/functions/`

Register a new function code block.

*   **Body**: `FunctionCreate`
    *   `name`: Function name.
    *   `code`: TypeScript/JS source code.
    *   `timeout_seconds`: Max execution duration (Default 30s, Max 300s).
    *   `env_vars`: keys/values injected at runtime.
*   **Status**: Initially `PENDING`. Must be deployed.

#### 2. Deploy Function
**POST** `/functions/{id}/deploy`

Push the code to the active runtime memory.

*   **Logic**:
    1.  Sends code + env vars to `http://functions:8090/deploy`.
    2.  If successful, updates status to `DEPLOYED`.
    3.  If runtime rejects (syntax error), updates status to `FAILED` with error message.
*   **Note**: Functions cannot be executed until successfully deployed.

#### 3. Execution History & Logs
**GET** `/functions/{id}/executions`
**GET** `/functions/{id}/logs`

View the performance and output of your functions.

*   **Metrics**: SelfDB tracks `execution_count`, `success_rate`, and `avg_execution_time_ms`.
*   **Logs**: `console.log()` and `console.error()` in the user code are captured, sent to the backend, and stored in `function_logs`.

#### 4. Execution Result Callback (Internal)
**POST** `/functions/{name}/execution-result`

*   **Purpose**: This endpoint is used by the *Deno Runtime* to report back results. It is not meant for manual calling, but helpful for debugging.
*   **Payload**: Contains logic logs, return value, and execution duration.

### 🔍 SQL API (Direct Database Access)

Execute raw SQL queries against the database.
**Access**: **ADMIN ONLY**.

**Base Path**: `/sql`

#### Security: The "Nanny" Filter
To prevent catastrophic accidents, the SQL endpoint enforces a strict blocklist using regex.

**Blocked Patterns (Regex)**:
*   `\bpg_read_file\b`
*   `\bpg_write_file\b`
*   `\bpg_ls_dir\b`
*   `\blo_import\b`
*   `\blo_export\b`
*   `\bcopy\s+.*\s+to\s+program\b`
*   `\bcopy\s+.*\s+from\s+program\b`
*   `\bexecute\s+format\b`
*   `;\s*--` (SQL comment injection)

**Protected Tables**:
You cannot `INSERT`, `UPDATE`, `DELETE`, `DROP`, or `TRUNCATE` the following system tables:
*   `system_config`
*   `sql_history`
*   `sql_snippets`
*   `pg_catalog`
*   `information_schema`

*   **Reasoning**: Prevents RCE (Remote Code Execution) and system corruption.

#### 1. Execute Query
**POST** `/sql/query`

*   **Body**: `{"query": "SELECT * FROM users"}`
*   **Logic**:
    *   Detects if query is Read-Only (`SELECT`, `EXPLAIN`) or Write.
    *   Returns JSON array of dictionaries for `SELECT`.
    *   Returns `row_count` for `UPDATE/DELETE`.
    *   **Auto-History**: Every query execution is logged to `sql_history` for audit.

#### 2. Query History
**GET** `/sql/history`

Recall past queries executed by the admin. Useful for audit trails.

---

### 🧪 Testing & Benchmarking

SelfDB ships with a comprehensive suite of **8 distinct test scripts** covering contract validation, load testing, user simulation, and end-to-end integration.

> 💡 **Note:** All test scripts automatically load the `API_KEY` from your `.env` file.

#### 1. Schemathesis (API Contract Testing)
**Why**: Ensures the API strictly adheres to its own OpenAPI specification (`openapi.json`). It "fuzzes" the API to find edge cases (nulls, empty strings, invalid types) that crash the server.

*   **Script**: `backend/run_schemathesis.sh`
*   **Target**: Entire API Surface
*   **What it tests**: Response schemas, status codes, headers, and property-based logic.

```bash
# Run full contract validation
./run_schemathesis.sh
```

#### 2. Apache Bench (Throughput & Storage Testing)
**Why**: Quick, raw performance validation. Use this to measure "Requests Per Second" (RPS) and latency distributions under load.

| Script | Purpose | Usage |
|--------|---------|-------|
| `backend/ab_benchmark.sh` | **General API Load**. Tests Users, Tables, and basic Storage endpoints. | `./ab_benchmark.sh -n 1000 -c 50` |
| `backend/ab_storage_benchmark.sh` | **Storage Specific**. Focuses purely on file upload/download streaming performance. | `./ab_storage_benchmark.sh -n 100` |

**Common Flags:**
*   `--stress`: Runs 1000 requests with 100 concurrency.
*   `--no-storage`: (General script only) Skips I/O heavy storage tests.

#### 3. Locust (Realistic User Simulation)
**Why**: Simulates *realistic* human traffic patterns with weighted behaviors. Ideal for finding bottlenecks in complex flows (e.g., "Create Table" -> "Insert Data").

| Script | Focus Area | User Classes |
|--------|------------|--------------|
| `backend/locustfile.py` | **Full System**. touches everything. | `AdminUser` (Creates), `RegularUser` (Consumes) |
| `backend/locustfile_no_storage.py` | **Logic Only**. Users & Tables. | `AdminUser`, `RegularUser` (No file I/O) |
| `backend/locustfile_storage_only.py` | **Storage Only**. Buckets & Files. | `AdminStorageBehavior`, `RegularStorageBehavior` |

```bash
# Start Web UI (http://localhost:8089)
uv run locust -f locustfile.py --host=http://localhost:8000

# Headless Mode (CI/CD)
uv run locust -f locustfile.py --host=http://localhost:8000 --users 100 --spawn-rate 10 --headless
```

#### 4. Integration & E2E Testing
**Why**: Verifies complex multi-service interactions that unit tests miss. These scripts run actual flows against the running backend.

| Script | Description | Key Flow |
|--------|-------------|----------|
| `backend/test_functions_service.py` | **Functions Lifecycle**. Tests CRUD, deployment, and execution result callbacks. | Create Func -> Deploy -> Mock Execution -> Verify Metrics |
| `backend/test_functions_webhooks_integration.py` | **Webhooks & Email**. Tests external triggers and side effects. | Webhook Trigger -> Function Execution -> SMTP Email Send |

**Usage:**
```bash
# Run functions lifecycle test
uv run python test_functions_service.py

# Run webhook integration test (Requires SMTP config)
uv run python test_functions_webhooks_integration.py
```

---

### ⚙️ System & Backups API

Operational endpoints for maintaining the SelfDB instance.

#### 1. System Status
**GET** `/system/status`
*   **Returns**: `{"initialized": true/false}`.
*   **Use Case**: Frontend checks this on load. If `false`, redirects to "Setup/Restore" wizard.

#### 2. Backups
**Base Path**: `/backups` (Admin Only)

*   **GET /backups/**: List available `.tar.gz` backups in the `./backups` directory.
*   **POST /backups/**: Trigger an immediate backup.
    *   **Warning**: This is the *API-level* backup. For large storage (GBs), use the CLI `./backup_now.sh` instead to avoid HTTP timeout.
*   **POST /backups/restore**: Upload and restore a backup file.
    *   **Constraint**: Only allowed if `/system/status` is `initialized: false`.
    *   **Effect**: Wipes the current database and replaces it with the backup content.

---

## 🛑 Error Reference

SelfDB uses standard HTTP codes with specific meanings:

| Code | Meaning | Context |
|------|---------|---------|
| **200** | OK | Success. |
| **201** | Created | Resource (User, Table, File) created. |
| **204** | No Content | Successful Delete. |
| **400** | Bad Request | Validation failed (e.g., regex mismatch, missing field). |
| **401** | Unauthorized | Token expired, invalid, or missing. |
| **403** | Forbidden | Valid token, but insufficient permissions (e.g., User trying to Access Admin area). |
| **404** | Not Found | Resource ID does not exist. |
| **406** | Not Acceptable | Missing `X-API-Key` on system route. |
| **409** | Conflict | Duplicate unique field (e.g., Email or Bucket Name already exists). |
| **413** | Payload Too Large| Upload exceeds server limits (Configurable in Nginx). |
| **500** | Server Error | Unhandled exception (bug) or database connection failure. |
