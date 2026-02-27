# GPC SelfDB schema (production setup)

## Database name (local and server)

Use **`gpc_selfdb`** everywhere. In both `~/Desktop/SELFDB-GPC/.env` and on the server `~/selfdb/.env` set:

```bash
POSTGRES_DB=gpc_selfdb
```

The deploy script (`./deploy-selfdb.sh`) forces this on the server after each sync so it always matches local.

---

## Where the schema lives

- **File:** `SELFDB-GPC/database/init/09_gpc_schema.sql`  
  (SELFDB-GPC is at `~/Desktop/SELFDB-GPC`.)

That script creates the GPC tables and registers them in SelfDB’s `tables` registry:

- `applications`
- `application_documents`
- `payments`
- `testimonials`
- `contact_submissions`

## When it runs

- **New DB (server or local):** When Postgres is first initialized, init scripts run in order (`00_` … `09_`). So a **fresh** server deploy or a **fresh** local DB will have these tables.
- **Existing DB:** Init scripts are **not** re-run. So if the server (or local) DB already exists, `09_gpc_schema.sql` has already run once. Changing the file only affects the **next** fresh DB (or you run the new SQL by hand).

## How to add a new table (best practice)

1. **Create the table on the server** (so production has it now):
   - Via API:  
     `curl -X POST "https://grandpluscollege.com/api/tables/" -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"name":"my_table",...}'`
   - Or via SelfDB admin UI (if you expose it or use SSH tunnel).

2. **Add the same table to the init script** (so future deploys and fresh DBs have it):
   - Open `~/Desktop/SELFDB-GPC/database/init/09_gpc_schema.sql`.
   - Add a `CREATE TABLE IF NOT EXISTS my_table (...);` block.
   - Add an `INSERT INTO tables (...)` for SelfDB registry (see existing ones in the file).
   - Save, then deploy:  
     `cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege && ./deploy-selfdb.sh`

3. **Optional:** Run the new SQL on the server once (if you don’t want to recreate the DB):  
   `ssh femi@46.225.232.77 'docker exec -i $(docker ps -q -f name=selfdb-db) psql -U postgres -d gpc_selfdb' < /path/to/new_table_only.sql`

## Deploy = code + schema

- `./deploy-selfdb.sh` syncs **all** of SELFDB-GPC (including `database/init/09_gpc_schema.sql`) to the server.
- So the **source of truth** for GPC schema is that file; production and local stay in sync when you use a fresh DB or run the same SQL.
