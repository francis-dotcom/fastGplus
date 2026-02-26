# Grand Plus College – Flow on Hetzner

```
Hetzner VPS (single server)
│
├── Ubuntu (host OS)
│
├── Nginx (host or container)
│   ├── HTTPS :443 → grandpluscollege.com
│   │   ├── /           → /var/www/html/grandpluscollege  (static site)
│   │   ├── /support    → support.html (form → SelfDB API)
│   │   ├── /apply      → apply.html (form → SelfDB API)
│   │   ├── /fees       → fees.html (loads fees from Supabase)
│   │   └── /api/       → proxy_pass http://127.0.0.1:8000/  (SelfDB backend)
│   └── (SSL: Cloudflare or Let’s Encrypt)
│
├── Docker
│   │
│   ├── SelfDB stack (~/selfdb, docker-compose-production.yml)
│   │   ├── db (Postgres)          — internal only, port 5432
│   │   ├── pgbouncer              — internal only
│   │   ├── backend (FastAPI)      — host 127.0.0.1:8000  ← Nginx /api → here
│   │   ├── frontend (admin UI)    — host port e.g. 3000
│   │   ├── realtime               — internal only
│   │   ├── storage                — internal only
│   │   └── functions              — internal only
│   │
│   └── postgres-grandplus (optional second DB)
│       └── postgres_grandplus    — host 127.0.0.1:5433 only
│
├── Static site (no Docker)
│   └── /var/www/html/grandpluscollege
│       └── index.html, support.html, apply.html, fees.html, etc.
│
└── External
    ├── Supabase (cloud) — used by fees.html
    └── PayGate — payments
```

## Request flow

**Visitor opens https://grandpluscollege.com**
- Nginx serves files from `/var/www/html/grandpluscollege`.

**Visitor submits Support form**
- Browser → `https://grandpluscollege.com/api/tables/?search=contact_submissions...` (with `X-API-Key`).
- Nginx proxies `/api/` → `http://127.0.0.1:8000/` → SelfDB backend.
- Backend talks to Postgres (via PgBouncer) inside Docker.

**Visitor submits Apply form**
- Same as above: browser → `/api/...` → Nginx → SelfDB backend (port 8000) → Postgres.

**Visitor opens Fees**
- Browser loads fees from **Supabase** (cloud), not from this server.

## Summary

| Layer    | What runs there |
|----------|------------------|
| Hetzner  | One VPS (Ubuntu). |
| Ubuntu   | Nginx, Docker, static site files, optional postgres-grandplus. |
| Docker   | SelfDB stack (Postgres, backend :8000, admin UI, etc.) and optionally postgres-grandplus (:5433). |
| Nginx    | Serves site and proxies `/api/` to SelfDB backend. |
