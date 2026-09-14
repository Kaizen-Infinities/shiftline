# P2-12 — Expense and sales-invoice forms: TDS/TCS toggles, cheque and settlement receipts

## Why

P2-05 made supplier expenses accept `deductTds` and sales invoices accept `collectTcs` /
`tcsSectionCode`; P2-06 made sales invoices accept cheque and settlement-rate fields on receipts
but left no way for a person to record a receipt against a sales invoice by hand (create/update
always writes `payments: []`). None of this reached a screen.

## Scope

- Expense form (`Expensescreate.tsx`): a "Deduct TDS" toggle, a section picker fed from
  `GET /api/tds/sections`, and a live preview (rate, amount, net payable) from
  `POST /api/tds/preview`, debounced on section/amount/supplier/date. The expense view modal
  shows the deduction (section, rate, amount, net) once one exists.
- Sales invoice form (`SalesInvoiceCreate.tsx`): a "Collect TCS" toggle with a section picker
  (TCS sections only), defaulting to the scrap section 206C(1) the first time the invoice carries
  a line whose product name matches "scrap" and that section exists — there is no dedicated
  "is scrap" flag on the item master to key off instead. A live preview from the same
  `/tds/preview` endpoint feeds the TCS line in the totals and the "Full Amount"/closing-balance
  figures. The view page shows the TCS line in the printed totals.
- `POST /api/sales-invoices/:id/receipts` (permission `sales-invoices.edit`, matching the edit
  permission that gates a GRN invoice's own payments array) and
  `GET /api/sales-invoices/:id/receipts` (`sales-invoices.view`): amount, date, instrument
  (cash/bank/cheque with number, date, bank, drawer), and for a foreign-currency invoice a
  settlement rate (defaulted from the rate table when omitted). It appends to the invoice's
  `payments` array, mirrors a `SalesInvoicePayment` record the way the payment-gateway capture
  path does, and posts through the existing `postReceiptVouchersForSales` (P2-06) so the cheque
  register row and FX realisation happen exactly as they do for any other receipt. Refuses an
  amount over the outstanding balance (`OVER_RECEIPT`) and a cancelled invoice
  (`INVOICE_CANCELLED`).
- A "Record Receipt" dialog on the sales invoice view page (cash/bank/cheque fields, a
  settlement-rate field for a foreign-currency invoice) and a receipts list showing each
  receipt's cheque status (IN_HAND/DEPOSITED/CLEARED/BOUNCED) via `GET .../receipts`, which joins
  the payments array against `Cheque` rows by `sourceDocId`/`refDocId`.
- Client-side validation mirrors the zod schemas; `en-IN` formatting; Tailwind; no new sidebar
  screen or route (both forms and the dialog are additions to existing screens).

## Out of scope

The GRN invoice form (P2-11's own scope). Bank feeds and statement import. Merging TCS threshold
tracking across more than one Customer row for the same real buyer (a pre-existing P2-05 gap).

## Acceptance

- `sales-receipts.spec.ts`: a cash receipt posts the voucher and reduces the outstanding; a
  cheque receipt creates the cheque register row; a post-dated cheque does not post until
  cleared; a receipt against a USD invoice at a different rate posts the realised difference;
  over-receipt refused; a cancelled invoice refused; permission refusal; cross-tenant isolation.
- Typecheck, lint, web build green; `sales-invoice`, `tds-documents`, `banking-fx-settlement` and
  `gst-documents` specs still pass.
