# P2T-03 — The inspector's registers

## Shipped

A new read-only module, `apps/api/src/modules/statutory-registers/`, deriving six registers from
existing attendance and payroll data — nothing new is persisted:

- `GET /api/statutory-registers/muster-roll?period=YYYY-MM` — every active employee, every day of
  the month, status/OT/late/permission minutes, plus totals by status.
- `GET /api/statutory-registers/wages?runId=` — per employee, from that `PayrollRun`'s
  `PayrollResult` rows: days paid, gross, total deductions, net, payment mode.
- `GET /api/statutory-registers/overtime?runId=` — per employee, the days with `otHours > 0` in
  the run's period plus the run's own OT hours/pay (the Labour Code figure, since P2T-02).
- `GET /api/statutory-registers/deductions?runId=` — PF/ESI/PT/late/permission/advance/loan broken
  out, plus every active `EmployeePermanentDeduction` (any type) feeding that run's other
  deductions.
- `GET /api/statutory-registers/fines?from=&to=` — `EmployeePermanentDeduction` rows with
  `type: "FINE"`, a reporting convention on the existing free-form `type` column.
- `GET /api/statutory-registers/advances?from=&to=` — `SalaryAdvance` rows in range: disbursed,
  recovered, outstanding, status.

New permission `statutory-registers.view`/`.export` (module added to the `payroll` feature in
`packages/shared/src/features.ts`); OWNER gets it automatically, AUDITOR read-only — added to the
same view-only list `payroll`/`payroll-run` are already on in `provisioning.service.ts`'s
`ROLE_DEFS`. Web: `apps/web/src/modules/payroll/pages/StatutoryRegistersPage.tsx`, a six-tab screen
(period picker for the muster roll, period + payroll-run picker for wages/overtime/deductions,
a date range for fines/advances), routed at `/payroll/registers`, in the sidebar under Payroll and
under Accounts (matching where "Leave & Entitlements" already sits in both), and in
`e2e/smoke.spec.ts`.

No schema change: nothing here is separately maintained, so there was nothing to migrate.

## Tests

`apps/api/test/integration/statutory-registers.spec.ts` (7 tests): one golden dataset (a July 2033
employee with a hand-verified attendance pattern — 27 present, 2 absent, 2 half days, 6 OT hours
across 3 days — and a matching payroll run with a salary advance, a loan EMI and two other
permanent deductions, one of them a fine) proves the muster roll, wages, overtime and deductions
registers exactly; the fines and advances registers get their date-range behaviour proved
separately (in range / out of range). Plus a permission refusal and cross-tenant isolation test.
Full suite: 79 files, 498 tests, green. Typecheck (api, api's test project, web, shared), lint (0
errors, same 510 pre-existing warnings), prettier and `e2e:typecheck` all clean.

## Verified on the running stack

Ran `apps/api` and `apps/web` locally against a seeded dev database (migrations + `db:seed`) and
drove the new screen with a headless browser as `demo.owner`: muster roll renders the seeded
employees with a period picker; wages/overtime/deductions correctly show "no runs this period" when
none exists yet, without erroring; fines renders its empty state and the date-range controls work.
Screenshots taken; the dev `.env` files created for this are gitignored and were not committed.

## Half-done / known gaps

- **Fines has no date field to report by.** `EmployeePermanentDeduction` was not built with a
  fines register in mind — no incident date, no "date fined" separate from "date recorded". The
  register reports by `createdAt` and `isActive`, documented in the service's own comment. A
  fines-specific data model (incident date, imposed date, remitted-to-welfare-fund date) is a
  follow-up if the owner needs it to be more than "what's currently deducted."
- **Deductions/overtime/wages depend on a `PayrollRun` existing.** There is no register-level
  fallback if payroll for a period was never run — by design, since the register reads what
  payroll actually paid, not a recomputation.
- The web screen's run-picker shows every run for a period regardless of status (DRAFT included);
  an inspector's register arguably should only ever point at an APPROVED/LOCKED run, but the
  brief did not ask for that gate and the underlying data is identical either way.

## Next

Phase 2-T is complete (packages 1–4). Phase 2 (the shop floor) begins from
`docs/handoff/2026-09-13-commission-phase-2.md`.

## Blocked on you

Nothing new.

## Changelog

Muster roll, wages, overtime, deductions, fines and advances registers are now available under
Payroll → Statutory Registers, generated on demand from attendance and payroll data.
