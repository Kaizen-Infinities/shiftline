# P2-19 — SMS wiring, negotiated billing, fixed-asset polish

## Why

`docs/archive/handoff/2026-09-14-P2-01-scheduled-work.md` built the queued SMS path and the scheduled
billing sweep but left both half-finished: nothing ever calls `sendTemplateQueued` for a payment
link or a capture, and the sweep has no way to bill a tenant a hand-negotiated price. `P2-07`'s
own follow-up list is missing a test for capitalising an expense, a downloadable opening-import
template, and one place to see a reversed depreciation run's restored figures.

## Scope

- `paymentsService.create()` queues a `PAYMENT_LINK` SMS to the customer's mobile (or the
  `notifyPhone` given on the link) once the link is raised; `paymentsService.applyPayment()`
  queues `PAYMENT_RECEIVED` once a capture posts. Both go through the existing
  `smsService.sendTemplateQueued()`; both are skipped — silently, with the reason only logged —
  when SMS is off for the tenant, the template is not registered with a DLT id, or there is no
  mobile number on file. Idempotent on their trigger: a link is only ever created once, and a
  capture's own dedup on `providerPaymentId` (already in `applyPayment`) means a redelivered
  webhook never queues a second message.
- The payment-link SMS's `{{link}}` variable carries the URL with its scheme and `www.` stripped
  (`bareLink()`), so a real short link can be sent without tripping `sms.calc.ts`'s existing rule
  against a URL sitting inside a template variable's value — that rule is untouched.
- `Subscription.negotiatedMonthlyPrice`: settable only through
  `PUT /api/platform/tenants/:id/subscription` (already behind `requireSuperAdmin`, already
  audited by trigger); `billingService.raise()` reads it ahead of the plan's list price when no
  explicit amount is given, so the monthly sweep bills it automatically.
- `GET /api/assets/opening/template.csv` serves the opening-import column headers with one
  example row (the same `OPENING_COLUMNS` the importer itself reads); the import dialog downloads
  it instead of holding its own in-memory copy.
- `GET /api/assets/depreciation-runs/:id` returns a run's lines against each asset's current
  accumulated depreciation; for a `REVERSED` run this includes what the run had charged before
  the reversal (current figure plus the run's own amount) alongside what the reversal restored it
  to. The web run list gets a "View" action for a reversed run.
- A test proving an approved expense can be capitalised (the GRN path was already covered).

## Out of scope

A live SMS or payment gateway adapter; delivery receipts; a negotiated price on any model other
than `Subscription`; changing `sms.calc.ts`'s anti-phishing rule itself.

## Acceptance

`apps/api/test/integration/sms-billing-assets.spec.ts`: a payment link queues `PAYMENT_LINK`
once and a capture queues `PAYMENT_RECEIVED` once (including across a redelivered, deduped
webhook); SMS off skips silently without failing link creation; a negotiated price is refused for
a tenant user and accepted for a platform admin, and `billingService.raise()` uses it; an
approved expense capitalises, posts its journal, and refuses a second attempt; the template CSV
is served (and refused without `assets.manage`); a reversed run's view shows each asset's
accumulated depreciation before and after, and a still-posted run shows the same figure both
ways. Existing `scheduled-work`, `payments`, `subscription-billing`, `assets`,
`assets-completion` and `sms-otp`/`sms-rules` specs pass unchanged.
