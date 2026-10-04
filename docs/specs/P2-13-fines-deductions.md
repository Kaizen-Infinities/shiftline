# P2-13 — Fines and deductions: entry, approval, and payroll recovery

## Why

`docs/archive/handoff/2026-09-14-P2-03-registers.md` built the fines and deductions registers over the
new `EmployeeFineDeduction` model, but nothing writes to it — both registers stay empty in the
running app. The Code on Wages limits a fine to 3% of wages in a wage period, requires the
employee be given a chance to show cause before it is imposed, and requires it be recovered
within the period it was imposed in.

## Scope

- `EmployeeFineDeduction` gains status and workflow columns (migration
  `20260914130000_fines_deductions`): `status` (`PENDING` \| `APPROVED` \| `CANCELLED`),
  `wagePeriod` (the `YYYY-MM` or `YYYY-Www` payroll period the incident is recovered against),
  `showCauseDate`/`showCauseRemarks`, `approvedAt`/`approvedById`,
  `cancelledAt`/`cancelledById`/`cancelReason`, and `recoveredInPayrollResultId` (nullable FK to
  `PayrollResult`, `onDelete: SetNull`) with `recoveredAt`. Not audited, matching the existing
  `shownCauseGiven`/`SalaryAdvance`/`EmployeePermanentDeduction` siblings.
- Module `apps/api/src/modules/fines/` (routes + service + validation): CRUD-with-status —
  `POST /api/fines` (employee, kind `FINE`\|`DEDUCTION`, date, amount, cause, wage period),
  `POST /api/fines/:id/show-cause` (date + remarks), `POST /api/fines/:id/approve`,
  `POST /api/fines/:id/cancel`, `GET /api/fines`, `GET /api/fines/:id`. Nothing is ever deleted.
  - A `FINE` cannot be approved until `show-cause` has been recorded on it.
  - Approving a `FINE` re-checks the 3% ceiling (Payment of Wages Act s.8(3)): the sum of that
    employee's approved fines in the same wage period, including this one, must not exceed 3% of
    the period's gross wage (from `PayrollResult`, when a run for the period already exists) —
    refused with `FINE_CEILING_EXCEEDED` otherwise, not silently capped.
  - A `DEDUCTION` (damage/loss, s.10) has no ceiling beyond the amount entered — the entered
    amount **is** the actual loss, so there is nothing further to cap.
  - Cancelling an item already picked up by a payroll run (`recoveredInPayrollResultId` set) is
    refused with `ALREADY_RECOVERED`.
  - Permissions `fines.view`, `fines.manage`, `fines.approve` in the `payroll` feature; the owner
    (who holds every key) and the accounts role, which already runs payroll and leave, hold them;
    the auditor gets `fines.view` like the rest of payroll.
- Payroll recovery (`payroll.service.ts`): computing a run for a period now also loads that
  period's `APPROVED`, not-yet-recovered fines/deductions, adds their sum into the same
  `otherDeductions` figure permanent deductions already feed, and — inside the same transaction
  that saves the run's `PayrollResult` rows — stamps every row it used with
  `recoveredInPayrollResultId` and `recoveredAt`. A later run for the same period only sees
  fines/deductions still unstamped, so it never recovers the same item twice; deleting a `DRAFT`
  run (the only run a user may delete) un-stamps what it had claimed so a following run can pick
  it up again.
- Registers (`registers.service.ts`): the fines and deductions registers now read only
  `status: "APPROVED"` rows and report `recovered` (boolean) and `recoveredInPayrollResultId` per
  row, so the inspector's register shows what payroll actually took, not every draft entry.
- Web `/hr/fines`: list with employee/kind/status filters, a create dialog, show-cause and
  approve actions, and the recovery status per row; sidebar entry under HR/Payroll;
  `e2e/smoke.spec.ts` coverage.

## Out of scope

The muster roll and the other registers; leave; advances (already has its own creator in the
payroll module). Editing an approved or cancelled item — only the status actions above act on
one after creation.

## Acceptance

`apps/api/test/integration/fines.spec.ts`: create → show-cause → approve (happy path); approve
without show-cause refused; the 3% ceiling refused on approve; payroll run recovers an approved
fine/deduction once and net pay drops by the amount; a second run for the same period does not
double-recover; cancelling a recovered item is refused; the fines/deductions registers show only
the approved item with its recovery status; permission refusal; cross-tenant isolation. Existing
`registers.spec.ts`, `payroll-reconciliation.spec.ts` and the labour specs still pass.
