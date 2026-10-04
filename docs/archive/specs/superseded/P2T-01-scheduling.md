# P2T-01 — Scheduling: the jobs that were never written

## Why

The Phase 1 completion note's first cross-cutting gap: subscription invoicing, leave accrual and
SMS sends were all manual or synchronous. Phase 2 adds several more scheduled jobs on top of a
codebase that has just demonstrated it forgets to schedule things; this closes the three gaps
first.

## Scope

- **Subscription invoicing** (`billingService.raiseNextIfDue`): raises the tenant's next
  subscription invoice once its current period has ended (anchored on
  `currentPeriodEnd ?? currentPeriodStart`), gated on there being no invoice already `DUE` or
  `FAILED`. `BILLING_CYCLE_FANOUT` runs daily (a tenant's anchor can fall on any day of the month)
  and enqueues `BILLING_CYCLE` per active tenant, singleton-keyed per day.
- **Leave accrual** (`labourService.accrueForMonth`): recomputes every active employee's leave
  balances to date for the financial year containing the month just closed, from
  `AttendanceRecord` (present days, half days at 0.5) since the FY began. `LEAVE_ACCRUAL_FANOUT`
  runs on the 1st of the month IST and enqueues `LEAVE_ACCRUAL` per active tenant.
- **SMS send queue**: `sms.service.ts#sendTemplate` now enqueues `SMS_SEND` (one job per message)
  instead of calling the provider inline, when a worker is running. The job handler
  (`sendQueuedMessage`) reads the queued row back and delivers it.

## Out of scope

Payout reconciliation for the payment gateway and SMS delivery receipts (both need a live
account, per the Phase 1 note); reconciling the wage engine with the Labour Code (P2T-02).

## Acceptance

- `raiseNextIfDue` raises at most one invoice per call and is a no-op inside a trial or before the
  period ends; the per-tenant job handler drives the same method and is idempotent.
- `accrueForMonth` recomputes (never doubles) accrued days on a second run for the same month.
- A templated SMS send with a worker running ends up `SENT` without the request thread calling the
  provider; the OTP path (which stores a redacted `logBody` instead of the real body) always sends
  inline, queue or not, since its real body must never sit in a job row for a worker to read back.
- `apps/api/test/integration/scheduling.spec.ts` covers all three.
