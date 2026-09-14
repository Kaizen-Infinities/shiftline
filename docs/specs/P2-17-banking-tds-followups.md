# P2-17 — Banking, FX and TDS/TCS follow-ups

## Why

Six earlier hand-offs (`P2-06`, `P2-05`, `P2-11`, `P2-12`, `P2-01`) each closed with a short list
of known gaps. None was big enough to be its own package, but left alone they are real bugs: a
payment reference that can overflow its own column, an exchange gain posted at the wrong date, a
due-cheque warning that cannot tell a bounce from an ordinary cheque, a supplier master missing
the fields its own GRN form already reads, a TDS challan that can silently post to the wrong
ledger, a TCS threshold that resets across rows of the same buyer, a scrap default with nothing
but a name to go on, and a cheque match that assumes numbers never repeat.

## Scope

1. `deriveStablePaymentRefId`'s fallback (used only when a payment has no `id` of its own) is
   now a plain hash — `h_<32 hex>` — 34 characters, always within `Voucher.refDocId`'s 36. A
   payment with an explicit `id` is unaffected.
2. A PDC's FX realises at the actual clearing date (or the rate given on the payment itself),
   not the date the payment was first recorded; `postPaymentVouchersForGRN` and
   `postReceiptVouchersForSales` take an optional `clearingDate`, threaded from
   `banking.service.ts`'s own clear. The realised voucher's narration and its own date both
   record which date the rate came from. Along the way, `currencyService.rateFor` gained an
   optional `db` parameter — called through the caller's own transaction client instead of the
   top-level one, since the tenant-scoping extension does not re-apply row-level security to a
   query issued on the plain client from inside an already-open transaction, and would
   otherwise silently see no rate at all.
3. `bankingService.warnDueCheques` skips a cheque that is `BOUNCED` and has not been
   re-presented, and labels one that has (`presentedCount > 0`, still `DEPOSITED`) as
   re-presented in its own message rather than warning about it the same way as an ordinary
   post-dated cheque.
4. `Supplier.defaultTdsSectionCode` (already a column from P2-11), `higherRate206AB` and
   `deducteeType` (already columns from P1-15) are now in `supplier.validation.ts` and on
   `SupplierForm.tsx` behind `tds.view`.
5. `tdsService.payChallan` refuses (`SECTION_NO_LEDGER`, 409) a section whose `ledgerCode` is
   blank instead of falling back to `TDS-LIA-001`; `POST /api/tds/sections` requires a non-blank
   `ledgerCode` on every save, edit included.
6. `tdsService.rateFor`'s threshold aggregate pools by PAN, not by `customerId`, for section
   `206C(1H)` specifically, when the deductee's PAN is present and valid; every other section,
   and 206C(1H) itself with no PAN on file, stays per document-party row. Sales-invoice TCS
   collection now records a (possibly zero-amount) `TdsDeduction` row even below the section's
   own threshold, the same way the GRN side already does — otherwise nothing is ever on file for
   a later invoice's own aggregate to add up.
7. `Product.isScrap` (additive column, migration `20260914170000_banking_tds_followups`), a
   checkbox on `ProductForm.tsx`; `SalesInvoiceCreate.tsx`'s scrap TCS default checks a line's
   own product (direct, or via a composite sales product's components) before falling back to
   the `/scrap/i` name heuristic.
8. `GrnInvoiceViewPage.tsx`'s cheque match keys on cheque number **and** cheque date (within a
   bill already scoped to its own `sourceDocId`), not number alone, so two payments on one bill
   that happen to share a re-typed cheque number no longer collide on the first register row
   found.

## Out of scope

Bank feeds, XLS statement parsing, forward contracts, the sales-receipt per-row actions (all
already out of scope for the packages this follows up on); a settings screen for either the
cheque-due warning or the TDS section ledger requirement; fixing `currencyService.rateFor`'s
callers other than the one this package's own tests exercise (`realiseFxForPayment`) — the other
call sites (`grn-invoice.service.ts`, `sales-invoice.service.ts`, `fx.service.ts`) run at
creation/restatement time, not from inside a payment's own nested transaction, so they were not
found to share this gap, and widening the audit was not this package's job.

## Acceptance

`apps/api/test/integration/banking-tds-followups.spec.ts` (9 tests): a payment with no `id`
posts a voucher whose `refDocId` fits 36 characters; a PDC that clears realises FX at the
clearing date and rate, with both dates recorded on the voucher; a bounced-and-not-re-presented
cheque is skipped by the due warning while a re-presented one is labelled and an ordinary one is
warned normally; a supplier's TDS defaults round-trip and are invisible to a foreign tenant;
paying a challan for a section with no ledger code is refused, and the sections screen now
requires one; 206C(1H)'s threshold pools across two Customer rows sharing a PAN; `Product.isScrap`
round-trips and is invisible to a foreign tenant; two cheque payments on one bill sharing a
re-typed cheque number stay distinguishable by date; and a permission refusal on the supplier
TDS-default fields. Existing `banking.spec.ts`, `banking-fx-settlement.spec.ts`,
`sales-receipts.spec.ts`, `tds.spec.ts`, `tds-documents.spec.ts`, `scheduled-work.spec.ts`,
supplier and product specs, and the route/leak snapshots all still pass unmodified.
