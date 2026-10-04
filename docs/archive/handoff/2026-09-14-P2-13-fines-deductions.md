# P2-13 — Fines and deductions: entry, approval, and payroll recovery

## Shipped

- `EmployeeFineDeduction` gains workflow columns (migration `20260914130000_fines_deductions`):
  `status` (`PENDING`/`APPROVED`/`CANCELLED`), `wagePeriod`, `showCauseDate`/`showCauseRemarks`,
  `approvedAt`/`approvedById`, `cancelledAt`/`cancelledById`/`cancelReason`, and
  `recoveredInPayrollResultId` (nullable FK to `PayrollResult`, `onDelete: SetNull`) with
  `recoveredAt`. Not audited, matching its existing siblings. Not in the seed
  (`MODELS_WITHOUT_SEED_ROWS` already listed it).
- New module `apps/api/src/modules/fines/` (`fines.routes.ts`, `fines.service.ts`,
  `fines.validation.ts`), mounted at `/api/fines`:
  - `POST /api/fines` — employee, kind `FINE`/`DEDUCTION`, date, amount, cause, wage period
    (`YYYY-MM` or `YYYY-Www`, matching a payroll run's `period`).
  - `POST /api/fines/:id/show-cause` — date and remarks; sets `shownCauseGiven`.
  - `POST /api/fines/:id/approve` — refuses a `FINE` without a show-cause
    (`SHOW_CAUSE_REQUIRED`, 400) and refuses one that would take the employee's approved fines
    for that wage period over 3% of the period's gross wage (`FINE_CEILING_EXCEEDED`, 409),
    checked against `PayrollResult.grossSalary` when a run for the period already exists — when
    none does yet, there is nothing to check against and the approval goes through. A
    `DEDUCTION` has no ceiling: the entered amount _is_ the actual loss.
  - `POST /api/fines/:id/cancel` — refused once payroll has recovered the item
    (`ALREADY_RECOVERED`, 409). Nothing is ever deleted.
  - `GET /api/fines` (filters: employeeId, kind, status, wagePeriod, date range) and
    `GET /api/fines/:id`.
  - Permissions `fines.view`, `fines.manage`, `fines.approve` in the `payroll` feature; the owner
    (everything) and the accounts role (already runs payroll and leave) hold `manage`/`approve`;
    the auditor gets `view`, same shape as `registers`.
- Payroll recovery (`payroll.service.ts`, `computeRun`): loads `APPROVED`, not-yet-recovered
  (`recoveredInPayrollResultId: null`) fines/deductions for the run's exact `period` string,
  folds their per-employee sum into the same `otherDeductions` figure `EmployeePermanentDeduction`
  already feeds (so it reduces `netSalary` through the existing arithmetic, no new deduction
  line), and — inside the same transaction that creates the run's `PayrollResult` rows — stamps
  every row it used with that employee's resulting `PayrollResult.id` and `recoveredAt`. A later
  run only ever sees rows still unstamped, so nothing is recovered twice; `deleteRun` (the only
  run a user may delete — `DRAFT` only) releases what it had claimed back to `null` first, inside
  its own transaction, so a following run can pick it up.
- Registers (`registers.service.ts`, `registers.routes.ts`): `fines()`/`deductions()` now read
  only `status: "APPROVED"` rows and each row carries `recovered` (boolean) and
  `recoveredInPayrollResultId`; the CSV/PDF column set gained a "Recovered" column.
  `fineDeductionTotalsForMonth` (feeding the wages register's `fines` figure) is similarly
  `APPROVED`-only now.
- `packages/shared`: `fines` module (`view`/`manage`/`approve`) in `permissions.ts`, added to the
  `payroll` feature in `features.ts`, `API_PATHS.fines.base` in `api-paths.ts`.
  `provisioning.service.ts`: ACCOUNTS role gets full `fines` keys, AUDITOR gets `fines.view`.
- Web `/hr/fines` (`apps/web/src/modules/payroll/pages/FinesPage.tsx`,
  `apps/web/src/services/finesService.ts`): filterable list, a create dialog, inline show-cause
  and approve/cancel actions, and the recovery status per row. Sidebar entry under
  Payroll → "Fines and Deductions"; smoke coverage in `e2e/smoke.spec.ts`.
- Test factory `createFineDeduction` now defaults `status: "APPROVED"` and derives `wagePeriod`
  from `occurredOn`'s month (existing `registers.spec.ts` calls didn't set either field and
  expect the rows to show up in the now-`APPROVED`-only registers — the default keeps that true
  without touching that spec).
- `apps/api/test/integration/fines.spec.ts` (7 tests): create → show-cause → approve; approve
  refused before show-cause; the 3% ceiling refused on approve; a deduction approved without a
  show-cause; a real payroll run recovering an approved fine once with net pay dropping by the
  exact amount, a second run over the same wage period (a different `employeeCategory`, since the
  API refuses a second run with the same period/type/category outright) not recovering it again,
  and cancelling the now-recovered item refused; the fines/deductions register showing only the
  approved row with its recovery status; permission refusal; cross-tenant isolation.

## Decisions worth knowing

- **Recovery is stamped at `computeRun` (DRAFT) time, not at `approveRun`.** Unlike
  `SalaryAdvance`, which only updates its own `recoveredAmount` when a run is approved/locked,
  a fine/deduction's `recoveredInPayrollResultId` is set as soon as the `PayrollResult` row
  exists — because there is no per-item partial recovery to reconcile later, and stamping early
  is what makes "a later run for the same period doesn't double-recover" true by construction
  (the second run's query for unrecovered rows simply doesn't see it) rather than needing a
  second `SalaryAdvance`-style "claimed in a still-DRAFT run" cross-check.
- **A payroll run is genuinely one-per-period-type-category** (`computeRun`'s existing duplicate
  check, unrelated to this package) — there is no supported "re-run the same run" action short of
  deleting a `DRAFT` one. The acceptance test's "second run" therefore uses a different
  `employeeCategory` for the same wage period, which the app does allow and is a legitimate way
  two separate runs can cover the same employee and period.
- **The 3% ceiling is checked at `approve`, not at `create`.** A fine can be recorded and shown
  cause on before anyone knows whether it will fit under the ceiling; the check that matters is
  the one that actually admits it into the approved total, so `create` never refuses on amount
  alone.
- **A deduction's "actual loss cap" is not a separate check.** The task called for capping
  deductions for damage/loss at the actual loss; there is no code path that inflates the entered
  `amount` beyond what was typed at `create`, so the amount entered already _is_ the cap — noted
  in the spec rather than added as a redundant runtime check.
- **`wagePeriod` is a plain validated string** (`YYYY-MM` or `YYYY-Www`), not derived from
  `occurredOn` — an incident on one date can be assigned to the wage period it should be
  recovered against, matching the Payment of Wages Act's "recovered within the wage period"
  requirement rather than assuming the calendar month it happened in.

## Half-done / known gaps

- **No UI employee picker** — the create dialog takes a raw employee id, the same shallow
  pattern `LeaveHrPage` already uses; a proper picker is a shared-component gap, not specific to
  this package.
- **`businessPlaceId` filtering** on the fines/deductions registers was already a known gap from
  P2-03 (neither `Employee` nor `AttendanceRecord` carries a business-place link) and is
  untouched here.
- **No notification to the employee** when a show-cause is recorded or a fine is approved — the
  module only records state; whatever notifies employees of anything today (if anything) wasn't
  wired to this.
- **Editing a `PENDING` item** (amount, cause, date) isn't offered — only the four status actions
  in scope act on a row after creation; getting something wrong means cancelling it and creating
  a fresh one.

## Blocked on you

Nothing — this closes the gap P2-03's hand-off named directly ("nothing writes to
`EmployeeFineDeduction` yet").

## Changelog sentence

Fines and deductions can now be recorded, shown to the employee, approved against the 3% wage
ceiling, and are recovered automatically — once — in the payroll run for their wage period, at
`/hr/fines`.
