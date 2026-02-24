## Bash script plan for deploying SelfDB to any server

This document describes the **bare deployment plan** (no code) for a local bash script that deploys the SelfDB stack to a remote production server.

For now: **ignore SSL certificates** (assume HTTP on port 80).

---

## Design goal

**So easy a 9-year-old can deploy SelfDB to production.**

---

## How to run (single command)

```bash
./deploy.sh
```

No flags required — an **interactive wizard** guides the user through every input.  
Power users can skip prompts with flags: `./deploy.sh --host 1.2.3.4 --user root --key ~/.ssh/id_rsa --yes`

---

## Requirements (inputs)

Collected via wizard prompts (or CLI flags):

| Input | Prompt | Default |
|-------|--------|---------|
| Server host | `Server IP or hostname:` | *(required)* |
| Username | `SSH username:` | `root` |
| Auth | `Path to SSH key (Enter for password):` | auto-detect `~/.ssh/id_rsa` or `~/.ssh/id_ed25519` |
| SSH port | *(only asked if connection fails)* | `22` |

---

## Constraints / guarantees

- **Auto-detect mode**: Script checks if SelfDB is already deployed → chooses `init` or `redeploy` automatically.
- If deployment **fails for any reason**, do **not** stop running containers.
- UX looks like a **GitHub Actions runner log**, but runs 100% locally.
- Supports `--dry-run` flag to preview actions without executing.

---

## Target Linux distributions

- Ubuntu (20.04+) or Debian-based distros recommended.
- Script may work on other distros but is not tested.

---

## Production architecture

```
Internet (port 80)
       │
       ▼
   ┌───────┐
   │ Caddy │  ← Reverse proxy (single entry point)
   └───┬───┘
       │
   ┌───┴────────────────┐
   │                    │
   ▼                    ▼
┌──────────┐      ┌─────────┐
│ Frontend │      │ Backend │
│  :80     │      │  :8000  │
└──────────┘      └─────────┘
       (internal Docker network)
```

**Key differences from local dev:**

| | Local (`docker-compose.yml`) | Production (`docker-compose-production.yml`) |
|---|---|---|
| Entry point | Frontend `:3000`, Backend `:8000` | Caddy `:80` only |
| Routing | Direct port access | Caddy routes `/api/*` → backend, `/` → frontend |
| SSL | None | Ready for future (port 443 reserved) |

---

## Recommended remote layout

### Application directory

| Path | Purpose |
|------|---------|
| `/home/<user>/Desktop/SelfDB/` | Main app folder (single folder, reused every deploy) |
| `/home/<user>/Desktop/SelfDB/backups/` | Database backups (bind-mounted `./backups` in compose) |
| `/home/<user>/Desktop/SelfDB/logs/` | Deploy logs |

### Persistent data (Docker named volumes)

Managed by Docker Compose — no manual paths needed:

| Volume name | What it stores |
|-------------|----------------|
| `postgres_data` | PostgreSQL database files |
| `storage_data` | Uploaded files (blob storage) |
| `functions_data` | User function code |

> **Why this layout?**  
> - Everything lives under `~/Desktop/SelfDB/` — easy to find.  
> - Backups are in a bind-mounted folder so `backup_now.sh` and `restore_from_backup.sh` work unchanged.  
> - Docker volumes persist across redeploys automatically.

---

## Common flow (both modes)

### 1. Local checks

- Confirm script is run from SelfDB repo root (look for `docker-compose.yml` and `selfdb.sh`).
- Confirm local tools exist: `ssh`, `rsync`, `tar`.

### 2. Pre-run checklist (shown to user)

```
✅ Local: SelfDB repo detected
✅ Local: ssh, tar, rsync installed
🔜 Remote: Connect to root@192.168.1.50
🔜 Remote: Install Docker (if needed)
🔜 Remote: Configure firewall (ports 22, 80, 443)
🔜 Remote: Deploy to /home/root/Desktop/SelfDB

Continue? (y/n)
```

### 3. Remote checks

- Verify SSH connectivity.
- Check permissions and disk space.
- Detect if Docker + Compose are installed.
- Detect if SelfDB folder exists → auto-select `init` or `redeploy`.

### 4. Package & upload

- Create compressed package of the repo (`.tar.gz`).
- Exclude junk: `.git/`, `node_modules/`, `__pycache__/`, build outputs.
- Upload via `rsync` (fastest method):
  - Disable SSH compression (tarball already compressed)
  - Use fast cipher (`aes128-gcm@openssh.com`)
  - Show progress bar
  - Delta sync on redeploy (only changed bytes transferred)

### 5. Extract & activate

- Extract (overwrite) into `/home/<user>/Desktop/SelfDB/`.
- Same folder every time so Docker volumes are reused.

### 6. Run the stack

- `cd /home/<user>/Desktop/SelfDB`
- Run with production compose: `docker compose -f docker-compose-production.yml up -d`
- Caddy starts as reverse proxy on port 80
- Stream logs to local terminal and save a copy to `logs/`.

### 7. Post-checks

- Verify containers are running.
- Verify port 80 is reachable.
- Print success summary.

---

## Mode details

### Mode: init (first-time deploy)

Auto-selected when `/home/<user>/Desktop/SelfDB/` does not exist.

1. **Install Docker** (if missing)
   - Docker Engine + Compose plugin

2. **Configure firewall (UFW)**
   - Allow SSH **first** (avoid lockout!)
   - Allow: `22/tcp`, `80/tcp`, `443/tcp`
   - Deny everything else

3. **Create directories**
   - `/home/<user>/Desktop/SelfDB/`
   - `/home/<user>/Desktop/SelfDB/logs/`

### Mode: redeploy (update existing)

Auto-selected when `/home/<user>/Desktop/SelfDB/` already exists.

- Skip Docker install and firewall setup.
- Upload new code, extract, run `./selfdb.sh`.
- Docker volumes persist — no data loss.

---

## Failure behavior

On failure at any step:

1. **Stop** the deployment workflow immediately.
2. **Print** what failed + **why** + **how to fix**.
3. **Print** where logs are stored.
4. **Never** stop or remove running containers.

### Example error output

```
❌ [2/6] SSH connection failed

Reason: Permission denied (publickey)

How to fix:
  1. Check your SSH key path is correct
  2. Make sure the key is in the server's ~/.ssh/authorized_keys
  3. Try: ssh-copy-id root@192.168.1.50

Your running containers are safe — nothing was changed.
```

---

## Failure recovery

If a previous deploy failed mid-way, detect it and offer options:

```
⚠️ Previous deploy didn't finish cleanly.

Options:
  1. Retry from where it stopped
  2. Start fresh (keeps your data safe)
  3. Cancel

Choose (1/2/3):
```

---

## UI / DX (runner output)

Each step prints a numbered status line:

```
[1/6] Checking local requirements ........... PASS
[2/6] Connecting to server .................. PASS
[3/6] Installing Docker ..................... SKIP (already installed)
[4/6] Uploading SelfDB (24 MB) .............. PASS
[5/6] Starting stack ........................ PASS
[6/6] Health checks ......................... PASS
```

---

## Post-deploy summary

```
✅ SelfDB is live!

🌐 Open in browser:  http://192.168.1.50
📊 View logs:        ssh root@192.168.1.50 "cd ~/Desktop/SelfDB && ./selfdb.sh logs"
🔄 Redeploy:         ./deploy.sh (just run again)
💾 Backups at:       ~/Desktop/SelfDB/backups/
🛠️ Manual control:   ssh root@192.168.1.50 "cd ~/Desktop/SelfDB && ./selfdb.sh"

Need help? https://github.com/selfdb/selfdb
```

---

## CLI flags (for power users)

| Flag | Description |
|------|-------------|
| `--host <ip>` | Server IP or hostname |
| `--user <name>` | SSH username (default: `root`) |
| `--key <path>` | Path to SSH private key |
| `--password` | Use password auth instead of key |
| `--port <num>` | SSH port (default: `22`) |
| `--yes` | Skip confirmation prompts |
| `--dry-run` | Show what would happen without doing it |
| `--help` | Show help |

---

## Glossary (plain language)

| Term in docs | What it means |
|--------------|---------------|
| SSH | Secure way to connect to your server remotely |
| Firewall | Controls which network ports are open |
| Docker | Runs SelfDB in isolated containers |
| Volume | Where Docker saves data that survives restarts |
| Bind-mount | A folder shared between your server and Docker |
| Caddy | Reverse proxy that routes web traffic to the right service |
| Reverse proxy | A server that sits in front of other servers and forwards requests |
