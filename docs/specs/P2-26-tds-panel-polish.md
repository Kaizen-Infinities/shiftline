# P2-26 — Supplier TDS panel visibility, TDS page ledger validation, explicit scrap include

## Why

The supplier form's TDS panel is only shown to a role with `tds.view`, so a role that edits
suppliers without TDS access never sees the three fields (`defaultTdsSectionCode`,
`deducteeType`, `higherRate206AB`). The TDS section's now-required ledger code (P2-17)
surfaces only as a generic validation error on the sections screen. The sales-invoice scrap
default for TCS depends on `salesProductService.fetchAll()` continuing to include the
component product, but never explicitly selects `isScrap`.

## Scope

1. **Supplier form**: the TDS Defaults panel is shown to anyone who can edit a supplier; the
   section picker falls back to a plain text input with a hint when the caller lacks `tds.view`,
   so the fields are always settable without special permission.

2. **TDS page**: the ledger code cell shows an inline "required" message and the row cannot be
   saved without it; a section whose ledger code is blank is flagged in the table.

3. **Sales products**: `fetchAll` selects `isScrap` on the component product explicitly
   (additive to the include, not a narrowing), and the sales-invoice scrap default reads that
   field; a unit or integration assertion that the field is present on the response.

## Out of scope

- Web typecheck, lint, prettier and build must be green.
- No new routes; no changes to e2e/smoke.spec.ts.
- No TDS/TCS threshold or section logic changes.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npx prettier --check "packages/**/*.{ts,js,json}" "apps/api/test/**/*.ts" "apps/api/prisma/seed.ts"`, and web build are all green.
- Tests in `banking-tds-followups.spec.ts` and `sales-product.spec.ts` (or the closest
  sales-product test) pass; a small addition asserting `isScrap` on component products.
