#!/usr/bin/env bash
# Restore an encrypted backup made by backup.sh.
#   BACKUP_PASSPHRASE=... deploy/restore.sh <file.dump.gpg> <target DB_URL>
#   Set DB_CONTAINER to run pg_restore inside the Supabase db container (TARGET then e.g. postgresql://postgres:PW@localhost:5432/stint_restore_test).
# Restore into an EMPTY database. To test: createdb stint_restore_test, restore, check counts, dropdb.
# For a real disaster: restore into a fresh Supabase (whose auth/storage schemas already exist) with --clean.
#   Extra pg_restore flags can be passed in RESTORE_FLAGS (e.g. "--clean --if-exists").
set -euo pipefail
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
FILE=${1:?backup file}; TARGET=${2:?target database URL}
PREP="create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;"
# The dump holds public/auth/storage only; functions use pgcrypto from the extensions schema (already there on Supabase).
if [ -n "${DB_CONTAINER:-}" ]; then docker exec "$DB_CONTAINER" psql -q "$TARGET" -c "$PREP"; else psql -q "$TARGET" -c "$PREP"; fi
gpg --batch --quiet --decrypt --passphrase-fd 3 "$FILE" 3<<<"$BACKUP_PASSPHRASE" \
  | if [ -n "${DB_CONTAINER:-}" ]; then
      # run pg_restore inside the database container (same Postgres version); TARGET is as seen from inside it
      docker exec -i "$DB_CONTAINER" pg_restore --no-owner --no-privileges ${RESTORE_FLAGS:-} -d "$TARGET"
    else pg_restore --no-owner --no-privileges ${RESTORE_FLAGS:-} -d "$TARGET"; fi
echo "$(date -Iseconds) restore ok: $FILE → ${TARGET%%@*}@…"
