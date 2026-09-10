# P1-13b — GSTR-3B and the input tax credit ledger (FI3)

## Why

GSTR-1 tells the portal what was sold; GSTR-3B is what the company actually pays. It needs a
credit side the books can defend: which inward document brought how much credit, whether the
credit may be taken at all (section 17(5)), whether it had to be given back because the supplier
was not paid within 180 days (rule 37), and whether it came back when the bill was finally
settled. That ledger is `ItcEntry`, whose table landed with the schema commit; this package fills
it and builds the return on top of it.

## Scope

- `itcService`: rebuilds `ItcEntry` for a month and GSTIN from the inward documents carrying GST
  — GRN invoices, expenses and petty cash entries — one row per document, keyed
  `[companyId, docType, docId]`, updated in place and never deleted. Each row carries the credit
  split, the source (`RCM`, `IMPORT_GOODS` from an OVERSEAS supplier, else `OTHER`), and an
  eligibility call: `INELIGIBLE` with rule `17(5)` for a blocked HSN or an expense flagged
  `itcEligible: false`, `VOID` with rule `CANCELLED` for a cancelled document, otherwise
  `ELIGIBLE`. A manual classification (`manualStatus`) survives every rebuild.
- Rule 37 in the same service: an entry whose bill is still unpaid 180 days after the document
  date, measured at the end of the period being built, becomes `REVERSED` with rule `180D` and
  `reversedPeriod` set to that period; when the bill is later paid the row becomes `RECLAIMED`
  with `reclaimedPeriod`. Payment comes from `GrnInvoicePayment` rows dated on or before the
  period end, against `netAmount`. The period a reversal or reclaim _lands in_ is the period
  stamped on those two columns, not the availment month — that is what tables 4B(2) and 4D(1)
  read.
- `gstr3bService.build(period, gstin)`: tables 3.1 (a taxable, b zero-rated, c nil/exempt,
  d inward reverse charge, e non-GST), 3.1.1, 3.2 (inter-state supplies to unregistered,
  composition and UIN holders, by place of supply), 4 (A available by source, B reversed,
  C net, D ineligible), 5 (exempt/nil/non-GST inward) and 6.1 (payment of tax with the
  set-off order and the cash payable). Outward figures come from the same documents GSTR-1
  reads, net of credit notes; the credit side comes only from the ITC ledger.
- Set-off order in 6.1 per sections 49A/49B: IGST credit against IGST, then CGST, then SGST;
  CGST credit against CGST then IGST; SGST credit against SGST then IGST; cess against cess.
  Reverse-charge liability is never set off against credit — it is a cash row.
- Register the month on the filing gate as `GSTR3B` with the hash of the tables;
  `filed` only through `filingApprovalService.assertSubmittable`. Routes next to GSTR-1 under
  `/api/gst-returns` behind the existing `gst-returns.{view,prepare,file}` permissions.

## Out of scope

Rules 42/43 proportional reversal (needs an exempt-turnover ratio the books do not carry yet);
import of goods and services as their own 4A(1)/4A(2) rows beyond the OVERSEAS classification
(P1-17 owns customs duty and IGST on imports); ISD credit (no ISD registration is modelled);
supplies under section 9(5) by an e-commerce operator (3.1.1 is computed as zero and labelled);
the portal JSON and the GSTR-3B web screen (P1-13c/d); GSTR-2B matching (P1-13c).

## Acceptance

- `gstr3b.spec.ts`: a golden-file month — a taxable intra-state GRN, an inter-state GRN, a
  blocked-HSN expense, a reverse-charge expense, an overseas supplier, a petty cash bill with
  GST, a sales invoice each of B2B inter-state, B2CS intra-state and an export, and a credit
  note — produces exact values in every table; the set-off is asserted head by head against a
  hand-computed answer; a bill unpaid for more than 180 days reverses in the right period and
  reclaims in the period it is paid; a manual classification survives a rebuild; a cancelled
  document leaves a VOID row and drops out of table 4.
- Permission refusal, an invalid period and a foreign `companyId` returning nothing are covered;
  the filing gate refuses to file until approved and voids the approval when a document changes.
- `ItcEntry` is in the model sweep list of the leak suite and in `AUDITED_MODELS` (both landed
  with the schema); the route snapshot is refreshed.
