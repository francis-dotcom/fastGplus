# Issues

| Issue | Description |
|-------|-------------|
| [SelfDB GUI: "Invalid username or password"](#selfdb-gui-invalid-username-or-password) | Login fails when using the GUI; cause and fix. |
| [Server GUI doesn't work](#server-gui-doesnt-work) | Tunnel or page/login issues when viewing production SelfDB. |

---

## Server GUI doesn't work

### Cause

- **Port conflict:** Local SelfDB and the SSH tunnel both use port 3000. If both are running, the browser may hit the local GUI instead of the server, or the tunnel may fail to bind.
- **Server stack not running:** The SelfDB frontend on the server must be up and listening on port 3000.
- **Admin not on server:** Login will fail if the admin user doesn’t exist (or isn’t ADMIN) in the **server** database.

### Fix

1. **Use a different port for the server tunnel** so it doesn’t clash with local:
   ```bash
   ssh -L localhost:3001:localhost:3000 femi@46.225.232.77
   ```
   Then open **http://localhost:3001** in your browser (this is the **server** GUI).

2. **Check the server stack is running:**
   ```bash
   ssh femi@46.225.232.77 'cd ~/selfdb && docker compose -f docker-compose-production.yml ps'
   ```
   If the frontend isn’t up, from project root run: `./deploy-selfdb.sh`.

3. **Create admin on the server** (from project root, once):
   ```bash
   cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
   SELFDB_API_URL=https://grandpluscollege.com/api ./scripts/selfdb-create-admin.sh
   ADMIN_EMAIL=$(grep -E '^ADMIN_EMAIL=' ~/Desktop/SELFDB-GPC/.env | cut -d= -f2-)
   ssh femi@46.225.232.77 "cd ~/selfdb && docker exec \$(docker ps -qf 'name=db-1' | head -1) psql -U postgres -d gpc_selfdb -c \"UPDATE users SET role = 'ADMIN', is_active = true WHERE email = '$ADMIN_EMAIL';\""
   ```
   Then log in at http://localhost:3001 with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `SELFDB-GPC/.env`.

---

## SelfDB GUI: "Invalid username or password"

### What was going wrong

You have **two** SelfDB setups:

- **Local** – on your Mac (database in Docker).
- **Server** – on Hetzner (production database).

Both can show a login screen at **http://localhost:3000** in the browser, depending on whether an SSH tunnel is running.

**When the SSH tunnel is ON** (e.g. you ran `ssh -L 3000:localhost:3000 femi@46.225.232.77`):

- The browser at `http://localhost:3000` is talking to the **server** GUI and server database.
- The scripts (`selfdb-create-admin.sh`, `selfdb-seed-admin.sh`) only created the admin user in the **local** database.
- So the **server** has no such user → "Invalid username or password".

**When the SSH tunnel is OFF**:

- `http://localhost:3000` shows the **local** GUI and talks to the local backend/database.
- The admin user exists there, so login with the right credentials works.

### Solution (use the local GUI)

To log in on your Mac using the local SelfDB:

1. **Stop the SSH tunnel**  
   In the terminal where `ssh -L 3000:localhost:3000 ...` is running, press **Ctrl+C** (or close that terminal).

2. **Start local SelfDB** (if not already running):
   ```bash
   cd ~/Desktop/SELFDB-GPC
   ./selfdb.sh start
   ```

3. **Create or fix the admin user** (from project root):
   ```bash
   cd /Users/stfrancis/Desktop/PROJECT/grandpluscollege
   SELFDB_API_URL=http://localhost:8000 ./scripts/selfdb-create-admin.sh
   ```

4. **Open the local GUI**
   - Use a **private/incognito** browser window.
   - Go to **http://localhost:3000** (with no SSH tunnel running).

5. **Log in**
   - **Email:** value of `ADMIN_EMAIL` in `~/Desktop/SELFDB-GPC/.env`
   - **Password:** value of `ADMIN_PASSWORD` in that same file  
   Type them exactly (no extra spaces).

### Summary

- **Tunnel ON** → `localhost:3000` = **server** GUI (admin must exist on server DB).
- **Tunnel OFF** + local stack running → `localhost:3000` = **local** GUI (admin created by scripts; use `.env` credentials).

To use the **local** dashboard and avoid the invalid-login issue, keep the tunnel **off** and follow the steps above.
