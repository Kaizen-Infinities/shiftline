# P2-03 — The inspector's registers

## Why

`docs/archive/handoff/2026-09-12-P1-17b-labour-code.md` and the Phase 1 completion note say the registers
a labour inspector asks for under the Labour Codes (muster roll, register of wages, overtime,
fines, deductions, advances) are not written. The data exists across attendance, payroll and
advances; each register is a report over what those modules already persisted.

## Scope

- Read-only module `apps/api/src/modules/registers/` (routes, service, validation, export
  helpers). Permission keys `registers.view` and `registers.export` in the existing payroll
  feature; owner and the auditor (the only seeded roles that read payroll today) hold them.
- `EmployeeFineDeduction`: a new tenant model for a dated fine (Payment of Wages Act s.8) or a
  deduction for damage/loss (s.10) — cause, amount and a persisted "shown cause given" flag.
  Not audited, matching its siblings `SalaryAdvance` and `EmployeePermanentDeduction`. Nothing
  in this package writes to it yet (out of scope: recording a fine/deduction is its own
  work item); the tests populate it directly, as the demo seed will once a source exists.
- `GET /api/registers/muster-roll?month=YYYY-MM` — one row per active employee, one column per
  day of the month (P/A/H/L/WO, plus OT hours per day) and totals.
- `GET /api/registers/wages?month=` — per employee: days worked, rate, basic, allowances, OT
  wages, gross, each deduction (PF, ESI, PT, fines, advances recovered, other), net, mode and
  payment date, read from the month's `PayrollResult` rows.
- `GET /api/registers/overtime?month=` — per OT day: hours, normal rate, double OT rate, OT
  wages, and the employee's cumulative OT hours for the quarter against the 125-hour cap
  (`labour.calc.ts`'s constants, read not modified).
- `GET /api/registers/fines?from&to` and `GET /api/registers/deductions?from&to` — the dated
  entries in range, plus a 3% ceiling check per employee per wage-period month for fines
  (breach is reported, never blocked).
- `GET /api/registers/advances?from&to` — from `SalaryAdvance`: date, amount, purpose,
  recovered to date, balance.
- `?format=csv` and `?format=pdf` on every register; CSV built in-module, PDF via the existing
  `generatePdfFromHtml` (puppeteer) helper already used by sales/purchase documents.
- Web `/hr/registers`: register selector, month or range filter, an optional business-place
  filter, the table, and Export CSV/PDF buttons; sidebar entry under Payroll; smoke coverage.

## Out of scope

Filing the registers anywhere, e-signature, state-specific formats beyond the central rules;
recording a fine, deduction or advance from this screen (advances already have a creator in the
payroll module; fines/deductions have none yet — a gap this package surfaces but does not close).
`businessPlaceId` filtering is accepted and validated but not yet applied: neither `Employee` nor
`AttendanceRecord` carries a business-place link in the schema today.

## Acceptance

- Each register returns the expected rows and totals from factory-created attendance, payroll
  results, fines/deductions and advances for the demo tenant.
- CSV export has a header row; PDF export renders.
- Month and date-range validation rejections return 400; a user without `registers.view` gets 403.
- A second tenant's employees never appear in any register (cross-tenant test, plus the
  route-sweep in `leak.spec.ts`).
