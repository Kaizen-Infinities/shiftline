# P2-01 — Scheduled work

## Why

Phase 1 left four things manual or synchronous that should run themselves: subscription
invoices, the SMS send, cheque-due warnings and the Tally export
(`docs/handoff/2026-09-12-phase-1-complete.md` "Nothing schedules itself that should", and the
per-package notes for P1-21, P1-22, P1-20 and P1-06). None of the four needs an account the owner
has not supplied; each reuses a service that already does the work by hand.

## Scope

- **`billing.job.ts`** — monthly (1st, 03:30 IST): for every tenant with a `Subscription` not
  `CANCELLED`, raises the invoice for the month that just started through
  `billingService.raise()`. Idempotent on `SubscriptionInvoice`'s existing
  `@@unique([companyId, periodStart])`; a tenant with no subscription or a zero-price plan and no
  explicit amount is skipped, not failed.
- **`sms.job.ts`** — a per-message queue, not a fan-out. `smsService.sendTemplateQueued()` writes
  the `SmsMessage` row (`QUEUED`) exactly as `sendTemplate()` does, then enqueues one job per
  message (`comms.sms.send`, singleton-keyed on `companyId:messageId`) instead of calling the
  provider inline; the handler calls the same provider interface, retries on pg-boss's own
  options (5 attempts, backed off), and is idempotent because it returns the row unchanged once
  its status has left `QUEUED`. `sendTemplate()` (synchronous) is untouched — the OTP path keeps
  calling it directly, because the code that actually gets sent lives only in that call's local
  variable and is deliberately never written to the row (`sms.calc.ts`'s masking), so the code
  could not survive a queue hand-off honestly. Nothing yet calls the queued path in anger; it is
  reachable from `POST /api/sms/send` with `"queue": true` for when something does.
- **`banking.job.ts`** — daily (08:30 IST): warns holders of `banking.view` about every `IN_HAND`
  cheque, received or issued, whose `chequeDate` is today or within the next two days. Same
  once-per-cheque-per-day shape as the MSME day-30/day-43 nudge: the notification's `link`
  encodes the cheque id and the day it was sent for, and a matching row already existing is the
  idempotency check.
- **`tally.job.ts`** — monthly (1st, 04:00 IST, after billing): for tenants that opted in, prepares
  an incremental `BOTH`-scope run for the month just closed through `tallyService.createRun()`
  and notifies holders of `tally.view`. New per-tenant setting `TallyConfig.autoExportEnabled`
  (default `false`, no seed row — created on first read like `SmsConfig`), read and written at
  `GET/PUT /api/tally/settings` (`tally.view` / `tally.manage`), with a toggle in the existing
  `/accounts/tally` screen. A run is only ever prepared, never auto-confirmed — the accountant
  still says the file reached Tally.

## Out of scope

Live provider adapters (Razorpay, MSG91), payout reconciliation, SMS delivery receipts, an SMS
per-user rate limit, sending anything by SMS automatically (payment links, receipts) — the queue
exists, nothing calls it yet outside the opt-in `send` flag and the tests.

## Acceptance

`apps/api/test/integration/scheduled-work.spec.ts`: for each job, does its work for the demo
tenant, is a no-op on a second run (or on a tenant with nothing due), and a cross-tenant test
proves a second tenant's rows and notifications are untouched. The SMS job additionally proves a
queued message is delivered exactly once even when the handler is invoked twice for the same
message id.
