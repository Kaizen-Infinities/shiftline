#!/usr/bin/env bash
# Manual database backup: same format, naming and rotation as the daily job.
# Usage: scripts/backup.sh [database-url] [backup-dir]
# Env:   DATABASE_URL, BACKUP_DIR (default ./backups), BACKUP_KEEP_DAYS (default 30), PG_DUMP_PATH
set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"
DIR="${2:-${BACKUP_DIR:-./backups}}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
PG_DUMP="${PG_DUMP_PATH:-pg_dump}"

if [ -z "$DB_URL" ]; then
  echo "usage: scripts/backup.sh <database-url> [backup-dir]  (or set DATABASE_URL)" >&2
  exit 2
fi

mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$DIR/shiftline-$STAMP.dump"
START=$(date +%s)

# Tenant tables force row-level security: dump with the platform bypass flag.
PGOPTIONS='-c app.bypass_rls=on' "$PG_DUMP" --format=custom --no-owner --no-acl --enable-row-security --file "$FILE" "$DB_URL"

BYTES=$(stat -c %s "$FILE" 2>/dev/null || stat -f %z "$FILE")
SHA=$(sha256sum "$FILE" | cut -d' ' -f1)
echo "$SHA  $(basename "$FILE")" > "$FILE.sha256"

# Rotation: dumps (and their checksums) older than KEEP_DAYS.
find "$DIR" -maxdepth 1 -type f \( -name 'shiftline-*.dump' -o -name 'shiftline-*.dump.sha256' \) \
  -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/removed /' || true

echo "backup: $FILE ($BYTES bytes, sha256 $SHA, $(( $(date +%s) - START ))s)"
