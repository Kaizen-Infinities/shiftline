# Backup and restore

Books of account must be backed up daily and be restorable (Companies Act, Accounts Rules,
Rule 3(5)). Shiftline does this with a pg-boss job; the same code runs by hand.

## What runs

| Piece                    | Where                                                                       | Notes                                                                                  |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Daily job                | `platform.backup.daily`, 01:30 IST                                          | `apps/api/src/jobs/backup.job.ts`; runs before the monthly retention sweep (02:00)     |
| Dump format              | `pg_dump --format=custom --no-owner --no-acl`                               | Compressed, restorable table by table under any role                                   |
| Row-level security       | `PGOPTIONS='-c app.bypass_rls=on'` + `--enable-row-security`                | Every tenant table forces RLS; without the flag pg_dump fails, restore rejects rows    |
| Destination and rotation | `BACKUP_DIR` (default `./backups`), `BACKUP_KEEP_DAYS` (30)                 | Compose mounts `./backups` into the worker; dumps older than the window are removed    |
| Record                   | `backup_runs` table                                                         | One row per attempt: file, bytes, sha256, duration, error; `GET /api/platform/backups` |
| Manual backup            | `make backup` / `scripts/backup.sh <url> [dir]`                             | Same naming; writes a `.sha256` next to the dump                                       |
| Restore                  | `make restore DUMP=… TARGET=…` / `scripts/restore.sh <dump> <url> [--drop]` | Verifies the checksum, restores, prints migration and counts                           |
| Trigger by hand          | `POST /api/platform/backups/run` (platform admin)                           | Queued when a worker is embedded, otherwise runs inline                                |

`pg_dump` must be at least the server's major version. The API image installs
`postgresql-client-16` from PGDG; locally install the same (`postgresql-client-16`).

## Restore drill (2026-09-06)

Source: the seeded demo tenant (`shiftline_e2e`, 96 tables, 5 users, 5 customers, 5 products,
1 route). Host: the development sandbox, PostgreSQL 16.13.

| Step                                          | Result                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `scripts/backup.sh` (custom format)           | 564,050 bytes, sha256 recorded, **0.3 s**                                           |
| `scripts/restore.sh … --drop` into a fresh DB | **2.2 s**, 0 errors, 236 foreign keys, RLS forced                                   |
| Row counts source vs restored                 | identical (companies 1, users 5, customers 5, suppliers 3, products 5, audit_log 5) |
| Latest migration in the restored copy         | matches the source                                                                  |

Two findings from the drill are now baked into the scripts: the bypass flag must be set for
both dump and restore, and `pg_restore` needs `--enable-row-security` or foreign-key validation
fails on forced-RLS tables (306 ignored errors on the first attempt, none after).

Re-run the drill after any migration that changes RLS or adds a schema, and at least quarterly;
record the timings here.

## Restore procedure (production, when hosting arrives)

1. Stop the API and worker (`docker compose stop api worker`).
2. Pick the dump: `ls -la backups/`; check `sha256sum -c <file>.sha256`.
3. Restore into a **new** database name, never over the live one:
   `scripts/restore.sh backups/<file>.dump postgresql://…/shiftline_restored --drop`.
4. Compare the printed counts with the last known good numbers; open a psql session and
   spot-check a voucher and a payroll run.
5. Point `DATABASE_URL` at the restored database, run `prisma migrate deploy` (no-op when the
   dump is current), start the API and worker, check `/ready`.
6. Keep the previous database until the accountant confirms the books.

## Off-site copies

Local only for now (the user chose not to host yet). When hosting arrives, the job gains an
upload step (object storage with versioning and a 35-day lifecycle) and the restore drill is
repeated from the remote copy.
