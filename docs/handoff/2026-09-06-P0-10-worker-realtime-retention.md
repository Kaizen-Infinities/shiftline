# P0-10 — Worker, jobs, realtime rooms, retention

## Shipped

- pg-boss worker (`src/worker.ts`, `npm run worker`, compose service `worker`;
  `EMBED_WORKER=true` for single-process runs). Queues and schedules in `src/jobs/`; the
  EOD stock snapshot is now a per-tenant job with a 23:59 IST fan-out and a 06:30 catch-up,
  idempotent by an exists-check. `node-cron` removed; a lint rule refuses it.
- Socket rooms: every socket joins `tenant:<companyId>` (or `platform` for admins).
  `lib/realtime.ts` `emitToTenant()` replaces all 152 `getIO().emit()` calls; emits with no
  tenant in scope are dropped. The `getIO` import is a lint error outside `lib/realtime.ts`.
- Retention: `RetentionPolicy` and `RetentionSweep` models (migration
  `20260906220131_retention_policies`, RLS included), statutory floors (8 years for books,
  filings, payroll, audit logs, stock snapshots), monthly per-tenant sweep with dry run,
  gzipped NDJSON archive before purge, API under `/api/retention` with the new `retention`
  permission module.
- Tests: `realtime.spec.ts`, `jobs.spec.ts`, `retention.spec.ts`; 70 tests green.

## Half-done / known gaps

- Archive/purge of BOOKS, FILINGS and PAYROLL is report-only until the account export
  (P1-03) provides the archive format; the API refuses to set those classes to anything but
  RETAIN so a policy is always executable.
- No retention screen yet; the API is complete and the admin console (P1-02) or company
  settings will host it.
- Worker health is only visible in logs until pino and `/ready` land in P0-13.
- The manual `POST /api/inventory/eod-snapshot/run-now` still runs inline in the API process
  (unchanged behaviour); it could enqueue instead once the worker is always on.

## Next

- P0-11: mobile module behind tenancy (A1), sync conflict rules and tombstones (A2), position
  feed (A5), simulated roster removed.

## Blocked on you

- Branch protection and the approver handle (since P0-00).
