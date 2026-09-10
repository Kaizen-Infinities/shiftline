# P1-11 — E-invoice (FI1)

## Why

Every B2B tax invoice, credit note and debit note of a business above the e-invoicing threshold
must carry an IRN and signed QR from the Invoice Registration Portal before it is valid; above
₹10 crore the IRN must be raised within 30 days. Shiftline raises it from the branch GSTIN,
prints it on the document and refuses to cancel a document in the books while its IRN is live.

## Scope

- `EInvoiceConfig` per tenant: provider (`FIXTURE` | `GSP`), on/off, `applicableFrom`,
  `aatoCrore`, GSP base URL and credentials (secrets AES-256-GCM encrypted, write-only).
- `EInvoice` per document (audited, RLS): `docType` INV/CRN/DBN, `docId`, `docNo`, `docDate`,
  seller and buyer GSTIN, status PENDING → GENERATED | FAILED, → CANCELLED; the request as
  sent (schema 1.1), IRN, ack no/date, signed invoice and QR, e-way bill fields when the portal
  returns them, error and attempts, cancellation reason/remarks.
- `EInvoiceProvider` interface (`generate`, `cancel`, `verify`); `FixtureProvider` (the
  portal's IRN formula, deterministic ack, unsigned QR marked `fixture.`, the portal's refusals
  for mismatched seller, self-supply, empty items, unbalanced totals, double cancel); `GspProvider`
  over axios (auth token cache, NIC error envelope mapping, retryable vs terminal).
- Payload builder: seller from the issuing business place's GSTIN else the company; buyer from
  the document's GSTIN snapshot else the master; Ship-to from the invoice's shipping address;
  lines with HSN, UQC unit, rates and split as posted; `RefDtls` on notes; supply type mapping
  (B2B, SEZWP, EXPWP, DEXP).
- Service: applicability (enabled, B2B, applicable-from, 30-day deadline when AATO ≥ 10 crore);
  `request()` records the row and runs on the worker (`gst.e-invoice` queue, retries with
  backoff) or inline; idempotent per document; `cancel()` within 24 hours of the ack with a NIC
  reason code and remarks; `assertDocumentCancellable()` wired into invoice, sales return and
  purchase return cancellation; notifications on terminal failure.
- Routes `/api/e-invoice`: settings GET/PUT/verify, cancel-reasons, list, document lookup,
  applicability, generate, get, cancel. Permissions `e-invoice.{view,generate,cancel,settings}`
  (feature `gst-compliance`, on Growth and Enterprise; Accounts role holds all four).
- PDF: IRN, ack and QR block on the tax invoice. Web: `EInvoicePanel` on the invoice view,
  `/compliance/e-invoices` register, `/settings/e-invoice`.

## Out of scope

A live GSP sandbox run (credentials pending); e-way bill generation from the IRN (P1-12); QR on
credit and debit note PDFs (they have no PDF template yet); bulk generation.

## Acceptance

- `e-invoice.spec.ts`: settings round-trip with encrypted, masked secrets; GSP needs credentials;
  IRN for a B2B invoice with the expected payload; idempotency; books guard (`IRN_LIVE`);
  cancel with reason, double cancel refused, redraft refused; B2C refused; 30-day window
  refused; 24-hour cancel window refused; credit note IRN with the invoice reference; UQC map.
- Leak suite sweeps the new routes; `EInvoice`, `EInvoiceConfig` in the model sweep list.
