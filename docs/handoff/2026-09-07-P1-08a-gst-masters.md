# P1-08 part A — GST masters

## Shipped

- `HsnCode` and `GstRate` masters (RLS, audit), seeded per tenant by provisioning: statutory slabs
  and a 55-code HSN/SAC starter list with current schedule rates; `/api/gst` routes for slabs, HSN
  search/lookup/CRUD, GSTIN validation and the state table; CSV import type `hsn`.
- Registration type and state code on Company (replacing the onboarding setting), Customer and
  Supplier (column converted to the enum in place); GSTIN per business place; HSN and GST-rate
  override on products and raw materials with `gstService.rateForItem()`.
- GSTINs on parties are check-digit validated; state code and registration type derive from them.
- Migration `20260907050000_gst_masters`; 141 API tests (gst.spec.ts adds 5).

## Half-done / known gaps

- No web screens yet for HSN and slabs (Part C); the onboarding GST step's API accepts a GSTIN per
  place but the wizard form does not show the field yet.
- Documents still compute the tax split from state names and carry no HSN (Part B).
- The HSN starter list is a curated subset with schedule rates as of September 2026; rates change
  by notification, so the list is a starting point, not a source of truth.

## Next

- Part B: GST on documents (place of supply, state-code split, HSN on lines, numbering series,
  credit/debit notes, reverse charge, expense GST/TDS fields).

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
