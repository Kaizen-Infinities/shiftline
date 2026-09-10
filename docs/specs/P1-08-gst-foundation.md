# P1-08 — GST and document foundation

**Goal.** Every tax document Shiftline produces carries the data GST needs (HSN, place of supply,
the registration status of both parties, the GSTIN it is raised from) and computes CGST/SGST/IGST
from state codes rather than state names, so e-invoicing (P1-11), e-way bills (P1-12) and returns
(P1-13) can be built on top without touching the documents again.

Delivered in parts; this spec grows with each.

## Part A — GST masters (2026-09-07)

**Reference data** (`@shiftline/shared`): `GST_STATES` (37 codes), `isValidGstin` (format, state
and mod-36 check digit), `stateCodeOfGstin`.

**Models** (tenant-scoped, RLS, audit triggers; migration `20260907050000_gst_masters`):

- `HsnCode`: code (4/6/8 digits), type HSN or SAC, description, default `gstRate`, `cessRate`,
  active. Unique per tenant. Provisioning seeds a starter list of 55 codes a manufacturer meets
  first (polymers and plastic articles, packaging, paper, metals, chemicals, machinery and spares,
  utilities, common services) with the schedule rates in force; tenants edit and extend it.
- `GstRate`: slab name, rate, cess, active; unique per tenant on (rate, cess). Seeded with the
  statutory slabs 0, 0.25, 3, 5, 12, 18, 28.
- `Company.gstRegistrationType` (REGULAR, COMPOSITION, UNREGISTERED, SEZ, OVERSEAS, UIN) and
  `Company.stateCode` replace the onboarding setting; `BusinessPlace.gstin` for branch
  registrations (the head office carries the company GSTIN; the state code stays in
  `gstPlaceCode`).
- `Customer.gstRegType` (default UNREGISTERED) and `Customer.stateCode`; `Supplier.gstRegType`
  converted from free text to the enum in place (existing "Regular"/"Composition" values kept,
  the rest inferred from the GSTIN). Backfill sets REGULAR and the state code wherever a GSTIN
  exists.
- `Product.hsnCodeId` + `Product.gstRate` (override), `RawMaterial.hsnCodeId` + `gstRate`.
  `gstService.rateForItem()` resolves item override → HSN default → fallback.

**Rules on parties.** A GSTIN is validated with the check digit on create and update; it fixes the
state code (a conflicting `stateCode` is a 400) and implies REGULAR unless another type is given.
Without a GSTIN the state code comes from the address state name; the type defaults to
UNREGISTERED. Supplier registration types accept legacy casing ("regular").

**API** (`/api/gst`, permission module `gst_tax` except the two reference routes):
`GET /states`; `POST /validate-gstin` (valid, state, PAN, entity type, registration count);
`GET/POST /rates`, `PUT/DELETE /rates/:id` (delete deactivates); `GET /hsn?search&type&limit`,
`GET /hsn/lookup/:code` (an 8-digit code inherits its 6- or 4-digit parent's rate), `POST /hsn`,
`PUT /hsn/:id` (code immutable), `DELETE /hsn/:id` (deactivates when products or materials use
it). CSV import type `hsn` (code, type, description, gstRate, cessRate).

**Tests.** `gst.spec.ts` (5): seeded slabs, starter list, SAC filter, prefix lookup, state table;
GSTIN validation; HSN create/duplicate/short code/update/import/soft and hard delete plus
`rateForItem`; customers and suppliers derive type and state, reject bad or conflicting GSTINs;
permission. 141 API tests.

## Part B — GST on documents (2026-09-07)

### Where a document is issued from, and to where

Every tax document records the **business place** it is raised from (`businessPlaceId`), the
**place of supply** (GST state code of the recipient) and the **supply type**:

| `SupplyType`    | When                                                 | Tax                          |
| --------------- | ---------------------------------------------------- | ---------------------------- |
| `INTRA_STATE`   | issuing place and place of supply share a state code | CGST+SGST                    |
| `INTER_STATE`   | different state codes                                | IGST                         |
| `EXPORT`        | recipient registered as `OVERSEAS`                   | IGST (LUT handling in P1-14) |
| `SEZ`           | recipient registered as `SEZ`                        | IGST                         |
| `DEEMED_EXPORT` | reserved for P1-14                                   | IGST                         |

`gst.calc.ts` holds the pure functions: `supplyTypeFor()`, `splitGst()` (paisa-rounded, SGST takes
the rounding remainder), `canChargeGst()` and `salesDocumentTypeFor()`. `gst.context.ts` resolves
the issuing place (payload id → head office → first active place → the company's own state code and
GSTIN), the company's registration profile, and the HSN/rate defaults of products and raw materials.
The state-name comparison in the sales-invoice and GRN services is gone.

### Rates and HSN per line

A line's GST rate is the payload's, else the item's own `gstRate`, else its HSN's rate, else 0. The
HSN code is copied onto the line (`hsnCode`) so later rate changes on the master do not rewrite
history. Cess follows the HSN (`cessRate`, `cessAmount`) and is totalled on the document
(`cessTotal` on sales invoices, `totalCess` on GRNs).

### Document types and numbering

`SalesInvoice.documentType`: `TAX_INVOICE`, `BILL_OF_SUPPLY` (company registered as composition or
not registered: every rate is forced to zero) or `EXPORT_INVOICE`. Numbers come from
`documentNumberService.next(docType, { date, businessPlaceId, tx })`, backed by `DocumentSequence`
rows per tenant, type, branch and financial year: `INV/2026-27/0001`, branch series
`INV-F1/2026-27/0001`. `peek()` shows the next number without consuming it. Series exist for
SALES_INVOICE, BILL_OF_SUPPLY (`BOS`), EXPORT_INVOICE (`EX`), GRN, SALES_RETURN (`SR`),
PURCHASE_RETURN (`PR`), CREDIT_NOTE (`CN`), DEBIT_NOTE (`DN`), DELIVERY_CHALLAN (`DC`) and the
voucher types. A client may still send its own `invoiceNo`; when blank the series is used. GRNs
always take the series (the supplier's own number stays in `invoiceNo`).

### Credit and debit notes

A sales return raises `SalesReturn.creditNoteNo` from the CREDIT_NOTE series; a purchase return
raises `PurchaseReturn.debitNoteNo` from the DEBIT_NOTE series. Both carry the tax split
(`cgst/sgst/igstAmount` on the header and lines, HSN per line) mirrored from the original document
when one is referenced (same branch, place of supply and supply type; rates from the invoice or GRN
lines) and the party's GSTIN. `kind = PRICE_ADJUSTMENT` records a value correction without moving
stock or writing a stock adjustment. Over-returning an invoice line is refused.

### Reverse charge

`GrnInvoice.reverseCharge` (payload flag) means the supplier's bill carries no tax: `netAmount`
excludes GST and cess, the tax is still computed per line, and the purchase voucher posts
`Dr RCM-REC-001 / Cr RCM-LIA-001` for it. A composition or unregistered supplier's GRN carries no
tax unless reverse charge is on. Expenses carry the same flag.

### Expenses and petty cash

`Expense` gains `vendorGstin`, `hsnCode`, `taxableAmount`, `gstRate`, `cgst/sgst/igstAmount`,
`supplyType`, `reverseCharge`, `itcEligible`, `tdsSection`, `tdsRate`, `tdsAmount`,
`businessPlaceId`. `amount` remains the bill total; the taxable value is derived (net of GST under
forward charge, the full amount under reverse charge) and TDS from the rate when not given.
`PettyCashEntry` gains `vendorGstin`, `hsnCode`, `gstRate`, `taxAmount`, `tdsAmount`,
`businessPlaceId`; input credit is claimed only when a vendor GSTIN is present.

### Postings (`voucherPosting.service.ts`)

| Document                     | Debit                                                                   | Credit                                                    |
| ---------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Sales invoice                | Customer (grand total)                                                  | SALES-001, CGST/SGST/IGST-LIA, CESS-LIA                   |
| GRN (forward charge)         | PURCH-001, CGST/SGST/IGST-REC, CESS-REC                                 | Supplier (net)                                            |
| GRN (reverse charge)         | PURCH-001 (net), RCM-REC (tax+cess)                                     | RCM-LIA (tax+cess), Supplier (net)                        |
| Sales return / credit note   | SRT-001 (taxable), CGST/SGST/IGST-LIA (tax reversed)                    | Customer (grand total)                                    |
| Purchase return / debit note | Supplier (grand total)                                                  | PRT-001 (taxable), CGST/SGST/IGST-REC (ITC reversed)      |
| Expense                      | EXP-001 (taxable, or taxable+GST when ITC is blocked), REC or RCM-REC   | TDS-LIA-001, RCM-LIA, Cash/Bank/Petty cash (amount − TDS) |
| Petty cash OUT               | EXP-001 (amount − GST when a GSTIN is given), REC split by vendor state | TDS-LIA-001, PCASH-001 (amount − TDS)                     |

Every voucher carries `businessPlaceId` from its document. New system ledgers: `RCM-LIA-001`,
`RCM-REC-001`, `CESS-LIA-001`, `CESS-REC-001`, `TDS-LIA-001` (added by `ensureSystemLedgersExist`
for existing tenants).

### Schema and migration

Enums `SupplyType`, `SalesDocumentType`, `ReturnKind`; columns listed above on sales_invoices,
sales_invoice_items, grn_invoices, grn_invoice_items, sales_returns, sales_return_items,
purchase_returns, purchase_return_items, vouchers, goods_dispatches, expenses, petty_cash_entries;
migration `20260907060000_gst_documents` (no new tables, so no RLS or audit changes).

### Tests

`test/integration/gst-documents.spec.ts` (9): series numbering per type/FY/branch and `peek`;
intra-state tax invoice with HSN and rate from the product and its voucher; inter-state IGST with
payload overrides; composition company → bill of supply from the `BOS` series with zero tax; GRN
under reverse charge (net excludes tax, RCM voucher, next-number endpoint); sales return → credit
note mirroring the invoice split, over-return refused; purchase return → debit note, price
adjustment leaves stock alone, goods return deducts; expense with ITC and TDS, reverse-charge
expense, blocked credit, invalid GSTIN refused; petty cash with and without a vendor GSTIN.

## Part C — web (2026-09-07)

### Screens

- **Configuration → GST & HSN** (`/settings/gst`, permission `gst_tax.view`): two tabs. _HSN / SAC
  codes_: search by code or description, filter by type, show inactive, add/edit (code, type,
  description, GST rate from the active slabs, cess), remove (deactivates when products or materials
  use the code), reactivate. _GST slabs_: list with add/edit/deactivate/reactivate. Service
  `services/gstService.ts`.
- **Company settings → Places of business**: each place shows code, name, type, an editable GST
  state and GSTIN (head office reads the company GSTIN; a branch GSTIN fixes its state). Saved with
  the company form through `PUT /companies/:id` (`businessPlaces[].gstin` now accepted).
- **Onboarding → GST step**: a "Branch GSTIN" per non-head-office place (validated with the check
  digit; blank means the branch bills under the head office GSTIN); the review step lists it.

### Documents

- **Sales invoice form**: the supply type comes from the customer's state code (or GSTIN, or state
  name as a last resort) against the company's; a badge shows _Tax Invoice / Bill of Supply / Export
  Invoice · intra/inter state_. Lines carry an editable HSN column filled from the product master;
  the line rate defaults to the product's own rate, else its HSN's. A composition or unregistered
  company sees zero tax. New invoices no longer send a client-computed number: the form shows the
  series' next number from `GET /documents/next-number` and the server assigns it on save.
- **GRN form**: supply type from the supplier's state code against the company's; HSN column filled
  from the raw material; a _Reverse charge_ switch (net payable then excludes GST); the GRN number
  shown is the series peek.
- **Printed invoice / GRN**: title from `documentType`, Place of Supply, Reverse Charge yes/no, HSN
  column; the CGST/SGST vs IGST columns follow the stored `supplyType`.
- **Returns**: a _Kind_ selector (goods return / price adjustment) on both forms; lists and detail
  modals show the credit/debit note number, the kind and the GST amount.

### API additions in this part

`GET /api/documents/next-number?docType=&businessPlaceId=&date=` (authenticated; `peek` of the
series). Product and raw-material list/detail responses include `hsnCode { id, code, gstRate,
cessRate }`. `businessPlaceSchema` accepts `gstin`.

### Browser tests

`e2e/smoke.spec.ts` adds `/settings/gst`; the onboarding flow picks "Regular" before the GSTIN
(18 browser tests).
