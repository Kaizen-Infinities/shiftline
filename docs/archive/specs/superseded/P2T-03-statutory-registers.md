# P2T-03 — The inspector's registers

## Why

The Factories Act and the Labour Codes require six registers an inspector can ask to see: the
muster roll, the wages register, the overtime register, the register of fines, the register of
deductions and the register of advances. The Phase 1 completion note: "the data exists; each is a
report" — none of it needs a new table, only a query.

## Scope

A new read-only module, `apps/api/src/modules/statutory-registers/`, deriving every register from
data that already exists and is never separately maintained:

- **Muster roll** (`?period=YYYY-MM`): per active employee, per day, the `AttendanceRecord` status,
  OT hours, late and permission minutes, plus the month's totals by status.
- **Wages register** (`?runId=`): per employee, from that `PayrollRun`'s `PayrollResult` rows —
  days paid, gross, every deduction, net, payment mode.
- **Overtime register** (`?runId=`): per employee, the days with `otHours > 0` in the run's period
  (from `AttendanceRecord`) alongside the run's own `otHours`/`otPay` total (now the Labour Code
  figure, since P2T-02).
- **Deductions register** (`?runId=`): per employee, PF/ESI/PT/late/permission/advance/loan broken
  out, plus every active `EmployeePermanentDeduction` line (any type) that fed that run's "other
  deductions" figure.
- **Fines register** (`?from=&to=`): `EmployeePermanentDeduction` rows with `type: "FINE"` —
  a reporting convention on the existing free-form `type` column, not a new one. There is no
  fine-specific date field in the data model, so this reports by `createdAt`/`isActive`, documented
  as a limitation rather than pretended otherwise.
- **Advances register** (`?from=&to=`): `SalaryAdvance` rows in the range — disbursed, recovered,
  outstanding, status.

Permission key `statutory-registers.view`/`.export` (new module, `payroll` feature, same as every
other payroll screen); OWNER gets it automatically, AUDITOR read-only, matching how `payroll`/
`payroll-run` are already granted.

## Out of scope

A dedicated "fine" recording flow (raise, contest, remit to a welfare fund) — this package reports
what `EmployeePermanentDeduction` already holds, it does not add fines-specific workflow. Printable
PDF layouts — JSON + a plain HTML/print view on the web side, not a generated PDF.

## Acceptance

- Each register is exact against a fixed, hand-verified dataset (a golden-file style test), covers
  a permission refusal and cross-tenant isolation.
- Nothing here is separately persisted; deleting and recomputing a `PayrollRun` changes the
  register's answer, because there is nothing else to go stale.
