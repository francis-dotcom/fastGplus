# Deploy SelfDB for Grand Plus College

Follow these steps so the site’s **support form** and **apply form** use SelfDB on Hetzner instead of Supabase.

---

## 1. Deploy the SelfDB stack on Hetzner

**SelfDB source folder:** `/Users/stfrancis/Desktop/SELFDB-V0.0.5.4`  
The GPC schema (`applications`, `contact_submissions`, etc.) is already in that folder as `database/init/09_gpc_schema.sql`.

**On your Mac:**

```bash
# Copy SelfDB to the server (use a directory next to the site, e.g. selfdb)
rsync -avz --exclude='.git' --exclude='node_modules' \
  /Users/stfrancis/Desktop/SELFDB-V0.0.5.4/ \
  femi@46.225.232.77:~/selfdb/
```

**On the server (SSH in):**

```bash
cd ~/selfdb
cp .env.example .env   # or create .env from your template
nano .env              # set POSTGRES_*, ADMIN_*, API_KEY, BACKEND_PORT (e.g. 8000), CORS_ORIGINS, etc.
docker compose -f docker-compose-production.yml up -d
docker compose -f docker-compose-production.yml ps
```

Check the backend health (replace `8000` if you use another `BACKEND_PORT`):

```bash
curl -s -H "X-API-Key: YOUR_API_KEY" http://localhost:8000/health
```

---

## 2. Expose the SelfDB API (Nginx proxy)

So the browser can call the API at `https://grandpluscollege.com/api`, proxy that path to the backend.

**On the server**, edit the Nginx config for `grandpluscollege.com` (e.g. `/etc/nginx/sites-available/grandpluscollege` or inside `sites-enabled`). Add a `location` for `/api`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8000/;   # use your BACKEND_PORT
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Test from your Mac:

```bash
curl -s -H "X-API-Key: YOUR_API_KEY" https://grandpluscollege.com/api/health
```

---

## 3. Set SelfDB URL and API key in `.env`

In the **grandpluscollege** project folder on your Mac, edit `.env` and set (uncomment if needed):

```env
SELFDB_API_URL=https://grandpluscollege.com/api
SELFDB_API_KEY=<same API_KEY as in SelfDB backend .env>
```

Use the same `API_KEY` value that is in `~/selfdb/.env` on the server.

---

## 4. Deploy the site so it gets the SelfDB config

From the **grandpluscollege** project folder:

```bash
./deploy-site.sh
```

This injects `SELFDB_API_URL` and `SELFDB_API_KEY` into `support.html` and `apply.html` and rsyncs the site to the server.

---

## Summary

| Step | What |
|------|------|
| 1 | Deploy SelfDB from `SELFDB-V0.0.5.4` to Hetzner (`~/selfdb`), run with Docker Compose, GPC schema in `database/init/09_gpc_schema.sql`. |
| 2 | Nginx: `location /api/` → `proxy_pass http://127.0.0.1:BACKEND_PORT/`. |
| 3 | In grandpluscollege `.env`: `SELFDB_API_URL`, `SELFDB_API_KEY`. |
| 4 | Run `./deploy-site.sh`. |

**Note:** `fees.html` still uses Supabase for the fees table. `status.html` only uses URL params. To move fees to SelfDB later, add a `fees` table (and its registry row) and point `fees.html` at the SelfDB API like support/apply.
