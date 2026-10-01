# TN-10 — Subsidy and scheme tracker

Spec: `docs/research/tamil-nadu/market-and-features.md`, "(d) Prioritised feature list", item 10
(no separate `docs/specs/` file exists for the TN packages).

## Shipped

- **Schema** (migration `20260927070000_subsidy_schemes`, sorts after every migration on main;
  RLS `tenant_isolation` + `platform_bypass`, audit triggers, models in `AUDITED_MODELS`):
  `SubsidyScheme` (`@@unique([companyId, schemeCode])`, kind, authority, sanction order/date,
  sanctioned amount, status, kind-specific `details` JSON) and `SubsidyClaim`
  (`@@unique([companyId, claimNo])`, period, claimed / disbursed amounts, forward-only status).
- **Calc** (`subsidy.calc.ts`, pure): capital subsidy (rate + extra %, cap), LTPT power subsidy
  month grid (Received / Claimed / Due / Missed / Upcoming, claim window), interest subvention,
  totals.
- **API** `/api/subsidy-schemes` (permission module `subsidy-schemes`: view/create/edit/export):
  schemes CRUD, `/:id/claims`, `/:id/claims/:claimId/status`, reminders, summary, CSV export.
- **Web** Accounts → Subsidies & schemes (`/accounts/subsidies`): stat tiles, status chips with
  counts, scheme table, reminders. Detail `/accounts/subsidies/:id`: figures, LTPT month grid,
  claims with status moves. Nav entry gated by `subsidy-schemes.view`, routes in `AppRoutes`,
  smoke line in `e2e/smoke.spec.ts`, nav spec updated. Accounting screens stay English in the
  Tamil UI (TN-04 policy), so no new locale keys were needed; the shell around them is Tamil.
- **Tests**: `test/unit/subsidy-calc.spec.ts`, `test/integration/subsidy-schemes.spec.ts` (happy
  path, every validation rejection, overlap 409, forward-only status, 403 for other roles,
  foreign company sees nothing); routes and leak snapshots updated.

## Merge notes

Merged `origin/main` (TN-04..09, Beta). Conflicts, kept both sides: `schema.prisma` (subsidy
models then process-route models) and `index.routes.ts` (both imports and mounts).

## Checks (local; Actions billing blocked)

typecheck, lint (0 errors), API suite 115 files / 853 tests, web tests, web build, e2e typecheck,
CI prettier, `audit:gate`, `migrate deploy` on an empty DB with no `migrate diff` drift.

## Screenshots

`docs/screenshots/tn10-subsidies-{list,detail-capital,detail-ltpt}-{en,ta}.png` (1440 wide).

## Cut / later

- Folding schemes into the P2-14 licence register; no posting of received subsidy to the books
  (record it as a receipt voucher separately); no Tamil strings inside the page bodies.

## Changelog

Accounts can now track capital, power-tariff and interest subsidies from sanction to bank credit,
with month-by-month claim reminders so no LTPT month is missed.
