#!/usr/bin/env bash
# Sync SelfDB server backups to Mac.
# Rsyncs ~/selfdb/backups/ on the server to ~/Desktop/selfdb-backups/ on your Mac.
# Run manually or via cron (see MD/action.md).
set -e

SERVER="femi@46.225.232.77"
REMOTE_DIR="~/selfdb/backups/"
LOCAL_DIR="$HOME/Desktop/selfdb-backups/"

mkdir -p "$LOCAL_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Syncing server backups to $LOCAL_DIR ..."
rsync -avz --progress "$SERVER:$REMOTE_DIR" "$LOCAL_DIR"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done. Backups saved to $LOCAL_DIR"
