# Action

| Section | Description |
|--------|-------------|
| [Ports reference](#ports-reference) | What runs on what port (Nginx, Docker, Ubuntu/Hetzner, local) |
| [System diagram](#system-diagram-mermaid--one-page) | One-page system diagram (Mermaid + PNG image) |
| [SelfDB database name](#selfdb-database-name-always-the-same-on-local-and-server) | Use `gpc_selfdb` on local and server |
| [Sync SelfDB](#sync-selfdb-local--server) | Deploy SELFDB-GPC to server |
| [View SelfDB GUI](#view-selfdb-gui) | Local/server GUI URLs, SSH tunnel, login fix |
| [When to use which deploy script](#when-to-use-which-deploy-script) | deploy-site vs deploy-selfdb vs deploy-all |
| [Create a SelfDB table](#create-a-selfdb-table-on-the-server-curl--url-and-api-key-from-env) | API + script to create tables on server |
| [Replicate table in 09_gpc_schema.sql](#replicate-the-table-in-09_gpc_schemasql) | Add new tables to schema file after API create |
| [Fix SelfDB table with no columns in GUI](#fix-selfdb-table-with-no-columns-in-gui) | Table has rows but columns are blank — fix empty table_schema |
| [Backups](#backups) | Where backups live, how to run one, how to download to Mac |

---

## Ports reference

Quick reference: what is running on what port. Use this when debugging or configuring Nginx/Docker.

### Hetzner server (Ubuntu at 46.225.232.77)

| Port | Service | Notes |
|------|---------|--------|
| **80** | Nginx | HTTP for grandpluscollege.com (redirects to 443 or serves site). |
| **443** | Nginx | HTTPS for grandpluscollege.com. Serves static site and **proxies `/api/`** to GPC backend on port 4000. |
| **4000** | GPC Node.js backend (PM2) | Express/TypeScript API at `/home/femi/gpc-backend`. Managed by PM2. Nginx proxies `https://grandpluscollege.com/api/` → `http://127.0.0.1:4000`. Deploy with `./deploy-backend.sh`. |
| **3000** | Docker (SelfDB frontend) | SelfDB admin GUI. Not public; use SSH tunnel (e.g. local 3002 → server 3000). |
| **8000** | Docker (SelfDB backend) | SelfDB REST API — internal use only. **Not the GPC API** (that's port 4000). |
| **5432** | Docker (PostgreSQL) | Exposed to localhost only (`127.0.0.1:5432:5432` in docker-compose). GPC Node.js backend connects via `DATABASE_URL=postgresql://...@localhost:5432/gpc_selfdb`. |
| (internal) | PgBouncer | Inside Docker only, port 6432 on `selfdb-network`. |
| (internal) | Realtime, Storage, Functions | Inside Docker only (e.g. 9000, 8090). |

### Local (Mac)

| Port | Service | Notes |
|------|---------|--------|
| **3000** | Docker (SelfDB frontend) | Local SelfDB GUI when `./selfdb.sh start` in SELFDB-GPC. |
| **8000** | Docker (SelfDB backend) | Local SelfDB API. |
| **6432** | Docker (PgBouncer) | Only if exposed by compose; can conflict with other SelfDB stacks. |
| **3002** | SSH tunnel (local side) | With `ssh -L localhost:3002:localhost:3000 femi@46.225.232.77`, browser uses **http://localhost:3002** for **server** GUI. |

### Summary

- **Public site:** Nginx 80/443 → grandpluscollege.com; `/api/` → **GPC Node.js backend on port 4000**.
- **GPC backend:** PM2 process at `/home/femi/gpc-backend`, port 4000. Deploy with `./deploy-backend.sh`.
- **Server SelfDB:** Backend (REST API) on port 8000 — internal only, not the GPC API. GUI on port 3000; access via tunnel to **localhost:3002**.
- **Server PostgreSQL:** Exposed to localhost on port 5432 (`127.0.0.1:5432`) so the GPC backend (host process) can connect directly.
- **Local SelfDB:** Frontend 3000, backend 8000 on your Mac.

---

## System diagram (Mermaid + image, one page)

This is a high-level, single-page view of how everything connects (browser → Cloudflare → Hetzner/Nginx → SelfDB → Postgres).

If your Markdown viewer **does not support Mermaid**, use the PNG below instead — it’s exported from `diagram/graphflow.html`.

![System flow diagram](<ChatGPT Image Feb 25, 2026, 03_51_16 PM.png>)

```mermaid
flowchart LR
    %% Clients
    BROWSER[Browser\nUser on web]

    %% Cloudflare / DNS
    CF[Cloudflare DNS + HTTPS\ngrandpluscollege.com]

    %% Hetzner / Nginx
    NGX[Nginx on Hetzner\n:80 / :443\nStatic site + /api proxy]

    %% Local vs Server split (conceptual)
    subgraph SERVER[Hetzner Server]
        subgraph SELFDB[SelfDB (Docker)]
            FE[Frontend\nport 3000\nAdmin GUI]
            BE[Backend API\nport 8000]

            subgraph DBTIER[Database tier]
                PG[PostgreSQL\nport 5432\nDB: gpc_selfdb]
                PGB[PgBouncer\nport 6432]
            end
        end
    end

    subgraph LOCAL[Local Mac]
        LFE[Local SelfDB Frontend\nhttp://localhost:3000]
        LBE[Local SelfDB Backend\nhttp://localhost:8000]
    end

    %% Requests
    BROWSER -->|"https://grandpluscollege.com"| CF --> NGX
    NGX -->|"/ (HTML/CSS/JS)"| SITE[Static site files\nin /var/www/grandpluscollege]
    NGX -->|"/api/*"| BE

    %% Backend → DB
    BE -->|"tcp:6432"| PGB -->|"tcp:5432"| PG

    %% Local SelfDB path (no Cloudflare)
    BROWSER -->|"http://localhost:3000"| LFE
    LFE -->|"http://localhost:8000"| LBE
    LBE -->|"tcp:6432 (local PgBouncer)"| PGB

    %% SSH tunnel for server GUI
    BROWSER -->|"http://localhost:3002\nSSH tunnel"| TUNNEL[SSH tunnel\nlocalhost:3002 → server:3000] --> FE
```

---

## SelfDB database name: always the same on local and server

Use **`gpc_selfdb`** in both places so schema and scripts match.

- **Local (Mac):** In `~/Desktop/SELFDB-GPC/.env` set:
  ```bash
  POSTGRES_DB=gpc_selfdb
  ```
- **Server (Hetzner):** In `~/selfdb/.env` set:
  ```bash
  POSTGRES_DB=gpc_selfdb
  ```
After every deploy, the deploy script forces the server to use `gpc_selfdb` so it stays in sync with local.

**Verified in this project:** Local `SELFDB-GPC/.env` has `POSTGRES_DB=gpc_selfdb`. `deploy-selfdb.sh` sets it on the server after each sync. Backup script uses `gpc_selfdb`.

---

## Sync SelfDB (local → server)

Sync your local **SELFDB-GPC** folder to the server and start the stack. Run from project root. Code and schema sync; **database data does not sync**.

```bash
cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
./deploy-selfdb.sh
```

**Sync only (no restart):**
```bash
rsync -avz --exclude='.git' --exclude='node_modules' --exclude='SDKs/python/.venv' --exclude='SDKs/swift/.build' --exclude='backend/__pycache__' --exclude='*.pyc' \
  /Users/stfrancis/Desktop/SELFDB-GPC/ \
  femi@46.225.232.77:~/selfdb/
```

**Then on server (restart stack):**
```bash
ssh femi@46.225.232.77 'cd ~/selfdb && docker compose -f docker-compose-production.yml up -d'
```

**If server DB is `gpc_selfdb` and deploy overwrote .env:** fix and restart:
```bash
ssh femi@46.225.232.77 'sed -i "s/^POSTGRES_DB=selfdb$/POSTGRES_DB=gpc_selfdb/" ~/selfdb/.env && cd ~/selfdb && docker compose -f docker-compose-production.yml up -d'
```

---

## View SelfDB GUI

| | Local GUI | Server GUI |
|---|-----------|------------|
| **URL** | http://localhost:3000 | http://localhost:3002 (use 3002 to avoid conflict with local) |
| **When** | Local SelfDB stack running | SSH tunnel running (see below) |
| **What you see** | Your Mac’s SelfDB (local DB) | Production SelfDB on Hetzner (server DB) |
| **How** | 1. Start local stack (see below). 2. Open http://localhost:3000. | 1. Run tunnel: `ssh -f -N -L localhost:3002:localhost:3000 femi@46.225.232.77`. 2. Open http://localhost:3002. |
| **Login** | ADMIN_EMAIL / ADMIN_PASSWORD from `SELFDB-GPC/.env` (create admin locally first). | Same credentials; create admin on server once (see “Server GUI” below). |

**Local GUI (Mac)**  
With SELFDB-GPC running (`cd ~/Desktop/SELFDB-GPC && ./selfdb.sh start`):

- **GUI:** http://localhost:3000  
- **API:** http://localhost:8000  

If port 6432 (or 3000/8000) is already in use, stop the other SelfDB stack first:
```bash
cd ~/Desktop/SELFDB-GPC/SELFDB-V0.0.5.4 && docker compose down
cd ~/Desktop/SELFDB-GPC && ./selfdb.sh start
```

**Server (production)**
SelfDB on the server has no public GUI URL. To view tables/data use an SSH tunnel. Use **local port 3002** so it doesn’t clash with local SelfDB (3000) or other tunnels (3001):

1. Open an SSH tunnel (local 3002 → server’s 3000):
   ```bash
   ssh -f -N -L localhost:3002:localhost:3000 femi@46.225.232.77
   ```
2. In your browser go to **http://localhost:3002** (server’s SelfDB GUI).

**Quick: use server GUI**
1. Run: `ssh -f -N -L localhost:3002:localhost:3000 femi@46.225.232.77`
2. Open **http://localhost:3002** in the browser.
3. Log in with **ADMIN_EMAIL** and **ADMIN_PASSWORD** from `~/Desktop/SELFDB-GPC/.env`.

> **Admin user already exists on the server** (created 2026-02-26). No need to re-run create-admin unless the server DB is wiped.

**If server GUI doesn’t work:**  
- **Page won’t load:** Make sure the server stack is running: `ssh femi@46.225.232.77 'cd ~/selfdb && docker compose -f docker-compose-production.yml ps'`. If the frontend isn’t up, run `./deploy-selfdb.sh` from the project root.  
- **Using port 3000 for tunnel:** If you already use `ssh -L 3000:localhost:3000`, then **stop local SelfDB** first (so nothing else is using 3000), then open http://localhost:3000. Or switch to the 3001 tunnel above and use http://localhost:3001.  
- **Login fails:** Re-run the “Server GUI” steps below to create the admin on the server and set role to ADMIN.

**GUI login (invalid username or password)**  
Use the **create-admin** script (creates user via API so the backend hashes the password — this is the fix that worked before):

```bash
cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
# With local SELFDB-GPC running (./selfdb.sh start):
SELFDB_API_URL=http://localhost:8000 ./scripts/selfdb-create-admin.sh
```

Log in at **http://localhost:3000** with **ADMIN_EMAIL** and **ADMIN_PASSWORD** from `~/Desktop/SELFDB-GPC/.env`. Use them exactly (no extra spaces).

**Do this now (step by step):**

1. **Start local SelfDB** (if not already running):
   ```bash
   cd ~/Desktop/SELFDB-GPC
   ./selfdb.sh start
   ```

2. **Run the create-admin script** (from project root; safe to run again):
   ```bash
   cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
   SELFDB_API_URL=http://localhost:8000 ./scripts/selfdb-create-admin.sh
   ```

3. **Open the GUI in a private/incognito window** → go to **http://localhost:3000** (local only, not via SSH tunnel).

4. **Log in** using the values of `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `~/Desktop/SELFDB-GPC/.env`. Type them manually (no autofill).

If it still fails, confirm the browser URL is exactly `http://localhost:3000` and note the exact error message.

**Alternative (DB-only):** `./scripts/selfdb-seed-admin.sh` upserts the user directly in the DB. If login still fails (e.g. hash mismatch), use create-admin instead.

**Server GUI (tunnel) – create admin on server so you can log in:**
With the SSH tunnel running (use port 3002; see above), http://localhost:3002 shows the **server** GUI.

> **Already done (2026-02-26):** Admin user `femioginos@gmail.com` was created on the server and role set to ADMIN. Just open the tunnel and log in — no need to re-run unless the server DB is wiped.

If you ever need to recreate the admin on the server (e.g. after a DB wipe):

1. **Create the admin user on the server** (via production API):
   ```bash
   cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
   SELFDB_API_URL=https://grandpluscollege.com/api ./scripts/selfdb-create-admin.sh
   ```

2. **Set that user to ADMIN on the server DB:**
   ```bash
   ADMIN_EMAIL=$(grep -E '^ADMIN_EMAIL=' ~/Desktop/SELFDB-GPC/.env | cut -d= -f2-)
   ssh femi@46.225.232.77 “docker exec \$(docker ps -qf 'name=db-1' | head -1) psql -U postgres -d gpc_selfdb -c \”UPDATE users SET role = 'ADMIN', is_active = true WHERE email = '$ADMIN_EMAIL';\””
   ```

3. Open **http://localhost:3002** and log in with **ADMIN_EMAIL** and **ADMIN_PASSWORD** from `~/Desktop/SELFDB-GPC/.env`.

---

## When to use which deploy script

| Script | When to use |
|--------|-------------|
| `./deploy-site.sh` | HTML/CSS/JS changed, or support/apply form pages changed |
| `./deploy-selfdb.sh` | SelfDB code in `~/Desktop/SELFDB-GPC` changed (schema, backend, config) |
| `./deploy-backend.sh` | GPC Node.js backend changed (`backend/` folder — routes, payments, DB logic) |
| `./deploy-all.sh` | Everything changed — runs site + SelfDB + GPC backend deploy, then commits and pushes to git |

**What each script does:**

**`deploy-site.sh`**
- Bumps cache busters on all HTML files (`styles.css?v=...`, `menu.js?v=...`)
- Injects `SELFDB_API_URL` and `SELFDB_API_KEY` from `.env` into `support.html` and `apply.html` (so the contact and application forms work)
- Rsyncs all site files to `/var/www/html/grandpluscollege` on the server

**`deploy-selfdb.sh`**
- Rsyncs `~/Desktop/SELFDB-GPC/` to `~/selfdb/` on the server
- Ensures `POSTGRES_DB=gpc_selfdb` in the server `.env`
- Restarts the SelfDB Docker stack (`docker compose up -d`)

**`deploy-all.sh`**
- Runs `deploy-site.sh` → `deploy-selfdb.sh` → `deploy-backend.sh` → `git add . && git commit && git push`
- Uses `gacp` shortcut if available, otherwise plain git commands; also restarts the GPC backend via PM2 as part of `deploy-backend.sh`

**Do you need to restart anything?**

No — in normal use the deploy scripts handle everything automatically:
- `deploy-site.sh` → no restart needed
- `deploy-selfdb.sh` → already runs `docker compose up -d`
- `deploy-backend.sh` (and `deploy-all.sh`) → already restarts the GPC backend PM2 process

Only restart manually if something is broken or you changed a config file directly on the server:
```bash
./restart-services.sh
```
This restarts both **nginx** and the **SelfDB Docker stack** in one command.

**After deploying, view results:**

- **Local GUI** — run `./deploy-selfdb.sh` then open http://localhost:3000
  ```bash
  cd ~/Desktop/SELFDB-GPC && ./selfdb.sh start
  ```
  Open **http://localhost:3000**

- **Server GUI** — open tunnel then open http://localhost:3002
  ```bash
  ssh -f -N -L localhost:3002:localhost:3000 femi@46.225.232.77
  ```
  Open **http://localhost:3002**

---

## Create a SelfDB table on the server (curl – URL and API key from .env)

Run from project root. You only change the `-d` JSON.

```bash
cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
./scripts/selfdb-create-table.sh '{"name":"YOUR_TABLE_NAME","table_schema":{"col1":{"type":"text","nullable":true},"col2":{"type":"integer","nullable":true}},"public":true}'
```

### Examples

**Simple table:**
```bash
./scripts/selfdb-create-table.sh '{"name":"news","table_schema":{"title":{"type":"text","nullable":false},"body":{"type":"text","nullable":true}},"public":true}'
```

**Another:**
```bash
./scripts/selfdb-create-table.sh '{"name":"events","table_schema":{"title":{"type":"text","nullable":false},"event_date":{"type":"timestamp","nullable":true}},"public":true}'
```

The script reads `SELFDB_API_URL` and `SELFDB_API_KEY` from `.env`; you don’t put the URL or API key in the command.

---

## Replicate the table in `09_gpc_schema.sql`

After creating a table via the API, add the same table to **`~/Desktop/SELFDB-GPC/database/init/09_gpc_schema.sql`** (before the final `INSERT` block). Copy the template below, replace `TABLE_NAME`, columns, and description, then paste into the file.

**1. CREATE TABLE (edit name + columns):**
```sql
CREATE TABLE IF NOT EXISTS TABLE_NAME (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- your columns, e.g.:
    title VARCHAR(255) NOT NULL,
    body TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**2. Register in SelfDB (edit name + description):**
```sql
INSERT INTO tables (id, name, table_schema, public, owner_id, description, realtime_enabled)
SELECT gen_random_uuid(), 'TABLE_NAME', '{}'::jsonb, true, (SELECT id FROM users LIMIT 1), 'Short description for admin UI', true
ON CONFLICT (name) DO NOTHING;
```

**Example for a `news` table:** replace `TABLE_NAME` with `news`, columns with `title`, `body`, etc., and description with e.g. `'News items for site'`. Then run `./deploy-selfdb.sh` so the server has the updated schema file.

---

## Fix SelfDB table with no columns in GUI

If a table shows rows in the GUI but the columns are all blank, the `table_schema` field is empty (`{}`). This happens when a table is created via raw SQL instead of the SelfDB API.

**Fix — update `table_schema` directly in the server DB:**

```bash
ssh femi@46.225.232.77 'cat > /tmp/fix_schema.sql << '"'"'SQLEOF'"'"'
UPDATE tables SET table_schema = '{"col1":{"type":"text","nullable":false},"col2":{"type":"text","nullable":true}}'::jsonb WHERE name = 'your_table_name';
SQLEOF
docker exec -i selfdb-db-1 psql -U postgres -d gpc_selfdb < /tmp/fix_schema.sql'
```

Replace `col1`, `col2`, and `your_table_name` with the real column names and table name.

**`contact_submissions` schema (already fixed 2026-02-27):**
```json
{
  "name":       {"type": "text",      "nullable": false},
  "email":      {"type": "text",      "nullable": false},
  "category":   {"type": "text",      "nullable": true},
  "message":    {"type": "text",      "nullable": false},
  "created_at": {"type": "timestamp", "nullable": true}
}
```

**Why the API can't be used:** The `PATCH /tables/:id` endpoint has a backend bug — it fails to serialize the dict to JSON (`cannot adapt type 'dict'`). The DB direct approach is the working fix.

---

## Backups

### Where backups are stored

Backups live on the **server itself** at `~/selfdb/backups/` (`femi@46.225.232.77`).

> **Warning:** If the server is wiped, backups go with it. Download to your Mac periodically (see below).

### Automatic backups

The server runs a backup automatically every day at **2am**. Current backups:
```
selfdb_backup_20260220_020000.tar.gz   22K
selfdb_backup_20260221_020000.tar.gz   22K
selfdb_backup_20260227_020000.tar.gz   8.5K
```

### What gets backed up

- PostgreSQL database dump (all tables + data)
- Storage files (uploaded files)
- `.env` configuration

### Run a manual backup (server)

```bash
ssh femi@46.225.232.77 'cd ~/selfdb && ./backup_now.sh'
```

With a custom name:
```bash
ssh femi@46.225.232.77 'cd ~/selfdb && ./backup_now.sh --name before-changes'
```

### List all backups on server

```bash
ssh femi@46.225.232.77 'cd ~/selfdb && ./backup_now.sh --list'
```

### Auto-sync to Mac (already set up)

A cron job runs every day at **3am** (1 hour after the server's 2am backup) and syncs all server backups to your Mac:

- **Mac location:** `~/Desktop/selfdb-backups/`
- **Log:** `~/Desktop/selfdb-backups/sync.log`
- **Script:** `scripts/sync-server-backups.sh`

> **Note:** Cron on macOS only runs when your Mac is **awake**. If your laptop is closed at 3am the job won't run — use the manual sync below instead.

### Manual sync to Mac (run whenever you want)

```bash
cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
./scripts/sync-server-backups.sh
```

This downloads all new/changed backups from the server to `~/Desktop/selfdb-backups/`. Safe to run multiple times — rsync only copies what changed.

### Download a single backup manually

```bash
scp femi@46.225.232.77:~/selfdb/backups/selfdb_backup_20260227_020000.tar.gz ~/Desktop/
```

### Via the GUI

Go to **http://localhost:3002** → **Backups** in the left sidebar to trigger and manage backups visually.
