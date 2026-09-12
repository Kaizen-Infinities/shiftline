# P1-13c — GSTR-2B and the Invoice Management System

## Why

The credit ledger P1-13b built is computed from the company's own books, and the books are not
what the government pays credit against: from October 2025 the portal's GSTR-2B is generated
from what the _supplier_ filed, and every inward record now has to be accepted, rejected or left
pending on the Invoice Management System before 2B is drawn. A record left unactioned defaults
to accepted, so silence is a decision — and a supplier who filed late, filed a different value,
or did not file at all is a credit the company cannot take, whatever its own purchase register
says. The reconciliation between the two is the month's real work, and it has a deadline: IMS
actions must be pushed before the 14th.

## Scope

- `Gstr2bRecord` (audited, RLS): one row per supplier document in a 2B — supplier GSTIN and
  trade name, document type (`INV | CRN | DBN | ISD | IMPG | IMPS`), number, date, value, the
  tax split, place of supply, reverse charge, the ITC-availability flag the portal sets, the
  filing period and date the supplier filed in, the 2B period it was drawn for, and the raw
  record. Unique per `[companyId, period, supplierGstin, docType, docNo]`.
- `ImsAction` (audited, RLS): the company's call on one record — `ACCEPTED | REJECTED | PENDING`
  with a reason, who made it, when it was pushed and what the portal said. `PENDING` is a real
  state and it expires: a record still pending when the return is drawn is accepted by default,
  and the service says so rather than letting it pass silently.
- `Gstr2bProvider` (`fetch2b(period)`, `pushImsActions(actions)`, `verify`) behind the same
  shape as `modules/e-invoice/providers`: a fixture provider that generates a 2B from the
  tenant's own purchase register with deliberate mismatches, and a GSP adapter sharing the
  encrypted credentials already in `EInvoiceConfig`. Plus a file import for the JSON the
  accountant downloads from the portal, so the package is useful before any GSP exists.
- Reconciliation against the purchase register for the period: match on supplier GSTIN,
  normalised document number (case, spaces, leading zeros and the `/`-`-` noise removed), date
  within a tolerance and taxable value within a tolerance, both configurable. Outcomes
  `MATCHED`, `MISMATCH` (carrying which fields differ and by how much), `MISSING_IN_2B` (in the
  books, not filed by the supplier) and `MISSING_IN_BOOKS` (filed against the company, not
  recorded). Bulk rules: accept every exact match, accept mismatches inside a tolerance, keep
  the rest for a person.
- Supplier follow-up on `MISSING_IN_2B` and `MISMATCH` through the existing WhatsApp and email
  services, one message per supplier listing the documents, never one per document.
- The ledger: the reconciliation reports the two credit positions side by side — what the portal
  offers and what the books claim — so the gap is visible before filing. Drawing table 4(A)(5)
  from the portal rather than from the books is a change of filing policy, not a refactor, and
  it waits for the accountant's answer to the open question already recorded against P1-13b.
- Routes `/api/gst-returns/gstr2b` (import, fetch, list, summary), `/api/gst-returns/ims`
  (list, act, bulk act, push, status) on the existing `gst-returns.{view,prepare,file}`
  permissions, with the push registered on the filing gate as `IMS`.
- A pg-boss job that warns holders of `gst-returns.prepare` when the 14th is near and records
  are still pending, once per period.

## Out of scope

GSTR-2A (superseded by 2B for credit); amendment records (`CDNRA`, `B2BA`) beyond storing them;
the portal's own "recompute 2B" call; automatic acceptance of anything — the default that the
portal applies to a pending record is reported, never simulated as a decision the company made.

## Acceptance

- `gstr2b.spec.ts`: import of a portal JSON round-trips every record; a second import of the
  same period updates rather than duplicates; reconciliation produces one case of each outcome
  from a fixed purchase register, with the mismatch naming the field and the difference;
  number normalisation matches `INV/001` to `inv-1`; a value outside the tolerance is a
  mismatch, inside it is a match.
- `ims.spec.ts`: accept, reject with a reason (refused without one), bulk accept by rule, push
  through the fixture provider with the portal's acknowledgement stored, a pushed action not
  re-pushed, the pending-before-the-14th warning firing once per period, and the filing gate
  refusing a push until approved.
- Cross-tenant: a foreign `companyId` sees no records and cannot act on one; leak suite sweeps
  the new routes; the new models in the model sweep list.
