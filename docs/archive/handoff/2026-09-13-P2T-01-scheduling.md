# P2T-01 — Scheduling: the jobs that were never written

## Shipped

Three pg-boss jobs closing the first cross-cutting gap from the Phase 1 completion note, all
following the `eod-snapshot.job.ts` shape (fan-out + per-tenant handler, `runAsTenant`, idempotent):

- **Subscription invoicing.** `billingService.raiseNextIfDue()`
  (`apps/api/src/modules/payments/billing.service.ts`) raises the next invoice once a tenant's
  billing period has ended, gated on no invoice already outstanding. `QUEUES.BILLING_CYCLE_FANOUT`
  (daily, 05:00 IST) enqueues `QUEUES.BILLING_CYCLE` per active tenant
  (`apps/api/src/jobs/billing-cycle.job.ts`).
- **Leave accrual.** `labourService.accrueForMonth()`
  (`apps/api/src/modules/payroll/labour.service.ts`) recomputes every active employee's leave
  balances to date from `AttendanceRecord`, one query for the whole tenant rather than one per
  employee. `QUEUES.LEAVE_ACCRUAL_FANOUT` (1st of the month, 06:00 IST) enqueues
  `QUEUES.LEAVE_ACCRUAL` per active tenant (`apps/api/src/jobs/leave-accrual.job.ts`).
- **SMS send queue.** `smsService.sendTemplate()` now enqueues `QUEUES.SMS_SEND`
  (`apps/api/src/jobs/sms-send.job.ts`) instead of calling the provider inline, so a slow gateway
  no longer blocks the request. The one exception is deliberate: a caller that supplies its own
  `logBody` (the OTP path, whose real body must never sit in a queued row for a worker to read
  back later) always sends inline, whether or not a worker is running.

New queue entries and their `TENANT_QUEUES` / schedule wiring are in `apps/api/src/lib/jobs.ts`
and `apps/api/src/jobs/index.ts`.

## Tests

`apps/api/test/integration/scheduling.spec.ts` (7 tests): the billing-cycle handler raises exactly
once and is a no-op inside a trial; the leave-accrual handler recomputes EL from days worked and
grants CL/SL up front, and does not double-accrue on a second run; a templated SMS send is queued
and delivered by the worker rather than the request; an OTP send stays inline even with the queue
running and no worker registered to drain it (proof: the call still resolves instead of hanging).
Full suite: 70 files, 433 tests, all green. Typecheck (api, web, shared), lint (0 errors), prettier
and `e2e:typecheck` all clean.

## Half-done / known gaps

- The billing-cycle anchor assumes a monthly cycle (`periodEnd = anchor + 1 calendar month`); a
  plan with a different billing interval would need its own field on `Plan`, which does not exist
  yet.
- Leave accrual only counts `PRESENT`/`HALF_DAY` attendance toward the days-worked basis; whether
  paid leave itself should count toward earned-leave accrual is a policy call the brief did not
  settle, so it was left out rather than assumed.

## Next

P2T-02: wire the Labour Code overtime rules into the payroll run.

## Blocked on you

Nothing new; the Phase 1 blockers (GSP, Razorpay, MSG91 accounts) still apply to the payout and
delivery-receipt reconciliation this package deliberately left out.

## Changelog

Subscription invoices, leave balances and SMS messages are now generated and sent automatically
on schedule instead of needing a manual trigger.
