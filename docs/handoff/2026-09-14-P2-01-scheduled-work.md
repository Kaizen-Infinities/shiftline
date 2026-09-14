# P2-01 — Scheduled work

## Shipped

- **`billing.job.ts`** — monthly, 03:30 IST on the 1st: `billingService.sweepAllTenants()` raises
  the current period's invoice for every tenant whose subscription is not `CANCELLED`, through
  the same `billingService.raise()` the platform console already used by hand. Idempotent on
  `SubscriptionInvoice`'s existing `@@unique([companyId, periodStart])`; a tenant with no
  subscription, or a plan with no list price and no explicit amount (`NO_PRICE`), is counted as
  skipped rather than failed.
- **`sms.job.ts`** and `smsService.sendTemplateQueued()` / `deliverQueued()`: a per-message queue
  (`comms.sms.send`, singleton-keyed on `companyId:messageId`, 5 retries with backoff) alongside
  the existing synchronous `sendTemplate()`. The row is written `QUEUED` exactly as before; a job
  (or, when pg-boss is not running, an inline fallback) then calls the same `SmsProvider`
  interface. Idempotent on the row's own status: anything that has left `QUEUED` is returned
  unchanged, so a pg-boss redelivery — or this handler being invoked twice by hand — never sends
  twice. `POST /api/sms/send` takes an additive `queue: boolean` field. `otp.service.ts` is
  untouched: it still calls `sendTemplate()` directly, because the code that is actually sent
  lives only in that call's local variable and is deliberately never written to the row
  (`sms.calc.ts`'s masking) — there would be nothing honest for a later job to send.
- **`banking.job.ts`** — daily, 08:30 IST: `bankingService.sweepDueCheques()` warns holders of
  `banking.view` about every `IN_HAND` cheque, received or issued, due today or within the next
  two days — the gap P1-20's own note named directly. Same once-per-cheque-per-day shape as the
  MSME day-30/day-43 nudge: the notification's `link` carries the cheque id, and a matching row
  already existing is the idempotency check.
- **`tally.job.ts`** — monthly, 04:00 IST on the 1st, after billing: `tallyService.sweepAllTenants()`
  prepares an incremental `BOTH`-scope run for the month just closed, for tenants that opted in,
  and notifies holders of `tally.view`. New `TallyConfig` model (`autoExportEnabled`, default
  `false`, one row per tenant, created lazily like `SmsConfig`), read/written at
  `GET`/`PUT /api/tally/settings` (`tally.view` / `tally.manage`), with a checkbox on the
  existing `/accounts/tally` screen. Idempotent: a run already recorded for the window (matched
  on `fromDate`/`toDate`/`incremental`) is left alone. Never auto-confirms — the accountant still
  says the file reached Tally.
- Migration `20260914010000_scheduled_work` (`tally_configs`, RLS, no audit trigger — a settings
  row with no secret and no book/document/master shape, same as `sms_configs`). No new
  permission keys: every route reuses `banking.view/manage`, `tally.view/manage`, `sms.send`.
  `apps/api/test/integration/scheduled-work.spec.ts`, one `describe` per job.

## Decisions worth knowing

- **Every sweep is called through its job handler, not reinvented in the test.** The handlers
  (`billingSweepHandler`, `chequeDueHandler`, `tallyExportSweepHandler`, `smsSendHandler`) are
  exercised directly, the way `jobs.spec.ts` already does for the EOD snapshot — no live pg-boss
  round trip is needed to prove a handler's own idempotency and tenancy.
- **SMS idempotency lives on the message row's status, not on a separate ledger.** `QUEUED` is
  the only state a delivery attempt is made from; `SENT`/`DELIVERED` are terminal and short-
  circuit immediately, while `FAILED` is not terminal, so a pg-boss retry tries the provider
  again rather than being permanently stuck — the same shape `e-invoice.service.ts` already uses
  for IRN generation.
- **The Tally sweep matches on the window, not a unique constraint.** Unlike billing, `TallyExportRun`
  has no natural per-period key — a person can run as many manual exports as they like — so the
  monthly job checks for an existing run over the same `fromDate`/`toDate` with
  `incremental: true` before creating one, rather than adding a uniqueness rule that would also
  constrain manual runs.
- **`TallyConfig` is not audited.** It is a settings row with no secret and no book, document or
  master shape — the same reasoning P1-22 gave for leaving `SmsConfig` and `PaymentGatewayConfig`
  out of `AUDITED_MODELS`.
- **The queued SMS path is separate code from `sendTemplate`, not a flag on it**, because the two
  have to disagree about the OTP case: `sendTemplate` accepts a `bodyOverride` that is sent but
  never stored, which is exactly the shape a queue cannot honour — a job reads the row later and
  there is nothing else to read. Duplicating the validation rather than sharing it keeps that
  disagreement explicit instead of one flag away from a masked OTP body reaching a queue.

## Half-done / known gaps

- **Nothing calls the SMS queue in anger yet.** `PAYMENT_LINK` still is not wired into P1-21's
  link creation, `PAYMENT_RECEIVED` is not wired into a capture — both are still by-hand-only.
  `sendTemplateQueued` exists and is reachable from `POST /api/sms/send` with `"queue": true` for
  when one of those flows is built.
- **No per-tenant billing-amount override in the sweep.** `raise()` already accepts one; the
  scheduled sweep always lets the plan's list price decide, which is right for every plan except
  a hand-negotiated one, and there is nowhere yet to record a negotiated price against a tenant.
- **The cheque warning does not distinguish "about to bounce" from "about to clear".** It only
  says a post-dated cheque is due; whether that is good or bad news is for the person reading it,
  same as the register itself does today.
- **No settings UI for the SMS queue or the cheque warning** — neither needed one: the SMS queue
  is an internal delivery path behind the existing send call, and the cheque warning has no
  opt-in, unlike Tally's.
- A re-presented cheque (P1-20's own known gap) is still not handled; the due-date warning fires
  on any `IN_HAND` cheque regardless of whether it was bounced and refiled.

## Next

Whichever Phase 2 package first sends something by SMS on its own (a payment link, a receipt) is
the one that should call `sendTemplateQueued` instead of adding another synchronous send.

## Blocked on you

Nothing new. The live provider adapters (Razorpay, MSG91) that would make any of this reach a
real phone or a real gateway are still the same account gap Phase 1 already flagged.

## Changelog sentence

Subscription invoices, cheque-due warnings and the monthly Tally export now raise and notify
themselves on schedule, and SMS sending has a queued path alongside the immediate one.
