# P0-03 — Docker compose, images, anonymised seed

**Goal.** One command brings up PostgreSQL; a second seeds a realistic demo tenant.
The same Dockerfiles run in CI.

**Deliverables.** `docker-compose.yml` (postgres always; api/web under `--profile full`),
`docker/postgres/init.sql` (roles `shiftline_app` NOBYPASSRLS and `shiftline_migrator`,
`shiftline_test` database), `apps/api/Dockerfile` (dev/build/runtime; Chromium for puppeteer;
migrations only when `RUN_MIGRATIONS=true`), `apps/web/Dockerfile` (Vite → nginx SPA),
`Makefile`, `apps/api/prisma/seed.ts` (idempotent; company, business places, 5 roles from
the registry, 5 users, departments, shifts, UoMs, categories, stores, raw materials,
products with BOM, machines, customer types/grades, customers, suppliers, FY period and
invoice numbering; system ledgers via `ensureSystemLedgersExist`), runbooks
`local-run.md` and `data-handling.md`, `scripts/anonymise-dump.sql`.

**Not in this package.** Transactional documents (orders, invoices, payments) — the P0-04
factories create those through the services so ledgers post correctly.

**Done when.** Seed runs twice without error against an empty database; the API boots
against it and the P0-02 probes pass (verified in this session, see hand-off).
