# P0-12 — Playwright smoke suite and CI e2e job

## Shipped

- `e2e/` suite: login through the real form, twelve screens (dashboard, users, roles,
  employees, products, raw materials, machines, production orders, sales orders, sales
  invoices, company settings, profile) plus a wrong-password check; fails on any API 5xx or
  uncaught page error. 14 browser tests green locally.
- CI job `e2e`: postgres service, migrate + seed, web build against the local API, Playwright
  Chromium, typecheck of the suite, HTML report and traces uploaded on failure. `make e2e` and
  `npm run e2e` locally.
- Fix found by the suite: `/employees/me` returns a minimal profile for users without an HR
  record instead of a 404 (integration test added).

## Half-done / known gaps

- The suite checks that screens render and their data calls succeed; it does not yet drive a
  business flow (create a sales order, post a receipt). Flow tests belong with the finance
  packages that own them (P1-08 onwards).
- Company settings loads the Indian states list from an external service; offline it logs a
  console error and the form still renders. It should come from the state-code master in P1-08.
- A development database created before the migration history (`prisma db push` era) has no
  `company_id` columns and fails login with a 500; run `make reset` (or point `DATABASE_URL` at
  a fresh database, as this session did with `shiftline_e2e`) before `make e2e`.

## Next

- P0-13: pino + request id, `/health` and `/ready`, Sentry hook, daily `pg_dump` backup job and
  restore drill, 15-minute access token + rotating refresh cookie, append-only audit log
  extension, `npm audit` gate, ASVS checklist.

## Blocked on you

- Branch protection and the approver handle (since P0-00).
- Anthropic API key for cheque OCR, or the decision to drop OCR (P0-11).
