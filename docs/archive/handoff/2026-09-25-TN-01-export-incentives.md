# Hand-off: TN-01 Export incentive and authorisation tracker (2026-09-25)

Spec: `docs/research/tamil-nadu/market-and-features.md`, "BUILD NOW 1: TN-01".

## What shipped

- Models `ExportIncentiveClaim`, `ExportAuthorisation`, `ExportObligationEntry` (+ 4 enums),
  migration `20260925010000_export_incentives` with RLS and audit triggers; all three are in
  `AUDITED_MODELS`.
- API `/api/export-incentives` (`apps/api/src/modules/export-incentives`): claims CRUD (delete only
  in `DECLARED`, 409 otherwise; status only moves forward; `scripExpiresOn` = scrip date + 12
  months), `POST /claims/from-invoice/:salesInvoiceId`, `GET /claims/summary`, authorisations
  list/create/get/patch (never deleted; `CANCELLED` instead) with progress (`shippedFob`,
  `realisedFob`, `eoPercent`, `block1Percent`, `daysToDue`), entries add/remove.
- Registries: permission module `export-incentives` (view/create/edit/delete/export), feature
  `exports` on GROWTH (ENTERPRISE inherits), `API_PATHS.exportIncentives`. The ACCOUNTS role template
  gets all five keys.
- Web: `/exports/incentives` (`ExportIncentivesPage.tsx`), claims and authorisations tabs,
  summary tiles, EO progress bars, entry list; sidebar "Exports"; smoke-test line.
- Tests: `apps/api/test/integration/export-incentives.spec.ts` (happy path, every validation
  rejection, cross-tenant, permission refusal); route/leak snapshots updated; the three models are
  on the leak suite's no-seed-rows list.

## Cut / next

- pg-boss scrip-expiry and EO block-1 alert job (spec defers it).
- Web: no edit modal, no "from invoice" picker, no per-claim status buttons, no entry form in the
  drawer yet (all API-backed; UI only).
- Existing tenants' ACCOUNTS roles do not get the new keys automatically; the owner grants them
  (new tenants get them from the role template).
- No screenshot from the running stack yet; no changelog file exists in the repo.

Changelog sentence: "Track RoDTEP, RoSCTL and drawback claims per shipping bill and your EPCG /
Advance Authorisation export obligations in one place under Exports."
