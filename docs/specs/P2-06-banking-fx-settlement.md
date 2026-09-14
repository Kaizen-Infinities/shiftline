# P2-06 — Banking and FX settlement

## Why

`2026-09-12-P1-20-bank-rec-cheques.md` left two gaps: a bounced cheque that is re-presented and
clears has no way back into the books (the register says CLEARED while the reversal still stands),
and nothing creates a cheque register row from a receipt or payment even though the columns for it
already exist. `2026-09-12-P1-17-fx-imports.md` left three: settling a foreign-currency sales
invoice never calls `realise`, so the realised gain or loss on the actual settlement date is never
booked; a purchase bill (GRN invoice) has no currency at all, so an importer's payables never show
up in the FX exposure or the period-end restatement; and the restatement itself posts one net line
to Sundry Debtors instead of one line per party, so a single customer's ledger cannot be trusted
against the restated total.

## Scope

1. **Cheque from receipt/payment.** A payment entry on a sales-invoice receipt or a GRN-invoice
   payment can carry `instrumentType: "CHEQUE"` plus `chequeNo`, `chequeDate`, `chequeBank`,
   `chequeParty`. A cheque dated today or earlier posts its voucher immediately and the cheque
   register row is created in the same transaction, `refDocType`/`refDocId`/`voucherId` pointing
   at that voucher. A cheque dated after today (a PDC) creates the register row only — no voucher —
   and the voucher posts later, when the cheque is moved to `CLEARED`.
2. **Re-presentation.** `POST /api/banking/cheques/:id/re-present` on a `BOUNCED` cheque posts the
   receipt/payment again (through `safeCreateVoucher`, a fresh `refDocId` per attempt so it can
   never double-post) and moves the cheque to `DEPOSITED`; clearing then works as for a fresh
   cheque. Moving a `BOUNCED` cheque straight to `CLEARED` (skipping re-presentation) is refused.
3. **FX realisation on settlement.** A receipt against a foreign-currency sales invoice, or a
   payment against a foreign-currency GRN invoice, takes the settlement rate (the payment's own
   rate if given, else the rate table for the payment date), and calls `fxService.realise` inside
   the same transaction as the receipt/payment voucher. A PDC's realisation is deferred to the date
   the cheque actually clears. Each settlement posts at most once (`realise`'s own `FX_REALISED`
   dedup on `refDocId`).
4. **Purchase-bill currency.** `GrnInvoice` gains `currencyCode`, `exchangeRate`, `foreignTotal`,
   converted the same way P1-14 converts a sales invoice: item rates arrive in the bill's currency
   and are multiplied onto rupees before GST and totals, so everything downstream is already INR.
   INR bills are unaffected.
5. **Party-wise restatement.** `fxService.openExposure` also lists open GRN invoices in a foreign
   currency (payables), and `revalue` posts one line per customer/supplier ledger instead of one
   net line to Sundry Debtors/Creditors — the total is unchanged, only its shape.

## Out of scope

Bank feeds, XLS/XLSX statement parsing, forward contracts, payout reconciliation, converting GRN
item rates for POs raised in a foreign currency (only the GRN invoice itself).

## Acceptance

- A cheque-instrument receipt creates the register row in the same transaction as the voucher.
- A PDC posts no voucher until it clears.
- Bounce, then re-present: the receipt posts again exactly once and the ledger balance matches a
  cheque that never bounced.
- A direct `CLEARED` update on a `BOUNCED` cheque is refused.
- A receipt against a USD invoice at a different settlement rate posts the realised gain/loss with
  the right sign and amount; a second receipt against the same settlement does not double-post.
- A USD GRN invoice appears in `openExposure`; the restatement posts one line per party and the
  same total as before.
- Permission refusal and cross-tenant isolation on every new endpoint.
