# P2-12 — Expense and sales-invoice forms: TDS/TCS toggles, cheque and settlement receipts

## Shipped

- **Expense form** (`Expensescreate.tsx`): a "Deduct TDS" checkbox and a section dropdown fed
  from `GET /api/tds/sections`; a debounced live preview from `POST /api/tds/preview` shows the
  rate, the TDS amount and the net payable (or the threshold reason when nothing is due yet). The
  section and checkbox lock once an expense already carries a deduction (editing does not
  re-preview it). The view modal (`ExpensesList.tsx`) shows a "TDS Deducted" section — section,
  rate, amount, net payable — whenever `tdsAmount > 0`.
- **Sales invoice form** (`SalesInvoiceCreate.tsx`): a "Collect TCS" checkbox with a section
  dropdown (TCS sections only), a live preview from the same `/tds/preview` endpoint, and a TCS
  line folded into the "Full Amount" and the customer balance summary. The section defaults to
  206C(1) — the scrap section — the first time an invoice line's item name matches `/scrap/i` and
  that section exists; the item master has no dedicated "is scrap" flag to key off instead, so
  this is a name-based heuristic rather than data-driven, and only fires once (a user who clears
  the section is not fought on it again). The view page (`SalesInvoiceView.tsx`) prints a TCS row
  in the totals table when `tcsAmount > 0`.
- **`POST /api/sales-invoices/:id/receipts`** (`sales-invoices.edit`) and
  **`GET /api/sales-invoices/:id/receipts`** (`sales-invoices.view`) — the endpoint P2-06's
  hand-off flagged as missing. Takes amount, date, instrument (cash/bank/cheque with number,
  date, bank, drawer) and, for a foreign-currency invoice, a settlement rate (defaulted from the
  rate table when omitted). It appends to `SalesInvoice.payments`, writes a mirrored
  `SalesInvoicePayment` row the way the payment-gateway capture path already does, and posts
  through the existing `postReceiptVouchersForSales` (P2-06) inside the same transaction — so the
  cheque register row and any FX realisation happen exactly as they do for any other receipt,
  with no new posting logic. The GET joins the payments array against `Cheque` rows by
  `sourceDocId`/`refDocId` so each receipt carries its cheque status.
- Refusals: an amount over the outstanding balance (`OVER_RECEIPT`, 400) and a receipt against a
  cancelled invoice (`INVOICE_CANCELLED`, 409). No schema changes were needed — `payments`,
  `SalesInvoicePayment` and `Cheque` already had every column this needed from P1-21/P2-06.
- **Web**: a "Record Receipt" dialog on the sales invoice view page (cash/bank/cheque fields, a
  settlement-rate field only shown for a foreign-currency invoice) and a receipts table beneath
  the action buttons showing date, method, reference, cheque status and amount, with a
  received/outstanding summary. `salesInvoiceService.recordReceipt`/`fetchReceipts` added.
- `apps/api/test/integration/sales-receipts.spec.ts` (8 tests): cash receipt posts the voucher
  and reduces the outstanding; cheque receipt creates the register row; a post-dated cheque does
  not post until `PUT .../status {CLEARED}`; a USD invoice receipt at a different settlement rate
  posts the realised FX gain exactly once; over-receipt refused; cancelled-invoice refused;
  permission refusal (`demo.production`, which has no `sales-invoices.*` key); cross-tenant (a
  foreign invoice id 404s on both the POST and the GET, and its `payments` array is untouched).

## Decisions worth knowing

- **The over-receipt check compares in the invoice's own currency, not always in rupees.** A
  first cut compared the receipt amount straight against `grandTotal` in rupees, which refused a
  legitimate USD-invoice receipt: $1,000 booked at ₹83 (grandTotal ₹83,000) settling at ₹84 is
  ₹84,000 actually received — more rupees than the invoice's own INR figure, but not a rupee over
  what was owed in dollars. For a foreign-currency invoice the check now converts every payment
  (this one and every prior one, each at its own settlement rate) back to the invoice's foreign
  currency and compares against `foreignTotal`, with a rupee of slack per unit of rate to absorb
  rounding. A rupee invoice's check is the simple straight comparison.
- **The receipts endpoint reuses `postReceiptVouchersForSales` rather than posting its own
  voucher.** That function already knows how to skip an already-posted payment, register a
  cheque, decide whether a cheque is post-dated, and call `fxService.realise` — writing a second
  posting path for a hand-entered receipt would have meant keeping two copies of that logic in
  sync. The new endpoint's whole job is building the right entry for `payments[]` and letting the
  existing function do the rest, exactly like the payment-gateway capture path in
  `payments.service.ts` already does.
- **The scrap-section default is a name match, not an item-master flag**, because no such flag
  exists (`ItemCategoryType` has `WASTAGE`, not `SCRAP`; `Product` has no boolean at all). Adding
  one was out of scope for a forms package — it would mean a migration, a field on every item
  master screen, and touching however many places already read `ItemCategoryType`. The heuristic
  is deliberately narrow (checked once, never fights a user's own choice) so it degrades to "the
  user picks the section themselves" rather than mis-defaulting silently.
- **`sales-invoices.edit` gates the write, `sales-invoices.view` the read** — by analogy with a
  GRN invoice's own payments array, which sits inside its `PUT` route under the purchase module's
  edit-level access (`requireFeature("purchase")` there; the sales-invoice module already uses
  `requirePermission` throughout, so the direct analogue is its own `edit` key rather than
  `receivable.*`, which no other sales-invoice route touches).

## Half-done / known gaps

- The TCS section default only looks at the product's own name for "scrap"; a scrap sale whose
  line item is named something else (a component code, say) will not auto-select the section —
  the picker is still there, just not pre-filled.
- The GRN invoice form still has no cheque-instrument fields (P2-06's own known gap) and remains
  out of scope here — P2-11 owns that file.
- `SalesInvoicePayment.paymentMethod`/`referenceNumber` are truncated to 50/100 characters to fit
  the column, same as the existing gateway-capture path; the JSON `payments[]` entry itself is
  not truncated.
- The receipts list on the view page is a flat table (no per-row actions yet, e.g. marking a
  cheque deposited from here) — that lives on the existing banking/cheque-register screen
  (`BankReconciliationPage.tsx`), which already lists every cheque including these.

## Next

Nothing in the Phase 2 plan depends on this directly. A natural follow-up: a supplier-default TDS
section (P2-05's own noted gap) would let the expense form's section picker pre-fill instead of
starting blank every time.

## Blocked on you

Nothing — no new account or credential.

## Changelog sentence

Expense and sales-invoice forms now offer TDS/TCS with a live preview before you save, and a
sales invoice's view page can record a cash, bank or cheque receipt by hand — with the same
cheque register and foreign-exchange handling every other receipt already gets.
