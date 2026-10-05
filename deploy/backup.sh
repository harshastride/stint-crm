#!/usr/bin/env bash
# Nightly encrypted database backup.
#   crontab -e  →  15 2 * * * /opt/stint-crm/deploy/backup.sh >> /var/log/stint-backup.log 2>&1
# Env (put in /etc/stint-backup.env, chmod 600, and `set -a; . /etc/stint-backup.env` in cron):
#   BACKUP_PASSPHRASE  required. Store it in Infisical (prod) AND somewhere offline. Lose it = lose the backups.
#   DB_URL             e.g. postgresql://postgres:PW@127.0.0.1:5432/postgres  (uses local pg_dump)
#   DB_CONTAINER       used instead of DB_URL if DB_URL is empty (default supabase-db; runs pg_dump inside it)
#   BACKUP_DIR         default /var/backups/stint-crm      KEEP_DAYS  default 14
#   RCLONE_REMOTE      optional, e.g. "b2:stint-backups" or "s3:bucket/stint" (configure with `rclone config`)
set -euo pipefail
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
DIR=${BACKUP_DIR:-/var/backups/stint-crm}
KEEP_DAYS=${KEEP_DAYS:-14}
DB_CONTAINER=${DB_CONTAINER:-supabase-db}
umask 077
mkdir -p "$DIR"
FILE="$DIR/stint-$(date +%Y%m%d-%H%M%S).dump.gpg"
ARGS=(--format=custom --compress=9 --no-owner --no-privileges --schema=public --schema=auth --schema=storage)

if [ -n "${DB_URL:-}" ]; then dump() { pg_dump "${ARGS[@]}" "$DB_URL"; }
else dump() { docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres "${ARGS[@]}"; }; fi

trap 'rm -f "$FILE"' ERR
dump | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$FILE" 3<<<"$BACKUP_PASSPHRASE"
[ -s "$FILE" ] || { echo "Backup is empty: $FILE"; exit 1; }

# 14-day rotation
find "$DIR" -name 'stint-*.dump.gpg' -mtime +"$KEEP_DAYS" -delete

# Off-server copy (optional)
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$FILE" "$RCLONE_REMOTE" --no-traverse
  rclone delete "$RCLONE_REMOTE" --min-age "${KEEP_DAYS}d" --include 'stint-*.dump.gpg' || true
fi
echo "$(date -Iseconds) backup ok: $FILE ($(du -h "$FILE" | cut -f1))${RCLONE_REMOTE:+ → $RCLONE_REMOTE}"
# Stored files (resumes, documents, recordings) live in the Supabase storage volume:
# also back up /opt/supabase/volumes/storage (e.g. rclone sync it to the same remote).
