# P2-26 — Supplier TDS panel visibility, TDS page ledger validation, explicit scrap include

## Shipped

- **Supplier form TDS panel always shows.** The "TDS Defaults" section (P2-17's
  `defaultTdsSectionCode`, `deducteeType`, `higherRate206AB` fields) is now rendered for any
  role that can edit suppliers, not just those with `tds.view`. When a role lacks the
  permission, the section code falls back to a `TextInput` with a placeholder hint, and the
  picker is skipped; the deductee type and 206AB fields work as before. A supplier saved
  without `tds.view` can have its TDS fields edited by a caller with the permission on a
  later edit.

- **TDS sections screen ledger code now required with inline message.** The ledger code cell
  (new column, P2-26) is shown in the sections table's edit mode as a text input that displays
  "Required" in red when blank. In the non-editing view, the cell shows the ledger code or
  flags a blank one with a red "Missing" label. The save button passes `ledgerCode` in the
  payload (already expected by the backend's P2-17 validation, `tds.routes.ts` line 55).

- **Sales products `fetchAll` explicitly includes `isScrap` on component products.** The
  `includeDefaults` in `salesProduct.service.ts` now uses a `select` that explicitly names
  `isScrap` alongside the other component-product fields (`id`, `code`, `name`,
  `finishedGoodsStocks`, `uom`), making the dependency explicit rather than relying on an
  implicit include-all. `SalesInvoiceCreate.tsx`'s scrap-section default (lines 170–195) reads
  this field off the component product when checking a composite sales product's items.

- `apps/web/src/modules/supplier/pages/SupplierForm.tsx` (always show TDS Defaults panel,
  text-input fallback for section code).
- `apps/web/src/modules/compliance/pages/TdsPage.tsx` (ledger code column with required
  message and missing flag).
- `apps/web/src/services/tdsService.ts` (added `ledgerCode` to `TdsSectionRow` interface).
- `apps/api/src/modules/sales-product/salesProduct.service.ts` (explicit `select` with
  `isScrap`).
- `docs/specs/P2-26-tds-panel-polish.md` (spec).

## Half-done / known gaps

None. All three requirements are complete on both web and API.

## Next

Nothing in the Phase 2 plan depends on this directly. The ledger-code requirement is now
visible and enforced on the web form; any role with `tds.manage` will see the error and can
supply it. A future pass might audit the tdsService and other TDS-aware routes for similar
patterns.

## Blocked on you

Nothing — no new account or credential.

## Changelog sentence

The supplier master TDS panel is now visible to any role editing suppliers (fallback text
input for section code without the tds.view permission), the TDS sections screen shows an
inline ledger-code requirement, and the sales-product scrap default checks component isScrap
fields from an explicit query.
