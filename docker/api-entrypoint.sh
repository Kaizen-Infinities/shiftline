#!/bin/sh
set -e
# Run migrations only when asked (a one-shot job), never on every replica.
if [ "$RUN_MIGRATIONS" = "true" ]; then
  npx -w @shiftline/api prisma migrate deploy
fi
exec "$@"
