#!/usr/bin/env bash
# Nightly database backup (go-live 5.1). Keeps 14 days locally; copy the folder off the server too (rclone to Google Drive / S3).
# crontab -e →  15 2 * * * /opt/stint-crm/deploy/backup.sh >> /var/log/stint-backup.log 2>&1
set -euo pipefail
DIR=${BACKUP_DIR:-/var/backups/stint-crm}
KEEP_DAYS=${KEEP_DAYS:-14}
DB_CONTAINER=${DB_CONTAINER:-supabase-db}
mkdir -p "$DIR"
FILE="$DIR/stint-$(date +%Y%m%d-%H%M).sql.gz"
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres --no-owner --schema=public --schema=auth --schema=storage | gzip > "$FILE"
[ -s "$FILE" ] || { echo "Backup is empty: $FILE"; exit 1; }
find "$DIR" -name 'stint-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
# Stored files (resumes, documents, recordings) live in the Supabase storage volume: back up volumes/storage as well.
