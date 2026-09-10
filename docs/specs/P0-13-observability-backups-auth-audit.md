# P0-13 — Observability, backups, audit trail base, auth hardening (F4 part 2, F5 part 2)

**Goal.** Make the platform operable and defensible before Phase 1 adds money: every request
traceable, liveness and readiness observable, the books backed up and restorable, the audit
trail impossible to switch off, and sessions short-lived with rotating refresh.

## Logging and request ids

`lib/logger.ts` is one pino logger (pretty in development, JSON otherwise, silent in tests) with
a redaction list for auth headers, cookies, passwords and tokens. `lib/request-context.ts`
mints or honours `x-request-id`, echoes it on every response and carries it through
`AsyncLocalStorage`; the logger mixin adds `requestId`, `companyId` and `userId` to every line,
`pino-http` logs each request once, and error bodies carry `requestId`. The 132 `console.*`
calls in the API were rewritten to `logger.<level>({ err, … }, "message")`; `no-console` is now an
error for the API (seeds, scripts and e2e excepted). Jobs run under a synthetic request id and
log completion or failure.

## Health, readiness, Sentry

`GET /health` answers without touching the database. `GET /ready` checks the database, that the
newest migration folder is applied, and reports worker liveness from the `platform.heartbeat`
queue (a one-minute pg-boss schedule); readiness fails only on db/migrations. `lib/sentry.ts`
initialises `@sentry/node` when `SENTRY_DSN` is set; 5xx errors and failed jobs are captured
with request id and tenant, never with bodies or headers.

## Backups (MCA Rule 3(5))

`platform.backup.daily` (01:30 IST) runs `pg_dump --format=custom --no-owner --no-acl
--enable-row-security` with `PGOPTIONS='-c app.bypass_rls=on'` into `BACKUP_DIR`, records sha256,
size and duration in `backup_runs`, and removes dumps older than `BACKUP_KEEP_DAYS`.
`scripts/backup.sh` and `scripts/restore.sh` do the same by hand; `GET/POST /api/platform/backups`
serve platform admins. The API image installs `postgresql-client-16` from PGDG. Drill: 0.3 s
dump, 2.2 s restore, identical counts (`docs/runbooks/backup-restore.md`).

## Auth: 15-minute access token, rotating refresh cookie

Access tokens expire in 15 minutes and carry a `jti`. Login sets `shiftline_rt` (httpOnly,
Secure, SameSite, `Path=/api/auth`) whose value is a 256-bit secret stored only as a sha256 hash
in `user_sessions.sessionToken`. `POST /api/auth/refresh` rotates it (new hash, previous hash
kept in `prevTokenHash`, `rotatedAt`), re-reads role and permissions, and extends the session
(sliding `REFRESH_TOKEN_TTL_DAYS`, absolute 30 days from login). Replaying a rotated-away token
inside `REFRESH_REUSE_GRACE_MS` (10 s) is treated as a concurrent tab; beyond it the whole session
is revoked and logged. Logout clears the cookie and ends the session. Native clients that send
`x-device-id` receive the refresh token in the response body instead (device-bound tokens come
with P1-02). The web app keeps the access token in memory only: a page load exchanges the cookie,
axios and RTK Query refresh once on 401 and retry, and a timer renews a minute before expiry.

## Append-only audit trail (MCA Rule 3(1))

`scripts/gen-audit-migration.ts` generates migration `20260906235000_audit_trail`: a
`SECURITY DEFINER` trigger `audit_row()` on 28 books, document, payroll and master tables writes
`audit_log` rows (old/new JSON minus secrets, actor, admin, request id, impersonator, tenant)
inside the same transaction as the change; `audit_log_immutable` rejects UPDATE and DELETE unless
the retention sweep sets `app.retention_sweep` in its transaction; UPDATE/DELETE are revoked from
`shiftline_app`; an `audit_append` policy lets triggers insert under RLS while reads stay
tenant-scoped. `lib/prisma.ts` now sets every transaction-local variable in one statement
(`app.company_id`, `app.bypass_rls`, `app.user_id`, `app.admin_id`, `app.actor_type`,
`app.request_id`, `app.impersonated_by`), including for global tables when an actor is known.

## Dependency gate and security docs

`scripts/audit-gate.mjs` runs `npm audit --omit=dev` in the static CI job and fails on high or
critical advisories unless `scripts/audit-allowlist.json` names them with a reason and expiry
(two accepted today: deepmerge-ts via the Prisma CLI, uuid via imagekit).
`docs/security/asvs-l2-checklist.md` and `docs/security/pentest-scope.md` are the Gate 0
security deliverables.

## Tests

`health.spec.ts` (health, ready, request ids), `backup.spec.ts` (dump, rotation, failure record,
admin-only history), `refresh.spec.ts` (15-minute token, rotation, reuse revocation, grace,
logout, device body token), `audit-trail.spec.ts` (create/update rows with actor and request id,
system actor, append-only guard, sweep path, no password hashes). 101 API tests, 14 browser
tests (login now also survives a reload through the cookie).

## Done when

Logs carry request ids end to end; `/ready` green on compose; backup job scheduled and the
drill recorded; refresh flow green in API and browser tests; audit trail covers the books and
cannot be edited; audit gate in CI; ASVS checklist and pentest scope committed.
