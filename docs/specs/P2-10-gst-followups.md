# P2-10 — GST and MSME follow-ups

## Why

The GSTR-2B reconciliation (P1-13c) names, per supplier, which documents are `MISSING_IN_2B`
(the supplier never filed) or `MISMATCH` (filed differently) — but nothing sends the supplier a
message about it, and the 7-day / ₹1 matching tolerances are constants rather than something an
accountant can tune per tenant. Separately, the MSME section-15 clock (P1-07) only watches GRN
invoices; a supplier expense against a micro or small business carries the same 15/45-day
deduction risk and is invisible to the report, and nobody is warned when a payment run is about
to make a small supplier's bill go overdue.

## Scope

- `SupplierFollowUp` (RLS, not audited — operational, not a book): one row per message sent from
  the 2B workbench, naming the channel, the records it referenced, the recipient, the composed
  message and whether it went. `Gstr2bSettings` (RLS): per-company `dateToleranceDays` (default 7) and `valueTolerance` (default ₹1), read by `gstr2bService.reconcile` in place of the
  constant `DEFAULT_TOLERANCE` whenever the caller does not pin one explicitly.
- `POST /api/gst-returns/gstr2b/:period/follow-up` and a `/preview` twin: `{ supplierGstin |
supplierId, channel: "WHATSAPP" | "EMAIL", recordIds[] }`, where a `recordId` is a
  `Gstr2bRecord` uuid (a mismatch) or `DOCTYPE:docId` (a book document the supplier never
  filed). Composes one message naming every record (number, date, taxable value, and what
  differs for a mismatch), sends it through a fixture-safe channel provider, and refuses when
  the supplier has no phone (WhatsApp) or email on file for the chosen channel.
  `GET`/`PUT /api/gst-returns/gstr2b/settings` behind `gst-returns.{view,prepare}`. The
  reconciliation response carries the latest follow-up per supplier GSTIN.
- `msmeService.bills()` gains a second source: `Expense` rows with a `supplierId` against a
  MICRO/SMALL supplier, on the same 15/45-day clock from the expense date, "paid" the day it is
  approved. Every row now carries `source: "GRN" | "EXPENSE"`; the disallowance report and Form
  1 pick both up for free since they are built from `bills()`.
- `msmeService.paymentWarning(supplierId?)`: for a micro/small payee, the payee's own bills due
  within 5 days or overdue; otherwise a count and amount of small-supplier bills about to breach
  across the tenant. `GET /api/msme/payment-warning` (`payable.view`); the payment voucher
  response and the payment voucher form show it as a warning, never a block.
- Web: a follow-up panel on the 2B workbench (pick a supplier's missing/mismatched records,
  channel, preview, send) with a last-sent column; a tolerance settings panel; a source column
  on the MSME clock table; a warning banner on the payment voucher form.

## Out of scope

Rewriting the ITC ledger from 2B; a live WhatsApp/GSP/SMTP send in tests (fixture provider);
section 16 interest; blocking a payment because a bill is about to breach.

## Acceptance

`apps/api/test/integration/gst-followups.spec.ts`: a follow-up sends (fixture) and is recorded
and shown on the reconciliation; refused with no contact detail on file; tolerance settings turn
a MISMATCH into MATCHED and back; an expense against a small supplier appears in the MSME report
with `source: "EXPENSE"` and alerts at day 30 (15-day clock, 2 days left); the payment warning
names the right bills for a small payee and a count for a large one; permission refusal;
cross-tenant. Existing `gstr2b`, `ims`, `msme`, `expense` and `vouchers` suites still pass.
