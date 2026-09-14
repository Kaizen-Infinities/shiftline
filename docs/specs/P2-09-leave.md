# P2-09 — Leave management

## Why

`docs/handoff/2026-09-12-P1-17b-labour-code.md` left the leave ledger real but unused day to day:
nothing accrues automatically (`labourService.accrue` has to be called by hand), leave taken is a
bare number on the ledger rather than a dated, approvable request, and no employee can see their
own balance. This package puts a request in front of the ledger and a job in front of `accrue`.

## Scope

- `LeaveRequest` model (audited, RLS): employee, leave type, from/to dates, half-day flags at
  either end, `days` computed excluding weekly-offs (`PayrollConfig.weeklyOffDays`) and holidays
  (the existing `Holiday` calendar), reason, status (PENDING, APPROVED, REJECTED, CANCELLED),
  approver, decided-at, comments. A new `LeaveType.allowNegative` flag (leave without pay) lets a
  request take the ledger negative instead of being refused; a `LWP` type is added to
  `labourService`'s default set.
- Approving a request deducts the ledger by moving `LeaveBalance.taken` the same way
  `labourService.takeLeave` does; rejecting leaves the ledger untouched; cancelling an approved
  request restores the days by moving `taken` back down rather than deleting the request, so the
  request stays on record as CANCELLED with when it happened. Overlapping requests (PENDING or
  APPROVED) for the same employee are refused, as is a request beyond the balance unless the
  leave type allows negative.
- Monthly accrual job `src/jobs/leave.job.ts`, on the 1st at 02:00 IST: for every active tenant
  and every active employee, totals attendance (`PRESENT`/`HALF_DAY`/`LEAVE_PAID`) from the start
  of the financial year through the month just closed and calls `labourService.accrue` with that
  cumulative total. Idempotent by construction — the total does not change on a second run for
  the same month, and `accrue` sets the ledger's `accrued` to that total rather than adding to
  it.
- Routes `/api/leave/requests` (list with `employeeId`/`status`/`fyCode`/date filters, create,
  `:id/approve`, `:id/reject`, `:id/cancel`), `/api/leave/calendar?month=` (approved absences for
  the month, with department), `/api/leave/me` (the calling user's own employee link: balances
  and requests; 200 with `linked:false` rather than a 404 when there is none). Permissions
  `leave.view`, `leave.request` (self-service — every role that maps to an employee),
  `leave.approve` (accounts/owner).
- Notifications through the existing `notify` helper: whoever holds `leave.approve` on a new
  request; the requester's linked user on a decision.
- Web: `/hr/leave` (requests with approve/reject/cancel and a month calendar) and `/me/leave`
  (self-service balances, request form, own requests with cancel), both in Tailwind, under the
  Payroll sidebar section.

## Out of scope

Comp-off, changes to leave encashment, actuarial anything, shift-aware half days beyond the two
boundary flags, and business-place grouping on the calendar (`Employee` carries a department but
no business place in the current schema).

## Acceptance

- A request → approve deducts the ledger; reject leaves it; cancelling an approved request
  restores it.
- An overlapping request is refused; a request beyond the balance is refused unless the leave
  type allows negative.
- Days exclude holidays and weekly-offs.
- The calendar shows an approved absence for its month.
- `/me` answers for a user with an employee link and for one without, without a 404.
- The accrual job accrues once per employee per month and is idempotent on a second run.
- Every query is tenant-scoped; a foreign `companyId` sees no leave requests.
