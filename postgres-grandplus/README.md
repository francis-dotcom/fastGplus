# Postgres for Grand Plus (second DB on Hetzner)

Standalone Postgres instance that runs **alongside** your existing SelfDB. Use it to try replacing Supabase later, or remove it.

- **Port:** `5433` on host (so it does not clash with default 5432).
- **Bound to:** `127.0.0.1` only (not exposed to the internet).
- **Schema:** `applications`, `contact_submissions`, `payments`, `testimonials`, `application_documents` (created on first run).

## On your Hetzner VPS

### Option A: One script (after copying folder)

1. Copy this folder to the server (e.g. `rsync -avz postgres-grandplus/ user@IP:~/postgres-grandplus/`).
2. SSH in, then run:
   ```bash
   cd ~/postgres-grandplus
   chmod +x setup-on-server.sh
   ./setup-on-server.sh
   ```
3. First run creates `.env` from `env.example` and exits. Edit `.env` (set a strong `POSTGRES_PASSWORD`), then run `./setup-on-server.sh` again to start Postgres.

### Option B: Manual steps

### 1. Copy this folder to the server

From your laptop (from repo root):

```bash
rsync -avz postgres-grandplus/ user@YOUR_HETZNER_IP:~/postgres-grandplus/
```

Or clone the repo on the server and `cd` into `postgres-grandplus/`.

### 2. Create `.env`

On the server:

```bash
cd ~/postgres-grandplus
cp env.example .env
nano .env   # set POSTGRES_USER, POSTGRES_PASSWORD (strong!), POSTGRES_DB
```

Use a strong password.

### 3. Create backups directory

```bash
mkdir -p ~/postgres-grandplus/backups
```

### 4. Start Postgres

```bash
docker compose up -d
docker compose ps
docker compose logs -f
```

### 5. Check DB and schema

```bash
docker exec -it postgres_grandplus psql -U grandplus -d grandplus_db -c "\dt"
```

### 6. Connection string (for Node backend or app on same server)

```
postgresql://grandplus:YOUR_PASSWORD@127.0.0.1:5433/grandplus_db
```

If your app runs in Docker on the same host, use `host.docker.internal:5433` (Linux may need `extra_hosts`) or the host’s internal IP.

### 7. Optional: daily backups

```bash
chmod +x backup.sh
./backup.sh   # test once
crontab -e    # add: 0 2 * * * /home/YOUR_USER/postgres-grandplus/backup.sh >> /home/YOUR_USER/postgres-grandplus/backup.log 2>&1
```

## Replace Supabase later

1. Point your backend (e.g. `backend/` Node API or frontend env) at `DATABASE_URL=postgresql://...@127.0.0.1:5433/grandplus_db`.
2. Migrate existing data from Supabase (export/import or one-off script).
3. Deploy and test; then stop using Supabase.

## Remove this stack

```bash
docker compose down
# Optionally: docker volume rm postgres-grandplus_pg_data_grandplus
```
