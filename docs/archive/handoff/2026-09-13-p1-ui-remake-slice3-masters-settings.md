# P1-UI slice 3 (complete): masters and settings

## Why this note exists

Slice 2 (`docs/handoff/2026-09-13-p1-ui-remake-slice2-foundation-public.md`) closed out
the shell and public experience. This pass is slice 3 per `docs/specs/P1-UI-remake.md`'s
migration order: "standard list toolbar, responsive filters, forms, destructive
confirmations and detail summaries" — the Plain register's master-data lists and the
tenant-settings screens. No schema, endpoint, permission or route change.

## Scoping

A survey pass first established that, unlike slice 2's shared onboarding primitives
(which needed a ground-up rewrite), most of the shared list infrastructure —
`DataTable`, `CommonConfirmModal`, `CommonViewModal`, `FilterPopover`, `SearchInput`,
`ColumnToggle`, `TextInput`/`SelectInput` — was already sitting on the Passbook Ledger
tokens from earlier work. The actual leverage was narrower: a handful of components
still carrying hardcoded colors, plus a mechanical wrapper-pattern sweep across the
~59 pages that consume them. Two deliberate scope boundaries carried over from slice 2:

- **`StatusBadge` (`components/ui/StatusBadge/Badge.tsx`) was left untouched.** Its
  ~45-status hardcoded hex-pair system was explicitly flagged in the prior slice's
  hand-off note as an owner-blocked design decision (colored pills vs. the ink-stamp
  vocabulary) — not mine to make unilaterally. Every `<StatusBadge status=.../>` call
  site is exactly as it was.
- Screens that are dense operational boards or financial documents rather than master
  data (stock adjustments, sales/purchase orders, payroll runs, vouchers, GST returns)
  stayed out of scope — they belong to slices 4–6 per the spec's own register split
  (Ledger/Allocation/Document/Monitoring vs. this slice's Plain register).

## Shipped

**Shared infrastructure** (touches ~200 call sites across the app, not just this
slice's pages):

- `DeleteButton`, `EditButton`, `ViewButton` — previously three separate components,
  each with its own hardcoded-hex CSS file with a duplicated light/dark override (the
  same bug class as the ShortcutPanel/Calculator theme bugs from slice 2: dark mode
  values that don't track the semantic tokens). Rewritten as one shared neutral
  bordered-icon treatment (`border-line`, `text-ink-muted`) with a token-based hover
  tint — accent for View/Edit, danger for Delete. The three orphaned `.css` files are
  deleted.
- `CommonConfirmModal` — the icon changed from a filled colored circle to a bordered
  stamp square (the same motif already established by the 404/403 pages), radius and
  shadow moved onto the app's scale, hardcoded red moved onto the danger token.
- `CommonViewModal` — the avatar chip was a two-hue `from-accent to-emerald-500`
  gradient, the exact "second brand color" violation already fixed once in `Button.tsx`
  during slice 2 and evidently never propagated here; now a solid `bg-accent`.
- `FilterPopover`'s active-filter state moved off a hardcoded green onto the accent
  token; `ColumnToggle`, `SearchInput`, `DetailBox` got the same radius/token pass.
- `TextInput` and `SelectInput` (form primitives used by 50+ pages each) had their
  error states moved from hardcoded red onto the danger token.
- **`DataTable.tsx` had a real bug, not just a styling gap**, found while
  screenshotting for verification: the grid column-sizing code used
  `minmax(0, 1fr)` for any column without an explicit width, which lets a column
  shrink to zero and overlap its own text at narrow viewports — the surrounding code
  comment already documented the intended `minmax(max-content, 1fr)` (forces the
  table to scroll horizontally instead of squishing), the implementation just didn't
  match it. Fixed in its own commit; every list built on `DataTable` — most of this
  slice's pages, and every page from earlier slices too — inherits the fix.
- Deleted `FilterCard.tsx` (confirmed zero usages, superseded by `FilterPopover`,
  written in Bootstrap classes with no Tailwind equivalent — dead and already broken).
- `modules/settings/Setting.tsx`: an orphaned-from-nav but still-routed (`/settings`)
  placeholder stub, on the old Bootstrap/CSS-variable system with no real content.
  Restyled in place rather than removed — the remake's own rules don't delete routes
  as part of a visual migration, and its route is live even though nothing links to
  it. `CompanyProfile.tsx` and `StoreTypeList.tsx` also turned out to be unrouted (no
  route or import references either), so both were restyled per their in-scope
  assignment but aren't currently reachable in the running app; noted below, not
  fixed, since re-wiring routes is a product decision, not a visual one.

**Page sweep**, all onto tokens (flat/hairline chrome, no shadow on persistent
elements, radius on the app's 3/5/8px scale, ad hoc per-type color maps collapsed to
one neutral bordered chip since multi-hue decoration violates the One Ink Rule):

- **Inventory masters:** category, departments, raw materials, product/UOM, finished
  stock, sales product, storage and wastage stores, machines. `StoreTypeList.tsx` had
  an actual dark-mode bug beyond styling — light-only amber/blue classes with no dark
  counterpart — now on the warning token.
- **Sales/Supplier masters:** customers, suppliers. `Suppliermaterialpricinglist.tsx`
  was the worst offender in the whole cluster — a hand-rolled `<table>` with ~35
  hardcoded colors and a leftover `console.log`; now on tokens, debug statement
  removed. `SupplierView.tsx` was dead markup on undefined Bootstrap-era classes
  (rendered unstyled); rebuilt onto `TailwindPrimitives`.
- **People masters:** employees, shifts, roles. `PermissionList.tsx` and
  `UserList.tsx` turned out not to be mid-migration at all — still the pre-Tailwind
  `Container/Row/Col/Modal` layout wired to legacy CSS classes, never touched by the
  Foundation slice. Rebuilt onto the same `DataTable` + `CommonModal` pattern every
  other list in this slice uses; every state hook, callback and service call
  (`usePermissions`, `useUsers`, `changeUserStatus`, the permission gates) carried
  over unchanged — only the render layer moved. `RolePermissionMapping.tsx`'s
  dozen-color section/action legend collapsed to neutral chips plus the accent token
  for the one real primary-action use.
- **Finance/Compliance masters:** `ChartOfAccountsPage.tsx` and `BankAccountsPage.tsx`
  keep their own bespoke add/edit modals (restyled in place; neither has a delete
  action to wire a confirmation onto). `GstMastersPage.tsx`'s `window.confirm()` on
  HSN removal is now `CommonConfirmModal`.
- **Tenant settings**, all thirteen screens: export, e-invoice/devices/
  transporters/currencies, company profile/settings, user profile, WhatsApp, imports,
  email, SMS, invoice settings. `DevicesPage.tsx`'s `window.confirm()` on device
  revoke is now `CommonConfirmModal`. `ProfilePage.tsx` and `CompanyProfile.tsx` each
  carried their own gradient/multi-hue decoration (an indigo-to-violet avatar, six-hue
  section icons) that violated the one-accent rule; both are now neutral with a
  single accent where it marks an actual status or primary action.

Every destructive-confirmation swap (`window.confirm()` → `CommonConfirmModal`) reuses
the exact underlying service call it replaced — no business logic, validation, or
request/response shape changed anywhere in this slice.

## Verification

`npm run typecheck -w @shiftline/web`, `npm run lint -w @shiftline/web` (0 errors — the
pre-existing warning count actually dropped slightly, since rebuilding `PermissionList`/
`UserList` cleared a few stale unused-import warnings along the way), and
`npm run build -w @shiftline/web` are all green. Verified on the real running stack:
local Postgres, the demo seed, API and web dev servers, Playwright screenshots across
both themes covering all five restyle groups — inventory (categories, raw materials,
products, machines, wastage stores), sales/supplier (customers, suppliers), people
(employees, shifts, roles, permissions, users, role-permissions), finance/compliance
(chart of accounts, bank accounts, GST masters) and settings (devices, profile, company
settings) — plus the `CommonConfirmModal` and `CommonViewModal` dialogs in the wild, a
390px mobile pass, and the calculator re-checked for no regression from slice 2. The
mobile pass is what surfaced the `DataTable` column-squish bug described above; it's
confirmed fixed with a before/after re-screenshot at both 390px and 1440px.

## Half-done / known gaps

- **`CompanyProfile.tsx` and `StoreTypeList.tsx` are restyled but currently
  unreachable** — no route or import references either file anywhere in the app
  (confirmed by grep, not just by browsing). `CompanyProfile.tsx` looks like it was
  superseded by `CompanySettings.tsx`/`ProfilePage.tsx` (the actual `/company/edit`
  and `/company/view` routes); `StoreTypeList.tsx` looks like a planned-but-unwired
  read-only reference screen. Neither is a defect this slice introduced or should fix
  — re-wiring routes is a product call, not a visual-migration one — but worth a
  decision: wire them in, or delete them as dead code.
- **`RolePermissionMapping.tsx` has no destructive-confirmation modal**, by design:
  every grant/revoke on that screen is a reversible checkbox toggle, including bulk
  toggles across a whole row, column or section at once. Wiring `CommonConfirmModal`
  onto every checkbox click would be a real UX regression (a dialog firing on a bulk
  toggle affecting dozens of permissions), not a style fix, so it was deliberately
  left as a flagged gap rather than guessed at.
- **`StatusBadge`'s color system is still the pre-migration hardcoded-hex pill set**,
  as called out in the prior slice's note and repeated here so it doesn't get lost:
  whether the ink-stamp vocabulary replaces it outright or layers on top is a real
  design decision for the product owner, not something either slice attempted.
- `FinishedStockCreate.tsx` / `FinishedStockEdit.tsx` are on an entirely different,
  older Bootstrap-style layout (`Container/Row/Col`, `page-header`/`form-inner`
  classes) with no `bg-card`/radius/shadow wrapper at all, and neither form calls a
  real API (`handleSubmit` just toasts and navigates) — they read as orphaned stub
  screens rather than a styling gap, so restyling them was skipped rather than
  guessed at.

## Next

Slice 4: operations and inventory — dense boards, schedules, production interactions
and horizontally scrollable tabular data (dashboards, weekly/daily planning, shift
execution, production orders, stock adjustments/EOD stock), per
`docs/specs/P1-UI-remake.md`'s migration order. These are Monitoring/Allocation
register territory, not the Plain register this slice used.

## Blocked on you

Nothing blocks continuing — UI-only, no schema/permission/API change. Two open
decisions carried in "Half-done" above, neither urgent: whether to wire in or delete
the two unreachable pages, and the still-pending `StatusBadge` design call from slice 2.

## Changelog

Restyled the master-data lists (categories, materials, products, customers, suppliers,
employees, machines, chart of accounts, GST codes, and more) and every tenant-settings
screen onto the new look, and fixed a real bug along the way: list tables were
squishing their columns instead of scrolling on narrow screens.
