# P2-06 — Banking and FX settlement

## Shipped

- **Cheque from a receipt or payment.** A payment entry on a sales-invoice receipt or GRN-invoice
  payment can carry `instrumentType: "CHEQUE"`, `chequeNo`, `chequeDate`, `chequeBank`,
  `chequeParty`. A cheque dated on or before its own payment date posts its voucher immediately
  and creates the cheque register row in the same transaction, `refDocType`/`refDocId`/`voucherId`
  pointing at that voucher. A cheque dated after its payment date (a PDC) creates the register row
  only — `voucherId` stays null — and the voucher posts when the cheque is later marked `CLEARED`.
- **Re-presentation.** `POST /api/banking/cheques/:id/re-present` on a `BOUNCED` cheque posts the
  receipt/payment again through `safeCreateVoucher` (a fresh `refDocId` per attempt, via the new
  `presentedCount` column, so it can never double-post) and moves the cheque to `DEPOSITED`.
  Moving a `BOUNCED` cheque straight to `DEPOSITED` or `CLEARED` is refused (`CHEQUE_BOUNCED`).
- **FX realisation on settlement.** Posting a receipt against a foreign-currency sales invoice, or
  a payment against a foreign-currency GRN invoice, computes the foreign amount actually realised
  from what was paid in rupees at the settlement rate (the payment's own `settlementRate`, or the
  rate table for the payment date) and calls `fxService.realise` inside the same transaction as
  the receipt/payment voucher. `fx.service.ts`'s `realise` now takes an optional transaction
  client so it can run inside a caller's own transaction rather than always opening its own.
- **Purchase-bill currency.** `GrnInvoice` gained `currencyCode`, `exchangeRate`, `foreignTotal`,
  converted exactly the way P1-14 converts a sales invoice (item rates multiplied by the rate
  before GST and totals); INR bills are unaffected. `fxService.openExposure` now also lists open
  GRN invoices in a foreign currency, and the restatement's `revalue`/`previewRevaluation` posts
  one line per customer/supplier ledger (via each `FxLine`'s new `partyLedgerCode`) instead of one
  net line to Sundry Debtors — the total across every party line is exactly the net amount either
  way, and the sign convention (a payable's gain and a receivable's gain both debit the party and
  credit the gain ledger) meant the posting logic did not need to know which side a line was on.
- Migration `20260914060000_banking_fx_settlement` (additive columns on `cheques` and
  `grn_invoices`; no new models, so `audited-models.ts` and `leak.spec.ts` needed no changes),
  web: the cheque register's "Re-present" action on a bounced cheque
  (`BankReconciliationPage.tsx`, `bankingService.rePresent`), the FX exposure screen's "Type"
  column so payables and receivables read as one list (`ForexPage.tsx`).
  `apps/api/test/integration/banking-fx-settlement.spec.ts` (6 tests): cheque register row on an
  immediate cheque payment; a PDC posts no voucher until `CLEARED`; bounce → direct-clear refused
  → re-present → the party ledger nets back to what it was before the bounce; realised gain on a
  USD receipt with the right amount and no double-post on a repeat call; a USD GRN invoice in the
  exposure and a party-wise restatement with the same total; permission refusal and cross-tenant
  isolation on the new route. `banking.spec.ts`'s existing "bounces a received cheque" test updated
  — it used to assert a bounced cheque _could_ be cleared directly; that was exactly the gap this
  package closes, so the assertion now expects the refusal.

## Decisions worth knowing

- **A post-dated cheque is defined against its own payment date, not the system clock.** A cheque
  received today and dated for next month is post-dated the day it arrives, whatever today happens
  to be — comparing `chequeDate` to `paymentDate` rather than to `new Date()` also means the check
  behaves the same in a test running on a fictional date as it does in production.
- **The deferred clearing re-runs the whole posting function with a forced override**, not a
  bespoke posting path: `postReceiptVouchersForSales`/`postPaymentVouchersForGRN` take an optional
  `forcePost: string[]` of `refDocId`s to post even though their own PDC check would otherwise
  still skip them (it is evaluated from the payment's own stored dates, which do not change when
  the cheque clears). This reuses the exact same voucher-building code a same-day cheque uses,
  rather than a second copy of it.
- **Re-presentation reverses on the same ledger the bounce hit.** The existing bounce logic posts
  against the generic `DEBT-001`/`CRED-001`, not the specific customer's or supplier's own ledger
  (a pre-existing P1-20 simplification, not something this package changed); re-presenting had to
  match that, or the two entries would land on different ledgers and never net back to zero.
- **The realised foreign amount comes from the settlement rate, not the booked rate.** The rupee
  figure recorded on a payment is what was actually paid, converted at the day's rate — dividing it
  by the rate the _invoice_ was booked at (rather than the rate the _payment_ settled at) silently
  invents a foreign amount that was never actually received.
- **`Cheque.sourceDocId` is new**, alongside the existing `refDocType`/`refDocId`: `refDocId`
  names the one payment line (so multiple cheques against one invoice/bill stay distinct),
  `sourceDocId` names the invoice/GRN itself, which the deferred-clearing path needs to re-run
  `postReceiptVouchersForSales`/`postPaymentVouchersForGRN` and which `refDocId` alone cannot give
  back (it is a derived hash, not the parent id).

## Half-done / known gaps

- **Sales invoices have no manual receipt-recording endpoint.** `POST`/`PUT
/api/sales-invoices` always writes `payments: []` regardless of what is sent — the only thing
  that ever appends a real entry to `SalesInvoice.payments` today is the payment-gateway capture
  path (`modules/payments/payments.service.ts`). The cheque/FX wiring in
  `postReceiptVouchersForSales` is real and exercised by the test suite (directly, and through the
  gateway path, which already calls it), but there is no UI or endpoint yet for a person to record
  a cheque or bank-transfer receipt by hand against a sales invoice the way there is for a GRN
  invoice. The purchase side (`GrnInvoice.payments` via `POST`/`PUT /api/grn-invoices`) is
  unaffected and fully wired end to end, web form included via its existing payments array.
- **The GRN and sales-invoice web forms have no cheque-instrument fields yet.** The backend accepts
  `instrumentType`/`chequeNo`/`chequeDate`/`chequeBank`/`chequeParty` on a payment entry and posts
  correctly when they are sent, but neither form's payments UI offers them — today they can only
  be sent by a caller that builds the request body itself. Same for `currencyCode`/`exchangeRate`
  on the GRN invoice form: the sales invoice form already has these fields (P1-14); the GRN form
  does not yet.
- **`deriveStablePaymentRefId`'s fallback can exceed `Voucher.refDocId`'s 36 characters** when a
  payment has no `id` of its own (`<invoiceId>_pay_<hash>` or `<invoiceId>_rcpt_<hash>` runs to
  around 53 characters against a 36-character column) — a pre-existing issue, not introduced by
  this package, but one this package's tests worked around by always giving payment entries an
  explicit short `id`. Worth a follow-up: either shorten the derived id or widen the column.
- **A PDC that clears before its own `chequeDate` re-runs FX realisation at the original
  `paymentDate`, not the actual clearing date** — a minor inaccuracy (the exchange rate used is
  the one for when the payment was recorded, not when the cheque actually cleared) that only
  matters for a PDC against a foreign-currency document, which is a narrow combination.
- Bank feeds, XLS/XLSX statement parsing, forward contracts and payout reconciliation are out of
  scope, as in P1-20/P1-17.

## Next

P2-07: fixed-asset completion (opening balances, depreciation reversal, capitalise from GRN).

## Blocked on you

Nothing new. The pre-existing P1-20 gaps ("which banks does the company actually use, and a real
statement export from each") are still open and unrelated to this package.

## Changelog sentence

A cheque payment on a purchase bill now creates its own register row and, if post-dated, posts
only when it actually clears; a bounced cheque can be re-presented instead of re-entered by hand;
and a receipt or payment against a foreign-currency invoice or purchase bill now books the
realised exchange gain or loss on the day it actually settles, with purchase bills joining sales
invoices in the foreign-currency exposure and the period-end restatement.
