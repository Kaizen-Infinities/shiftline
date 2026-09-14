# P2-05 — TDS and TCS on documents

## Why

P1-15 built the TDS/TCS engine — sections, the rate decision, challans, 26Q/27Q — but nothing
called it. A purchase bill did not offer to deduct, a sale did not offer to collect, no journal
was posted for either, and the `TDS-*`/`TCS-*` ledgers the section rows name were never created.
The liability lived only in the TDS module, disconnected from the books.

## Scope

- `TDS-<section>` / `TCS-<section>` payable ledgers, one per row of the section seed, added to
  `DEFAULT_SEED_LEDGERS` (`accounts.service.ts`) — created for every tenant on day one through
  `provisioningService.provisionTenant()` (which already calls `ensureSystemLedgersExist()`) and
  idempotently for existing tenants the next time any posting path runs it.
- GRN invoice and expense: the create body takes `tdsSectionCode` and `deductTds`. Sending the
  section alone returns a `tdsPreview` (the rate decision, not persisted); accepting it
  (`deductTds: true`) calls `tdsService.deduct`, which records a `TdsDeduction` row (at the
  206AB higher rate when the supplier is flagged) and posts its own journal — Dr supplier
  (reduces the payable) / Cr `TDS-<section>` — for the GRN; the expense keeps its existing
  single-voucher shape and simply credits the section's ledger instead of the generic
  `TDS-LIA-001` once a deduction is on file for it (untouched when a caller only types
  `tdsRate`/`tdsAmount` by hand, so the P1-15 behaviour keeps working). The bill's payable
  balance reflects the deduction: GRN's `paymentStatus` compares paid against
  `netAmount - tdsAmount`.
- Sales invoice: `collectTcs` and `tcsSectionCode`. Accepted, the invoice carries `tcsAmount`
  (added into `grandTotal`, so the receivable includes it), the sales voucher credits
  `TCS-<section>` instead of folding it into revenue, and a `TdsDeduction` row (`kind
ON_COLLECTION`, `customerId` instead of `supplierId` — the schema's `TdsDeduction` gained a
  `customerId` column and a threshold aggregate keyed off it) is recorded for the return and the
  206C(1H) buyer threshold. No PAN field exists on the customer master; it is derived from the
  GSTIN's characters 3–12 when present.
- Challan: `tdsService.payChallan` now also posts Dr `TDS-<section>` (summed per section across
  the deductions it covers) / Cr `BANK-001`, plus any surcharge/interest/late fee to `EXP-001`.
- Cancel: `tdsService.reverseForDoc(docType, docId, …)` cancels the `TdsDeduction` row(s) for a
  document and reverses their voucher (through `cancellationService`, like every other
  document). Wired into `cancelGrnInvoice`, `cancelExpense` and `cancelSalesInvoice`. The
  standalone `tdsService.cancel` (used by the deductions screen) does the same for one row.
- Web: the TDS sections table (`TdsPage.tsx`) is now editable inline — the endpoint already
  existed (P1-15), only the screen was read-only.

## Out of scope

The GRN, expense and sales-invoice forms do not yet show the preview/accept toggle in the UI —
the fields and response shape are ready, wiring three large existing forms was not done this
pass. 194Q/206C(1H) year-to-date threshold tracking is exact per payee (`supplierId` /
`customerId`) but does not merge across a payee later linked to more than one master row.
Correction statements, s.197 certificates and TRACES upload remain out (P1-15's own scope line).

## Acceptance

`apps/api/test/integration/tds-documents.spec.ts`: a bill over the threshold with a section
supplier deducts and posts the journal (voucher lines and ledger balances asserted);
under-threshold records a zero-amount row and posts no voucher; 206AB doubles the rate;
`deductTds: false` records nothing; a scrap sale (206C(1)) collects TCS and credits its ledger;
a challan posts Dr `TDS-<section>` / Cr `BANK-001`; cancelling a bill reverses its deduction and
voucher; a permission refusal on the sections endpoint; a cross-tenant deduction is invisible to
a foreign company. Existing `tds.spec.ts`, `gst-documents.spec.ts` (expense TDS on the generic
ledger, unaffected), and the accounts specs still pass.
