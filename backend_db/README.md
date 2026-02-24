# SelfDB

**Full Self-Hosted Backend-as-a-Service (BaaS) Built for AI Agents**

Version 0.0.5

SelfDB is a complete self-hosted backend solution featuring: **FastAPI** backend, **React + TypeScript** frontend, **PostgreSQL** with PgBouncer connection pooling, **Realtime** WebSocket service (Phoenix/Elixir), and **Storage** service for file uploads.

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
  - [Database Setup](#database-setup)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [SDK Generation](#sdk-generation)
- [Testing](#testing)
  - [Schemathesis (API Contract Testing)](#schemathesis-api-contract-testing)
  - [Apache Bench (Load Testing)](#apache-bench-load-testing)
  - [Locust (Load Testing)](#locust-load-testing)
- [Backup & Restore](#backup--restore)
  - [CLI Backup (Recommended)](#cli-backup-recommended-for-large-files)
  - [Web UI Backup](#web-ui-backup-small-files-only)
  - [CLI Restore](#cli-restore)
  - [Web UI Restore (Fresh Install)](#web-ui-restore-fresh-install)
- [Scaling SelfDB](#scaling-selfdb)
- [Production Deployment](#production-deployment)
  - [Quick Deploy](#quick-deploy)
  - [Interactive Wizard](#interactive-wizard)
  - [Production Architecture](#production-architecture)
  - [Configuration](#configuration-1)
  - [Updating Production](#updating-production)
  - [Troubleshooting Deployment](#troubleshooting-deployment)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [⚠️ Troubleshooting](#troubleshooting)
  - [PgBouncer Container Fails to Start](#pgbouncer-container-fails-to-start)
- [Contributing](#contributing)
- [License](#license)
- [Learn More](#learn-more)

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  React Frontend │────▶│  FastAPI Backend│────▶│   PostgreSQL    │
│  (Vite + TS)    │     │    (Python)     │     │  + PgBouncer    │
│  Port: 3000     │     │   Port: 8000    │     │  Internal Only  │
│                 │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │ Realtime  │ │  Storage  │ │  Backups  │
            │ (Phoenix) │ │ (FastAPI) │ │  Service  │
            │ Port 4000 │ │ Port 9000 │ │           │
            └───────────┘ └───────────┘ └───────────┘
```

**Services:**
| Service | Technology | Port | Description |
|---------|------------|------|-------------|
| Frontend | React + Vite | 3000 | Admin dashboard UI |
| Backend | FastAPI (Python) | 8000 | REST API gateway |
| Database | PostgreSQL 18 | Internal | Primary data store |
| PgBouncer | Connection Pooler | Internal | 5000 max connections |
| Realtime | Phoenix (Elixir) | Internal | WebSocket subscriptions |
| Storage | FastAPI (Python) | Internal | S3-compatible file storage |

---

## Prerequisites

- **Docker** and **Docker Compose** (required)
- **Python 3.11+** with [uv](https://docs.astral.sh/uv/) (for local development)
- **Node.js 18+** with npm or pnpm (for local development)

---

## Quick Start

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

### Local Development (Database in Docker)

For development with hot-reload:

#### 1. Start the Database (Docker)

```bash
docker compose up -d db pgbouncer
```

#### 2. Start the Backend

```bash
cd backend
uv run fastapi dev
```

The API will be available at http://localhost:8000

- **API Docs (Swagger)**: http://localhost:8000/docs
- **API Docs (ReDoc)**: http://localhost:8000/redoc
- **OpenAPI JSON**: http://localhost:8000/openapi.json

#### 3. Start the Frontend

```bash
cd frontend
npm install  # or pnpm install
npm run dev  # or pnpm dev
```

The frontend will be available at http://localhost:5173

---

## Docker Configuration

### Services Overview

| Service   | Image/Build        | Port  | Description                    |
|-----------|-------------------|-------|--------------------------------|
| db        | postgres:18       | 5433  | PostgreSQL database            |
| pgbouncer | Custom build      | 6432  | Connection pooling             |
| backend   | ./backend         | 8000  | FastAPI application            |
| frontend  | ./frontend        | 80    | React + Nginx                  |

### Docker Commands

```bash
# Build and start all services
docker-compose up -d --build

# Start only database services (for local development)
docker-compose up -d db pgbouncer

# Rebuild a specific service
docker-compose build backend
docker-compose up -d backend

# View logs for a specific service
docker-compose logs -f backend

# Execute command in running container
docker-compose exec backend uv run python -c "print('hello')"

# Stop all services
docker-compose down

# Stop and remove volumes (clean database)
docker-compose down -v

# View running services
docker-compose ps
```

---

## Development Setup

### Database Setup

The database runs in Docker via `docker-compose.yml`:

```bash
# Start database services only
docker-compose up -d db pgbouncer

# View logs
docker-compose logs -f db

# Stop services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

**Connection Details:**
| Service    | Host      | Port | User     | Password | Database |
|------------|-----------|------|----------|----------|----------|
| PostgreSQL | localhost | 5433 | postgres | postgres | selfdb   |
| PgBouncer  | localhost | 6432 | postgres | postgres | selfdb   |

### Backend

```bash
cd backend

# Install dependencies
uv sync

# Run development server (with hot reload)
uv run fastapi dev

# Run production server
uv run fastapi run

# Generate OpenAPI spec
uv run python -c "from main import app; import json; print(json.dumps(app.openapi()))" > openapi.json
```

**Environment Variables:**
Create a `.env` file in the `backend` directory if needed:
```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/selfdb
API_KEY=Myapi-Key-for-dev
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

---

## SDKs

We provide auto-generated SDKs for multiple languages to interact with the SelfDB API.

### Available SDKs

| Language | Location | Status | Installation |
|----------|----------|--------|--------------|
| **TypeScript** | `SDKs/js-sdk/` | ⏳ Local (Public release soon) | Copy to your project |
| **Python** | `SDKs/selfdb-py/` | ⏳ Local (Public release soon) | Copy to your project |
| **Swift** | `SDKs/swift-sdk/` | ⏳ Local (Public release soon) | Copy to your project |

### Installation

At the moment we are finalizing our public SDKs. For now, you will need to install these locally in your code:

**TypeScript/JavaScript:**
```bash
# Copy the SDK to your project
cp -r SDKs/js-sdk /path/to/your/project/

# Then import in your code
import { client } from './js-sdk/client.gen'
import { UsersService } from './js-sdk/sdk.gen'
```

**Python:**
```bash
# Install from local source
pip install -e SDKs/selfdb-py

# Then import in your code
from swagger_client import ApiClient, Configuration
from swagger_client.api.users_api import UsersApi
```

**Swift:**
```bash
# Add to your Podfile
pod 'SelfDBSDK', :path => 'SDKs/swift-sdk'

# Then import in your code
import SwaggerClient
```

Each SDK includes:
- Auto-generated from OpenAPI 3.1.0 spec
- Type-safe client methods for all endpoints
- Request/response models
- Full API documentation

### Regenerating SDKs

If you update the OpenAPI spec, regenerate the SDKs using the commands in the [SDK Generation](#sdk-generation) section below.

---

## SDK Generation

Generate TypeScript client SDK from the OpenAPI spec for type-safe API calls.

### Recommended: hey-api (Used by Frontend)

```bash
cd backend

# Generate OpenAPI spec first
uv run python -c "from main import app; import json; print(json.dumps(app.openapi()))" > openapi.json

# Generate TypeScript SDK
npx -y @hey-api/openapi-ts \
  -i openapi.json \
  -o ../frontend/src/client \
  -c @hey-api/client-fetch
```

The generated client will be in `frontend/src/client/` with:
- `sdk.gen.ts` - API functions
- `types.gen.ts` - TypeScript types
- `client.gen.ts` - HTTP client configuration

### Alternative: Swagger Codegen (Docker)

Generate SDKs for multiple languages using Swagger Codegen:

**TypeScript:**
```bash
docker run --rm -v ${PWD}:/local \
  swaggerapi/swagger-codegen-cli-v3 generate \
  -i /local/openapi.json \
  -l typescript-fetch \
  -o /local/sdks/swagger-codegen/typescript
```

**Python:**
```bash
docker run --rm -v ${PWD}:/local \
  swaggerapi/swagger-codegen-cli-v3 generate \
  -i /local/openapi.json \
  -l python \
  -o /local/sdks/swagger-codegen/python
```

**Swift:**
```bash
docker run --rm -v ${PWD}:/local \
  swaggerapi/swagger-codegen-cli-v3 generate \
  -i /local/openapi.json \
  -l swift5 \
  -o /local/sdks/swagger-codegen/swift
```

---

## Testing

> 💡 **Note:** All test scripts automatically load the `API_KEY` from your `.env` file. Just run the scripts — no need to manually specify the API key.

### Schemathesis (API Contract Testing)

[Schemathesis](https://schemathesis.readthedocs.io/) automatically generates test cases from your OpenAPI schema to find bugs and edge cases.

```bash
cd backend

# Run all API contract tests (uses API_KEY from .env)
./run_schemathesis.sh
```

**What it tests:**
- ✅ Response schema validation
- ✅ Status code correctness
- ✅ Content-type headers
- ✅ Edge cases (empty strings, nulls, special characters)
- ✅ Stateful testing (API workflow sequences)

### Apache Bench (Load Testing)

[Apache Bench](https://httpd.apache.org/docs/2.4/programs/ab.html) (ab) performs quick HTTP load tests.

```bash
cd backend

# Run with defaults (100 requests, 10 concurrent)
./ab_benchmark.sh

# Custom load test
./ab_benchmark.sh -n 500 -c 25

# Quick smoke test
./ab_benchmark.sh --quick

# Stress test (1000 requests, 100 concurrent)
./ab_benchmark.sh --stress

# Test against different host
./ab_benchmark.sh -h http://api.example.com

# Compare with/without storage to see latency impact
./ab_benchmark.sh                 # Full suite (includes storage)
./ab_benchmark.sh --no-storage    # Skip storage endpoints

# Show help
./ab_benchmark.sh --help
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `-n, --requests` | Total number of requests | 100 |
| `-c, --concurrency` | Concurrent connections | 10 |
| `-h, --host` | API host URL | http://127.0.0.1:8000 |
| `--no-storage` | Skip storage setup and benchmarks (backend-only) | false |
| `--quick` | Quick test (50 req, 5 concurrent) | - |
| `--stress` | Stress test (1000 req, 100 concurrent) | - |

**Output includes:**
- Requests per second
- Time per request (latency)
- Failed requests count
- Summary table of all endpoints

### Locust (Load Testing)

[Locust](https://locust.io/) provides a web UI for interactive load testing with realistic user behavior simulation.

```bash
cd backend

# Start Locust with web UI (uses API_KEY from .env)
uv run locust -f locustfile.py --host=http://localhost:8000

# Then open http://localhost:8089 in your browser
```

**Specialized Locust Files:**
| File | Description |
|------|-------------|
| `locustfile.py` | Full test suite (all endpoints) |
| `locustfile_no_storage.py` | Users, Tables, Functions, Webhooks only |
| `locustfile_storage_only.py` | Storage endpoints only (buckets, files) |

**Headless mode (CI/CD):**
```bash
# Run for 1 minute with 100 users, spawning 10/second
uv run locust -f locustfile.py \
  --host=http://localhost:8000 \
  --users 100 \
  --spawn-rate 10 \
  --run-time 1m \
  --headless

# Quick smoke test
uv run locust -f locustfile.py \
  --host=http://localhost:8000 \
  -u 10 -r 5 \
  --run-time 30s \
  --headless \
  QuickSmokeTest
```

**User Types:**
| User Class | Description | Weight |
|------------|-------------|--------|
| `AuthenticatedAPIUser` | Full CRUD on all resources | 3 |
| `PublicAPIUser` | Public endpoints only | 1 |
| `QuickSmokeTest` | Rapid-fire test (explicit only) | 0 |

**Web UI Features:**
- Real-time charts (RPS, response times, failures)
- Per-endpoint statistics
- Download test reports
- Adjustable user count during test

---

## Backup & Restore

SelfDB includes a comprehensive backup system for disaster recovery and server migration.

### Backup Overview

| Feature | Description |
|---------|-------------|
| **Storage Location** | `./backups/` folder in project root |
| **Format** | `.tar.gz` archive containing database dump + storage files + .env |
| **Scheduling** | Configurable via cron expression |
| **Retention** | Automatic cleanup of old backups |

**What's included in a backup:**
- `database.sql` - Full PostgreSQL database dump
- `storage/` - All uploaded files (from storage service)
- `.env` - Configuration file snapshot

### Which Method Should I Use?

| Method | Best For | Speed | Storage Size Limit |
|--------|----------|-------|-------------------|
| **Web UI** | Small backups, quick exports | Slower | < 1 GB recommended |
| **CLI (`backup_now.sh`)** | Large backups, automation, cron jobs | **Fast** | Unlimited (tested with 20GB+) |
| **Scheduled** | Automated daily/weekly backups | Fast | Unlimited |

> 💡 **Recommendation:** Use the **CLI scripts** for backups with large storage files (videos, datasets, etc.). The Web UI is convenient for smaller databases but can timeout with large files.

### Configuration

Set these variables in your `.env` file:

```env
# Backup retention period (days)
BACKUP_RETENTION_DAYS=7

# Backup schedule (cron format: minute hour day month weekday)
# Default: Daily at 2:00 AM
BACKUP_SCHEDULE_CRON=0 2 * * *
```

**Cron Examples:**
| Schedule | Cron Expression |
|----------|-----------------|
| Daily at 2 AM | `0 2 * * *` |
| Every 6 hours | `0 */6 * * *` |
| Weekly on Sunday at 3 AM | `0 3 * * 0` |
| Every 12 hours | `0 0,12 * * *` |

### CLI Backup (Recommended for Large Files)

The `backup_now.sh` script creates backups directly via Docker, bypassing the backend API for maximum speed and reliability with large storage files.

```bash
# Create a backup
./backup_now.sh

# Create backup with custom name suffix (e.g., before migration)
./backup_now.sh --name pre-migration

# List all available backups
./backup_now.sh --list

# Delete old backups (uses BACKUP_RETENTION_DAYS from .env)
./backup_now.sh --cleanup

# Delete backups older than 14 days
./backup_now.sh --cleanup --retention 14

# Show help
./backup_now.sh --help
```

**Example output:**
```
═══════════════════════════════════════════════════════════════
  SelfDB Backup Tool (CLI)
═══════════════════════════════════════════════════════════════

ℹ Creating backup: selfdb_backup_20251205_143022.tar.gz

ℹ Step 1/4: Dumping PostgreSQL database...
✓ Database dumped (2.5M)
ℹ Step 2/4: Copying .env configuration...
✓ .env file included
ℹ Step 3/4: Copying storage files...
ℹ Found 156 files (18.5G) - streaming from container...
✓ Storage files copied (156 files, 18.5G)
ℹ Step 4/4: Creating compressed archive...

═══════════════════════════════════════════════════════════════
  ✓ Backup completed successfully!
═══════════════════════════════════════════════════════════════

  Filename:  selfdb_backup_20251205_143022.tar.gz
  Size:      12.3G
  Duration:  127s
  Location:  ./backups/selfdb_backup_20251205_143022.tar.gz
```

### Web UI Backup (Small Files Only)

For quick backups with small storage (< 1 GB):

1. Login as an **admin user**
2. Navigate to **Backups** page (in sidebar)
3. Click **Create Backup**
4. Download backups directly from the list

> ⚠️ **Warning:** Web UI backups may timeout or fail with large storage files. Use CLI for backups > 1 GB.

### Scheduled Backups

Backups run automatically based on `BACKUP_SCHEDULE_CRON`. The scheduler starts with the backend service.

**View scheduled backup logs:**
```bash
docker compose logs -f backend | grep -i backup
```

**Backup files are stored in:**
```
./backups/
├── selfdb_backup_20251205_020000.tar.gz
├── selfdb_backup_20251204_020000.tar.gz
└── ...
```

### CLI Restore

For headless servers or when you prefer the command line:

```bash
# List available backups
./restore_from_backup.sh

# Restore the most recent backup
./restore_from_backup.sh latest

# Restore a specific backup
./restore_from_backup.sh selfdb_backup_20251127_113057.tar.gz
```

**Example output:**
```
═══════════════════════════════════════════════════════════════
  SelfDB Backup Restore Tool
═══════════════════════════════════════════════════════════════

Available backups in ./backups/:

  #  | Filename                              | Size      | Date
-----+---------------------------------------+-----------+-------------------
  1  | selfdb_backup_20251127_113057.tar.gz  | 420K      | 2025-11-27 11:30:57
  2  | selfdb_backup_20251126_020000.tar.gz  | 415K      | 2025-11-26 02:00:00

Usage: ./restore_from_backup.sh <backup-filename>
       ./restore_from_backup.sh latest    # Restore the most recent backup
```

### Web UI Restore (Fresh Install)

When deploying to a new server, you can restore from backup via the login page:

1. **Fresh install** - Deploy SelfDB to new server (no users exist yet)
2. **Copy backup** - Place your `.tar.gz` backup in the `./backups/` folder
3. **Open login page** - You'll see a "Restore from Backup" option
4. **Upload & restore** - Select your backup file and confirm

> ⚠️ **Note:** The restore option on the login page **disappears after the first user logs in**. This is a security feature to prevent unauthorized data overwrites.

### Backup Storage & SMB Sharing

Backups are stored in `./backups/` which is a local folder mount (not a Docker volume). This makes it easy to:

- **Access directly** - Browse backups in your file manager
- **Set up SMB/NFS share** - Share the `backups/` folder over your network
- **Sync to cloud** - Use rsync, rclone, or cloud sync tools
- **Offsite backup** - Copy to external drives or remote servers

**Example: Sync to remote server:**
```bash
rsync -avz ./backups/ user@backup-server:/backups/selfdb/
```

**Example: Sync to S3:**
```bash
aws s3 sync ./backups/ s3://my-bucket/selfdb-backups/
```

---

## Scaling SelfDB

If your machine cannot handle the current load, the recommended scaling strategy is to migrate to better compute resources (increasing CPU cores and RAM).

### Migration Guide

Follow these steps to migrate your SelfDB instance to a more powerful server:

1. **Backup Current State**  
   First, create a complete backup of your current instance using the CLI script.
   ```bash
   ./backup_now.sh --name migration
   ```

2. **Migrate to New Server**  
   Copy your current repository and the generated backup file to your new machine.

3. **Redeploy & Restore**  
   Start SelfDB on the new machine, then restore your data:
   ```bash
   ./restore_from_backup.sh selfdb_backup_YYYYMMDD_HHMMSS_migration.tar.gz
   ```

4. **Tune Worker Configuration**  
   After migrating to a machine with more CPU cores, update your `.env` file to utilize the additional resources and ensure the storage service and backend have enough resources:
   - Increase `BACKEND_WORKERS` (recommended: 1 worker per CPU core + 1)
   - Increase `STORAGE_WORKERS` (recommended: 1 worker per CPU core)

   Restart the services to apply changes:
   ```bash
   ./selfdb.sh stop
   ./selfdb.sh start
   ```

> 💡 **Note:** You can also use the Web UI for backup and restore operations on the first deploy, but this is slow. We **strongly recommend** using the bash scripts (`backup_now.sh` and `restore_from_backup.sh`) for migrations to ensure speed and reliability.

---

## Production Deployment

Deploy SelfDB to a remote production server with a single command. The deploy script handles everything: Docker installation, firewall configuration, file upload, and container orchestration.

### Quick Deploy

```bash
# Make the script executable (first time only)
chmod +x deploy.sh

# Deploy with SSH key (file path)
./deploy.sh --host YOUR_SERVER_IP --user root --ssh-key ~/.ssh/id_rsa

# Deploy with SSH key (inline content)
./deploy.sh --host YOUR_SERVER_IP --user root --ssh-key "$(cat ~/.ssh/id_rsa)"

# Deploy with password authentication
./deploy.sh --host YOUR_SERVER_IP --user root --password 'your_password'

# Or use the interactive wizard
./deploy.sh
```

**Requirements:**
- Local: `ssh`, `rsync`, `tar`, `sshpass` (for password auth)
- Remote: Ubuntu 20.04+, Debian, or any Docker-compatible Linux
- SSH access to your server (key-based or password)

### Interactive Wizard

Run `./deploy.sh` without arguments to start the interactive wizard:

```
╔═══════════════════════════════════════════════════════════════╗
║  🚀 SelfDB Deploy                                             ║
║  Deploy SelfDB to production with one command                 ║
╚═══════════════════════════════════════════════════════════════╝

Let's deploy SelfDB to your server!

Server IP or hostname: 192.168.1.50
SSH username [root]: 
Found SSH keys:
  1) ~/.ssh/id_ed25519
  2) ~/.ssh/id_rsa
Select key (1-2) or Enter for default: 1

Pre-deploy checklist:

  ✓ Local: SelfDB repo detected
  ✓ Local: ssh, tar, rsync installed
  → Remote: 192.168.1.50
  → User: root
  → Mode: redeploy (updating existing installation)
  → URL: http://192.168.1.50

Proceed with deployment? [Y/n]:
```

### Command-Line Options

| Flag | Description | Default |
|------|-------------|---------|
| `--host <ip>` | Server IP or hostname | (required) |
| `--user <name>` | SSH username | `root` |
| `--ssh-key <key>` | SSH private key (file path or content) | Auto-detected |
| `--password <pwd>` | Password for SSH authentication | Key-based |
| `--port <num>` | SSH port | `22` |

```
                    Internet
                        │
                        ▼
                   ┌─────────┐
                   │  Caddy  │ :80 (HTTP)
                   │ (Proxy) │ :443 (HTTPS, auto)
                   └────┬────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
     /api/*         /caddy-health   /* (all else)
          │             │             │
          ▼             ▼             ▼
    ┌──────────┐   ┌─────────┐  ┌──────────┐
    │ Backend  │   │  "OK"   │  │ Frontend │
    │ :8000    │   │  200    │  │  :80     │
    └──────────┘   └─────────┘  └──────────┘
          │
          └──────────────┬───────────────┐
                         │               │
                    ┌────┴────┐    ┌─────┴─────┐
                    │Realtime │    │  Storage  │
                    │ Phoenix │    │  FastAPI  │
                    └─────────┘    └───────────┘
```

**Key files:**

| File | Purpose |
|------|---------|
| `deploy.sh` | Main deployment script (~800 lines) |
| `docker-compose-production.yml` | Production Docker Compose with Caddy (project name: `selfdb`) |
| `caddy/Caddyfile` | Caddy reverse proxy configuration |

> **Note:** The production compose file defines `name: selfdb` at the top level. This ensures all containers are labeled with `com.docker.compose.project=selfdb`, which is used by the deploy script for targeted cleanup of old containers and images.

### docker-compose-production.yml

The production compose file differs from development in these key ways:

| Aspect | Development | Production |
|--------|-------------|------------|
| Entry Point | Frontend :3000, Backend :8000 | Caddy :80/:443 |
| Exposed Ports | Multiple services exposed | Only Caddy exposed |
| Reverse Proxy | None (direct access) | Caddy handles routing |
| SSL | Not configured | ✅ Auto HTTPS (Let's Encrypt) |

**Services in production:**

| Service | Internal Port | External Access |
|---------|---------------|-----------------|
| Caddy | 80, 443 | ✅ Public |
| Frontend | 80 | Via Caddy `/` |
| Backend | 8000 | Via Caddy `/api/*` |
| Database | 5432 | ❌ Internal only |
| PgBouncer | 6432 | ❌ Internal only |
| Realtime | 4000 | ❌ Via Backend proxy |
| Storage | 9000 | ❌ Via Backend proxy |
| Functions | 8080 | ❌ Via Backend proxy |

### caddy/Caddyfile

The Caddyfile configures routing for all HTTP traffic.

Production uses **hostnames** (e.g. `app.example.com`, `api.example.com`) so Caddy can automatically provision TLS certificates.

```caddyfile
{
  # Email used for Let's Encrypt / ACME account registration
  email {$CADDY_EMAIL}
}

# Frontend domain (serves the React app) and proxies /api/* to backend
{$FRONTEND_DOMAIN} {
  handle /api/* {
    uri strip_prefix /api
    reverse_proxy backend:{$BACKEND_PORT}
  }

  handle /caddy-health {
    respond "OK" 200
  }

  handle {
    reverse_proxy frontend:80
  }

  log {
    output stdout
    format console
  }
}

# Backend domain (optional): proxies *all* traffic to backend
{$BACKEND_DOMAIN} {
  reverse_proxy backend:{$BACKEND_PORT}

  log {
    output stdout
    format console
  }
}
```

**Routing logic:**
- `https://$FRONTEND_DOMAIN/api/users/token` → `backend:$BACKEND_PORT/users/token` (prefix stripped)
- `https://$FRONTEND_DOMAIN/dashboard` → `frontend:80/dashboard`
- `https://$BACKEND_DOMAIN/users/token` → `backend:$BACKEND_PORT/users/token`

### Configuration

Before deploying to production, update your `.env` file:

```env
# Required for Caddy Auto HTTPS
CADDY_EMAIL=you@yourdomain.com
FRONTEND_DOMAIN=app.yourdomain.com
BACKEND_DOMAIN=api.yourdomain.com

# CRITICAL: Add your production URLs to CORS origins
# (use https once Caddy has provisioned certificates)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,https://app.yourdomain.com,https://api.yourdomain.com

# If you display webhook URLs in the UI, set a public base URL too
PUBLIC_WEBHOOK_BASE_URL=https://api.yourdomain.com

# Generate new keys for production!
./generate_keys.sh

# Recommended: Increase workers for production hardware
BACKEND_WORKERS=4    # 1 per CPU core + 1
STORAGE_WORKERS=3    # 1 per CPU core
```

**DNS / Firewall prerequisites (Auto HTTPS):**
- Create DNS A/AAAA records for `FRONTEND_DOMAIN` and `BACKEND_DOMAIN` pointing to your server IP.
- Ensure inbound ports **80** and **443** are open to the internet (Caddy uses port 80 for HTTP-01 challenge).

### Deployment Steps

The `deploy.sh` script performs these 7 steps:

| Step | Description | Init | Redeploy |
|------|-------------|------|----------|
| 1 | Check local requirements | ✅ | ✅ |
| 2 | Connect to server via SSH | ✅ | ✅ |
| 3 | Install Docker | ✅ | Skip |
| 3.5 | Configure firewall (UFW) | ✅ | Skip |
| 3.6 | Install fail2ban | ✅ | Skip |
| 4 | Upload SelfDB via rsync | ✅ | ✅ |
| 5 | Start Docker Compose stack | ✅ | ✅ |
| 6 | Run health checks | ✅ | ✅ |

**Auto-detection:**
- **Init mode**: First deployment (no existing `/home/user/Desktop/SelfDB`)
- **Redeploy mode**: Subsequent deployments (folder exists)

### Updating Production

To update a running production instance:

```bash
# Pull latest changes
git pull origin main

# Redeploy (containers restart with new code)
./deploy.sh --host YOUR_SERVER_IP --user root --ssh-key ~/.ssh/id_rsa
```

The script:
1. Uses `rsync` for fast delta-only file transfer
2. Preserves Docker volumes (database, storage, functions)
3. Rebuilds only changed containers
4. Never stops running containers on failure

### Security Features

**Fail2ban Protection**

On first deployment (init mode), the deploy script automatically installs and configures fail2ban to protect your server from brute-force SSH attacks.

**Configuration:**
- **Ban time**: 24 hours for SSH attacks
- **Max retries**: 3 failed attempts within 10 minutes
- **Services protected**: SSH (sshd)
- **Automatic**: Installed only on initial deployment

**Check fail2ban status:**
```bash
ssh root@YOUR_SERVER
sudo fail2ban-client status sshd
```

**Manually ban/unban IP:**
```bash
# Ban an IP
sudo fail2ban-client set sshd banip 192.168.1.100

# Unban an IP
sudo fail2ban-client set sshd unbanip 192.168.1.100
```

### Remote Directory

Files are deployed to:
```
/home/<user>/Desktop/SelfDB/
├── backend/
├── frontend/
├── caddy/
│   └── Caddyfile
├── docker-compose-production.yml
├── .env
└── ...
```

**Why this location?**
- Single folder (no versioned releases) preserves Docker volumes
- Easy to SSH in and inspect: `cd ~/Desktop/SelfDB`
- Backups stored in `./backups/` on the server

### Troubleshooting Deployment

**SSH Connection Failed**

```
❌ Deployment failed at step 2/6
Reason: Could not connect to server

How to fix:
1. Check server IP is correct: 192.168.1.50
2. Check your username: root
3. Try manually: ssh root@192.168.1.50
4. If using key auth, try: ssh-copy-id root@192.168.1.50
```

**Docker Install Failed**

```
❌ Deployment failed at step 3/6
Reason: Docker installation failed

How to fix:
1. SSH to server: ssh root@192.168.1.50
2. Install Docker manually: curl -fsSL https://get.docker.com | sh
3. Run deploy again
```

**API Returns 404**

If the frontend loads but API calls fail with 404:

1. Check CORS origins in `.env` includes your production URL
2. Verify Caddyfile has `uri strip_prefix /api`
3. Restart Caddy:
   ```bash
   ssh root@YOUR_SERVER
   cd ~/Desktop/SelfDB
   docker compose -f docker-compose-production.yml restart caddy
   ```

**View Container Logs**

```bash
# SSH to server
ssh root@YOUR_SERVER

# View all logs
cd ~/Desktop/SelfDB
docker compose -f docker-compose-production.yml logs -f

# View specific service
docker compose -f docker-compose-production.yml logs -f backend
docker compose -f docker-compose-production.yml logs -f caddy
```

**Check Container Status**

```bash
docker compose -f docker-compose-production.yml ps
```

---

## Project Structure

```
selfdb/
├── docker-compose.yml           # Development stack orchestration
├── docker-compose-production.yml # Production stack with Caddy
├── deploy.sh                    # Production deployment script
├── README.md                    # This file
├── backup_now.sh                # CLI backup tool (fast, for large files)
├── restore_from_backup.sh       # CLI restore tool
├── selfdb.sh                    # Development management script
├── generate_keys.sh             # Security key generator
├── .env                         # Environment configuration
│
├── caddy/                  # Caddy reverse proxy (production)
│   └── Caddyfile           # Routing configuration
│
├── backups/                # Backup storage (auto-created)
│   └── selfdb_backup_*.tar.gz
│
├── backend/                # FastAPI Backend (API Gateway)
│   ├── main.py             # Application entry point
│   ├── db.py               # Database connection
│   ├── security.py         # Authentication & authorization
│   ├── storage_client.py   # Storage service client
│   ├── pyproject.toml      # Python dependencies
│   │
│   ├── endpoints/          # API route handlers
│   │   ├── users.py        # User CRUD
│   │   ├── tables.py       # Dynamic tables
│   │   ├── sql.py          # Raw SQL queries
│   │   ├── buckets.py      # Storage buckets
│   │   ├── files.py        # File uploads
│   │   ├── realtime.py     # WebSocket proxy
│   │   ├── backups.py      # Backup management
│   │   └── system.py       # System status
│   │
│   ├── models/             # Pydantic schemas
│   ├── services/           # Business logic
│   └── utils/              # Helpers & validation
│
├── frontend/               # React Frontend (Admin UI)
│   ├── src/
│   │   ├── client/         # Generated API client (SDK)
│   │   ├── components/     # Reusable UI components
│   │   ├── context/        # React context (auth, etc.)
│   │   ├── lib/            # Utilities & constants
│   │   └── pages/          # Page components
│   │
│   ├── package.json        # Node dependencies
│   └── vite.config.ts      # Vite configuration
│
├── realtime/               # Phoenix/Elixir Realtime Service
│   ├── lib/                # Elixir source code
│   ├── config/             # Phoenix configuration
│   └── mix.exs             # Elixir dependencies
│
├── storage/                # FastAPI Storage Service
│   ├── main.py             # Storage API
│   ├── endpoints/          # Bucket & file handlers
│   ├── models/             # Storage schemas
│   └── data/               # File storage volume
│
├── database/               # PostgreSQL initialization
│   ├── init/               # SQL init scripts
│   └── migrations/         # Schema migrations
│
└── pgbouncer-1.25.1/       # Connection pooler
```

---

## API Documentation

When the backend is running, access the interactive API documentation:

| URL | Description |
|-----|-------------|
| http://localhost:8000/docs | Swagger UI (interactive) |
| http://localhost:8000/redoc | ReDoc (read-only) |
| http://localhost:8000/openapi.json | OpenAPI JSON spec |

**Authentication:**
- All requests require `X-API-Key: Myapi-Key-for-dev` header
- Protected endpoints also require `Authorization: Bearer <token>` header
- Get a token via `POST /users/token` with email/password

---

## Troubleshooting

> ⚠️ **Warning:** The steps in this section involve modifying files and rebuilding containers. Make sure to backup any custom configurations before proceeding.

### PgBouncer Container Fails to Start

If the PgBouncer container fails to build or start, you can manually download the source and rebuild:

1. **Download the PgBouncer source tarball:**
   ```bash
   wget https://www.pgbouncer.org/downloads/files/1.25.1/pgbouncer-1.25.1.tar.gz
   ```

2. **Extract the archive:**
   ```bash
   tar -xzf pgbouncer-1.25.1.tar.gz
   ```

3. **Copy the Dockerfile and entrypoint script from the existing folder:**
   ```bash
   cp pgbouncer-1.25.1/Dockerfile pgbouncer-1.25.1-new/Dockerfile
   cp pgbouncer-1.25.1/docker-entrypoint.sh pgbouncer-1.25.1-new/docker-entrypoint.sh
   ```
   
   Or replace the existing folder entirely:
   ```bash
   # Backup existing Docker files
   cp pgbouncer-1.25.1/Dockerfile /tmp/Dockerfile.bak
   cp pgbouncer-1.25.1/docker-entrypoint.sh /tmp/docker-entrypoint.sh.bak
   
   # Remove old folder and rename new one
   rm -rf pgbouncer-1.25.1
   mv pgbouncer-1.25.1-extracted pgbouncer-1.25.1
   
   # Restore Docker files
   cp /tmp/Dockerfile.bak pgbouncer-1.25.1/Dockerfile
   cp /tmp/docker-entrypoint.sh.bak pgbouncer-1.25.1/docker-entrypoint.sh
   ```

4. **Rebuild the PgBouncer container:**
   ```bash
   docker-compose build pgbouncer
   docker-compose up -d pgbouncer
   ```

---

## Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, documentation improvements, or suggestions — all contributions are appreciated.

**How to contribute:**

1. **Fork the repository** - Click the "Fork" button on GitHub
2. **Clone your fork** - `git clone https://github.com/YOUR_USERNAME/selfdb.git`
3. **Create a branch** - `git checkout -b feature/your-feature-name`
4. **Make your changes** - Write code, tests, and documentation
5. **Commit your changes** - `git commit -m "Add: your feature description"`
6. **Push to your fork** - `git push origin feature/your-feature-name`
7. **Open a Pull Request** - Submit your PR with a clear description

**Guidelines:**
- Follow the existing code style and conventions
- Write clear commit messages
- Add tests for new features when applicable
- Update documentation as needed

For major changes, please open an issue first to discuss what you would like to change.

---

## License

This project is licensed under the **O’Saasy License Agreement** - see the [LICENSE](LICENSE) file for details.

```
O’Saasy License Agreement - Copyright (c) 2025 SelfDB
```

You are free to use, modify, and distribute this software for any purpose.

---

## Learn More

- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [PostgreSQL](https://www.postgresql.org/docs/)
- [PgBouncer](https://www.pgbouncer.org/)
- [Phoenix Framework](https://www.phoenixframework.org/) (Realtime)
- [Schemathesis](https://schemathesis.readthedocs.io/)
- [Locust](https://locust.io/)
- [hey-api/openapi-ts](https://heyapi.vercel.app/)