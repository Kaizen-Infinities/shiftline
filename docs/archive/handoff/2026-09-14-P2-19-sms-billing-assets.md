# P2-19 — SMS wiring, negotiated billing, fixed-asset polish

## Shipped

- **Payment SMS wiring.** `paymentsService.create()` now queues a `PAYMENT_LINK` SMS through the
  existing `smsService.sendTemplateQueued()` (P2-01) as soon as a link is raised, and
  `paymentsService.applyPayment()` queues `PAYMENT_RECEIVED` once a capture posts — the invoice
  side and the gateway-fee posting are unchanged, the SMS call sits after the transaction that
  does both. Both are best-effort: the tenant's mobile/DLT/SMS-off state is checked first
  (`queuePaymentSms()`), and any failure to queue is caught and logged, never surfaced to the
  caller — a customer not getting a text is not a reason to refuse the payment link or lose the
  capture. Idempotent by construction rather than by a new marker: a link is created exactly once
  per `create()` call, and `applyPayment()` already returns early on an existing
  `PaymentCapture.providerPaymentId` before this package's SMS call is ever reached, so a
  redelivered webhook (proved by `payments.spec.ts` already) queues nothing a second time.
- **A real link, not a rejected one.** The default `PAYMENT_LINK` template's body has always had
  a `{{link}}` placeholder, but `sms.calc.ts`'s anti-phishing rule (P1-22) forbids any variable
  value that looks like a URL — so the very first real call to this template (this package is
  the first caller "in anger", per P2-01's own note) would have failed every time with
  `UNSAFE_VARIABLE`. Rather than weaken that rule (its own unit test in `sms-rules.spec.ts`
  deliberately proves a `link`-named variable with a URL is still refused), `paymentsService`
  strips the value's scheme and `www.` before handing it to the template (`bareLink()`) — a
  provider's `shortUrl` such as `https://pay.example/abc123` becomes `pay.example/abc123`, which
  reads fine after "Pay at " and no longer contains `http://`/`https://`/`www.`. `sms.calc.ts`
  itself is untouched.
- **Negotiated monthly billing price.** `Subscription.negotiatedMonthlyPrice` (nullable
  `Decimal(12,2)`), settable only through the existing `PUT /api/platform/tenants/:id/subscription`
  (already `requireSuperAdmin`, already audited by trigger — no new permission key, no new audit
  wiring needed). `billingService.raise()` reads it ahead of the plan's list price when the
  caller gives no explicit amount, so `billingService.sweepAllTenants()` (P2-01) bills it without
  any change to the sweep itself. Platform console: a "Negotiated monthly price" field on the
  tenant's subscription card, blank clears it back to the plan's price.
- **Assets: an expense capitalisation test.** `asset.service.ts`'s `capitalise()` already handled
  `sourceDocType: "EXPENSE"` (P2-07); it had no test of its own. Added one: an approved, posted
  expense capitalises, moves the amount off `EXP-001` onto the asset ledger with a journal, and a
  second attempt on the same expense is refused (`ALREADY_CAPITALISED`).
- **Assets: a downloadable opening-import template.** `GET /api/assets/opening/template.csv`
  (`assets.manage`) serves `OPENING_COLUMNS`' own keys and one example row through the same
  `toCsv()` the CSV-imports module already uses — no second copy of the column list. The import
  dialog's "Download the template" button replaces the old in-memory blob.
- **Assets: a reversed run's restored figures in one view.** `GET /api/assets/depreciation-runs/:id`
  (`assetService.runDetail()`) returns the run's lines against each asset's _current_ accumulated
  depreciation; for a `REVERSED` run it also reports what the run had charged before the reversal
  (current figure plus the run's own amount — no new column, derived from what's already on the
  row). A still-`POSTED` run reports the same figure both ways. The fixed-assets screen gets a
  "View" action on a reversed run opening this in a dialog.
- Migration `20260914190000_sms_billing_assets` (`subscriptions.negotiated_monthly_price`; no new
  RLS or audit-trigger statements — the column lands on an already-audited, already-RLS'd table).
  `apps/api/test/integration/sms-billing-assets.spec.ts` (9 tests, 3 `describe` blocks).

## Decisions worth knowing

- **The negotiated price lives on `Subscription`, not `Company`.** `billing.service.raise()`
  already reads the tenant's `Subscription` row for its plan; putting the override next to the
  plan it overrides keeps `raise()`'s one `findFirst` the only read, and it is naturally cleared
  along with the rest of the subscription's billing state if a tenant's subscription is ever
  recreated.
- **SMS failures never touch the payment path.** `queuePaymentSms()` is a private helper that
  swallows everything after checking `enabled`/template/mobile up front — a payment link still
  gets created and a capture still gets posted even if the SMS gateway, the DLT registration, or
  the tenant's own SMS settings are in a bad state. The reason for a skip is only ever in the log.
- **`bareLink()` is a payments-module decision, not an `sms.calc.ts` one.** The anti-phishing rule
  is about a variable smuggling a scheme/host it was never registered for; a payment link's own
  domain is fixed by whichever provider issued it (the fixture's is `pay.example`), so stripping
  the scheme before templating is the payments side choosing what it hands to a general-purpose
  renderer, not a change to what the renderer refuses.
- **The reversed-run "before" figure is derived, not stored.** `AssetDepreciation.amount` (what
  this run charged) already exists per line; `FixedAsset.accumulatedDepreciation` already holds
  the current, post-reversal figure. `runDetail()` adds the two back together for a `REVERSED`
  run rather than needing a new column that would have to be kept in sync with the reversal path.

## Half-done / known gaps

- The `PAYMENT_LINK` and `PAYMENT_RECEIVED` templates still ship with `dltTemplateId: null` by
  default (P1-22's own design — a tenant fills it in after registering on the DLT platform), so a
  fresh tenant sees nothing sent until they do that; this package does not change that default.
- `queuePaymentSms()` looks up the mobile from `notifyPhone` or the customer's own `mobile` field;
  a payment link with neither (a bare-amount link with no customer and no `notifyPhone`) sends no
  SMS and is not itself surfaced anywhere as a gap on the link.
- The negotiated price has no history of its own beyond the audit trigger's row-level before/after
  — there is no "negotiated price changed" notification to the tenant's own accounts team.

## Next

Nothing scheduled from this note. The live SMS and payment-gateway adapters remain the same
account gap every prior phase has flagged.

## Blocked on you

Nothing new.

## Changelog sentence

Payment links now text the customer when they are raised and when they pay; a tenant's monthly
price can be hand-negotiated by a platform admin; and fixed assets gained a test for capitalising
an expense, a downloadable opening-import template, and one view of a reversed depreciation run's
restored figures.
