# P0-10 — Worker, jobs, realtime rooms, retention (F5 part 1, PC8)

**Goal.** Move every scheduled task out of the web process into a Postgres-backed worker that
runs per tenant, make socket emits tenant-scoped by construction, and give tenants a retention
policy with a monthly sweep that can be dry-run.

**Worker.** `pg-boss` (schema `pgboss`, created on first start) via `lib/jobs.ts`
(`startJobs`, `getBoss`, `stopJobs`, `sendTenantJob`). Entrypoint `src/worker.ts`
(`npm run worker`, compose service `worker`); `EMBED_WORKER=true` runs the same handlers inside
the API process for single-process local runs (`make dev`). Queues are named `<area>.<job>` and
registered in `src/jobs/index.ts`; tenant queues use pg-boss's `stately` policy so one job per
singleton key can be queued and one active. Every job is idempotent: fan-outs and retries may
enqueue the same work twice. Schedules are pg-boss cron entries in `Asia/Kolkata`; `node-cron`
is removed and a lint rule refuses it.

| Queue                            | Schedule (IST)   | Work                                                        |
| -------------------------------- | ---------------- | ----------------------------------------------------------- |
| `inventory.eod-snapshot.fanout`  | 23:59 daily      | enqueue today's snapshot for every active tenant            |
| `inventory.eod-snapshot.catchup` | 06:30 daily      | enqueue the last three days per tenant (exists-check skips) |
| `inventory.eod-snapshot`         | per tenant       | `runEodStockSnapshot(date)` under `runAsTenant`             |
| `platform.retention.fanout`      | 02:00 on the 1st | enqueue a sweep per tenant; purge orphan login attempts     |
| `platform.retention.sweep`       | per tenant       | `retentionService.runSweep` under `runAsTenant`             |

**Realtime.** `initSocket` verifies the access token and joins the socket to exactly one room:
`tenant:<companyId>`, or `platform` for an admin token without a tenant (an admin may pick a
tenant with `auth.companyId`; tenant tokens cannot). `lib/realtime.ts` exports
`emitToTenant(event, payload, companyId?)`, which targets the current tenant's room (or the
given one, for jobs) and returns `false`, emitting nothing, when no tenant is in scope. The 152
former `getIO().emit(...)` sites were rewritten to `emitToTenant`; the `getIO` import is now a
lint error outside `lib/realtime.ts`. The frontend is unchanged: it already authenticates the
handshake and rooms are server-side.

**Retention.** `RetentionPolicy` (`companyId, dataClass, retentionDays, action, isActive`) and
`RetentionSweep` (one row per class per run, dry runs included), both tenant tables with RLS in
migration `20260906220131_retention_policies`. Data classes and floors live in
`modules/retention/retention.policy.ts`:

| Class                     | Floor      | Default         | Sweep today                                  |
| ------------------------- | ---------- | --------------- | -------------------------------------------- |
| BOOKS, FILINGS, PAYROLL   | 2,922 days | RETAIN          | report candidates only (archive with P1-03)  |
| AUDIT_LOGS, EOD_SNAPSHOTS | 2,922 days | RETAIN          | archive or purge if the tenant sets it       |
| SESSIONS                  | 30 days    | PURGE after 90  | expired or signed-out sessions of the tenant |
| LOGIN_ATTEMPTS            | 90 days    | PURGE after 365 | attempts by the tenant's users               |
| SYNC_TOMBSTONES           | 30 days    | PURGE after 30  | sync records and soft-deleted mobile rows    |

`ARCHIVE` writes gzipped NDJSON to `ARCHIVE_DIR/<companyId>/<class>/…` before deleting, in
batches of 1,000 rows, each batch one transaction. The two global tables (sessions, login
attempts) are scoped through `user.companyId`, which RLS filters as well; a bare
`user: { isNot: null }` compiles to a FK null check and must not be used. API under
`/api/retention` (`retention.view`/`retention.edit`): `GET /policies`, `PUT /policies/:dataClass`
(rejects days below the floor and archive/purge for report-only classes), `POST /sweeps`
(`dryRun` defaults to true; runs inline and returns per-class results), `GET /sweeps`.

**Tests.** `realtime.spec.ts` (handshake rejected without token; emits reach only the tenant's
sockets; explicit companyId from outside a request; no-tenant emit dropped; admin-only room
selection), `jobs.spec.ts` (queues created, singleton de-dup, EOD job end to end through
pg-boss, idempotent re-run, dry-run sweep writes 9 rows and touches nothing, purge removes only
this tenant's expired sessions, floors enforced), `retention.spec.ts` (API and permission).

**Done when.** Worker starts and registers the three schedules; 70 tests green; lint has zero
errors with the `getIO` rule at error; no `node-cron` in the lockfile.
