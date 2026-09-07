#!/usr/bin/env bash
# Restore a pg_dump custom-format backup into a database and verify it.
#
# Usage: scripts/restore.sh <dump-file> <target-database-url> [--drop]
#   --drop   drop and recreate the target database first (needs CREATEDB on the role)
#
# The target should be a fresh or disposable database: restoring over live data
# is how drills become incidents. After restoring, the script prints the latest
# applied migration and row counts for the books tables so the result can be
# compared with the source (see docs/runbooks/backup-restore.md).
set -euo pipefail

DUMP="${1:-}"
TARGET="${2:-}"
MODE="${3:-}"
PG_RESTORE="${PG_RESTORE_PATH:-pg_restore}"

if [ -z "$DUMP" ] || [ -z "$TARGET" ]; then
  echo "usage: scripts/restore.sh <dump-file> <target-database-url> [--drop]" >&2
  exit 2
fi
[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 2; }

if [ -f "$DUMP.sha256" ]; then
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null) \
    && echo "checksum ok" || { echo "checksum MISMATCH for $DUMP" >&2; exit 3; }
fi

DB_NAME="${TARGET##*/}"; DB_NAME="${DB_NAME%%\?*}"
ADMIN_URL="${TARGET%/*}/postgres"

if [ "$MODE" = "--drop" ]; then
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);"
fi
if ! psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\";"
fi

START=$(date +%s)
# --clean/--if-exists make a re-run onto a non-empty database idempotent. Rows go
# into tables that force row-level security, so the platform bypass flag is set.
export PGOPTIONS='-c app.bypass_rls=on'
"$PG_RESTORE" --no-owner --no-acl --enable-row-security --clean --if-exists --jobs=2 --dbname "$TARGET" "$DUMP"
ELAPSED=$(( $(date +%s) - START ))

echo "restored $DUMP into $DB_NAME in ${ELAPSED}s"
echo "latest migration: $(psql "$TARGET" -tAc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1")"
echo "row counts (all tenants, RLS bypassed):"
for t in companies users customers suppliers products vouchers journal_items sales_invoices grn_invoices payroll_runs audit_log; do
  n=$(psql "$TARGET" -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null | tr -d ' ')
  printf '  %-18s %s\n' "$t" "${n:-n/a}"
done
