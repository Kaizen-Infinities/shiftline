# P2-15 — HR shared pieces: employee picker, business place, leave and fines polish

## Why

P2-09 (leave), P2-13 (fines and deductions) and P2-03 (registers) all left the same gaps
behind: the HR screens take a raw employee id because there is no employee search that does not
need `payroll.view`; neither `Employee` nor `AttendanceRecord` carries a business place, so the
registers cannot filter by one; the leave calendar is a flat table; `LeaveType.allowNegative` has
no button; a `PENDING` fine cannot be edited; the employee is never notified of a show-cause or
an approved fine.

## Scope

- `GET /api/employees/search?q=` behind a new light key `employees.search` (registered in
  `packages/shared`, alongside the existing `employees.view/create/edit/delete/export`), granted
  to every role that already holds `leave.view`, `fines.view` or `payroll.view` — id, code, name,
  department, business place; capped at 20 rows; active employees only.
- Web `EmployeePicker` (`apps/web/src/components/common/EmployeePicker.tsx`): a typeahead over
  that endpoint, used by `LeaveHrPage` and `FinesPage` in place of a raw employee-id input.
- `Employee.businessPlaceId` (nullable `BigInt`, relation to `BusinessPlace`, additive migration
  `20260914150000_hr_shared`): a data step defaults it to a company's one and only business
  place where exactly one exists. Exposed on the employee API (create/update/find) and the
  employee form; the registers' `businessPlaceId` filter now filters by it — directly on
  `Employee` for the muster roll and wages registers, through the employee relation for fines,
  deductions and advances, and by the resolved employee-id set for the overtime register (whose
  source, `AttendanceRecord`, still carries no business-place link of its own).
- Leave calendar: `/hr/leave`'s calendar tab now renders a month grid (employees down, days of
  the month across, the leave type code in each day a request covers) built client-side from the
  existing `GET /api/leave/calendar` response — no backend change.
- `LabourEntitlementsPage`: a leave-types table on the "Leave" tab with an `allowNegative`
  toggle per type (also fixes `POST /api/labour/leave-types` silently dropping the field — it was
  missing from that route's zod schema even though the service already accepted it).
- `PATCH /api/fines/:id` (amount, cause, date, wage period) for a still-`PENDING` item; refused
  once a show-cause is recorded (`SHOW_CAUSE_RECORDED`) or once approved (item is no longer
  `PENDING`, `NOT_PENDING`). An "Edit" action on the `FinesPage` dialog.
- Fines notifications: the employee's linked user (if any) is notified on `show-cause` and on
  `approve`, through the existing `notify` helper, the same shape leave decisions already use.

## Out of scope

Payroll computation; registers other than the business-place filter; actuarial anything; a
`BusinessPlace` picker component (none exists yet anywhere in the app — the employee form takes
the id directly, same as the registers' existing business-place filter).

## Acceptance

`apps/api/test/integration/hr-shared.spec.ts`:

- Employee search returns matches, caps at 20, is refused without `employees.search`, and never
  shows another tenant's employee.
- Employee create/update round-trip `businessPlaceId`; an unknown place is refused (400).
- The wages register filters by business place.
- A fine's edit succeeds while `PENDING`, is refused once a show-cause is recorded, and a
  notification is recorded on show-cause and on approval.

Existing `leave.spec.ts`, `fines.spec.ts`, `registers.spec.ts` and the employee-touching specs
still pass.
