# Grand Plus College API (Node + Express + TypeScript)

Backend for Grand Plus College. Runs alongside the static site and Supabase.

## Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase URL and keys (or symlink/copy from project root .env)
npm install
```

## Scripts

| Command       | Description                    |
|--------------|--------------------------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/`   |
| `npm run start` | Run compiled app (after build)  |
| `npm run typecheck` | Type-check only               |

## Endpoints

- `GET /` — API info
- `GET /api/health` — Health check

Add new routes under `src/routes/` and mount them in `src/routes/index.ts`.

## Optional: use root .env

From project root you can run the backend with the main `.env`:

```bash
cd backend && npm run dev
```

Ensure `backend/.env` exists or that you load the root `.env` (e.g. `dotenv_config_path=../.env npm run dev`).
