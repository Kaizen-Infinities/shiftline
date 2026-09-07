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

## Part B — GST on documents (planned)

`businessPlaceId` and `placeOfSupply`/`supplyType` on sales invoices, GRNs, returns, vouchers and
dispatches; CGST/SGST/IGST split from state codes (replacing the state-name comparison in the
sales-invoice and GRN services); HSN on every line; document numbering through `DocumentSequence`
per type, branch and financial year; GST-compliant credit and debit notes generated from returns
and adjustments with the original invoice reference; reverse charge with RCM liability and ITC
ledgers on purchases and expenses; GST and TDS fields on expenses and petty cash.

## Part C — web (planned)

HSN and GST slab screens under Configuration; GSTIN per place in company settings and the
onboarding GST step; invoice and GRN forms showing HSN and the computed split.
