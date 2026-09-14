# P1-UI slice 4 (complete): operations and inventory

## Why this note exists

Slice 3 (`docs/handoff/2026-09-13-p1-ui-remake-slice3-masters-settings.md`) closed out
masters and settings — the Plain register. This pass is slice 4 per
`docs/specs/P1-UI-remake.md`'s migration order: "dense boards, schedules, production
interactions and horizontally scrollable tabular data" — dashboards, scheduling,
production orders, and the operational remainder of inventory. No schema, endpoint,
permission or route change.

Unlike slice 3, this slice had to originate real design work rather than apply an
established pattern: the Monitoring register (dashboards/OEE) and the Allocation
register (scheduling/rosters/assignment grids) had only ever been named in the spec,
never actually designed in slice 2 or 3.

## Scoping

A survey pass found ~59 live files across dashboards, scheduling, production orders
and operational inventory, plus a larger dead-code problem than the initial automated
survey caught — direct import-tracing found 10 of 14 surveyed "shared dashboard
components" had zero usages anywhere in the app.

- **14 dead files deleted**, confirmed by exhaustive `grep` (zero imports, no route):
  `production-orders/pages/sd.tsx` (503 lines, unrouted), `daily-machine-planning/pages/DailyMachinePlanning.tsx`
  (1028 lines, superseded by `DailyProductionPlanningPage.tsx`), `components/ui/Planning/PlanningBoardGrid.tsx`+`.css`
  (387 lines, unused single-machine drag-drop grid), and 10 files under
  `dashboard/components/`: `Card.tsx`, `DashboardFooter.tsx`, `DashboardMachineOverview.tsx`,
  `DashboardProductionOverview.tsx`, `DashboardQuickNav.tsx`, `DashboardRecentActivity.tsx`,
  `DashboardScheduleOverview.tsx`, `DashboardStatsGrid.tsx`, `DashboardStatusPriority.tsx`,
  `SparklineCard.tsx` — the last one imported into `DashboardPage.tsx` but never actually
  rendered.
- **TV Dashboard cluster excluded from this slice's scope** (`dashboard/tv/` — `TvDashboard.tsx`,
  `TvPrimitives.tsx`, five `Scene*.tsx` files, `tvFormat.ts`, `useTvSummary.ts`, `tv.css`;
  ~2500 lines, 10 files). Read in full before deciding: it's an already well-designed,
  self-contained OKLCH-authored theme for a wall-mounted kiosk display, with its own
  legitimate green/amber/red/blue OEE-threshold semantics (`TvAccents`) and a fluid
  scaling unit for wall-display sizes. Grepped the whole directory for the `dark:` bug —
  zero hits. This is a different, already-coherent design language for a different
  viewing context (a TV across a factory floor, not a desk), not the generic-SaaS-dashboard
  problem the Passbook Ledger direction exists to fix. Revisit only if the product
  direction for that surface changes.
- **`StatusBadge` (`components/ui/StatusBadge/Badge.tsx`) stays untouched**, same
  owner-blocked reason carried from slice 2 and repeated in slice 3: its ~45-status
  hardcoded hex-pair system is a real design decision, not mine to make unilaterally.
  Every `<StatusBadge status=.../>` call site in this slice's files is exactly as it was.

## Shipped

**New design authorship** (the Monitoring register's now-established visual language,
used as the reference model in every agent brief for the rest of the slice):

- **`AccountStatTile`** (`dashboard/pages/DashboardPage.tsx`) — a flat bordered stat-tile
  component (neutral icon box, tabular-nums bold value, success/danger token only for a
  real trend delta) replacing the KPI row's six unique saturated gradient cards
  (5.5rem ghost icons, hover-lift+glow). Config-driven; ~230 lines of repeated markup
  became ~65.
- **`--chart-series-1..4`** categorical chart palette (teal/sienna/plum/forest ink),
  registered in `assets/css/style.css` for both themes and validated against the
  dataviz skill's checks (lightness band, chroma floor, CVD adjacent-pair separation,
  WCAG contrast vs. surface) via `validate_palette.js`. Replaces every ad hoc
  `PALETTE`/`PIE_COLORS` hex array across the dashboard cluster. `components/ui/chart.tsx`
  (the shared Recharts tooltip/legend wrapper) moved onto the same token set
  (`rounded-sm`, `shadow-md`, `border-line`, ink tokens).

**Dashboards and monitoring:**

- `DashboardPage.tsx` — full pass beyond the KPI row: card chrome, chart tooltips,
  genuine status colors (order/alert/purchase states) onto success/warning/danger/info
  tokens, plain category badges (transaction types) onto neutral chips, the one real
  toggle onto the reserved accent. One real bug fixed: a `group-hover:text-white` that
  went invisible against the light hover background. Confirmed pre-existing dead code
  left alone (out of a visual-only scope): `prodStatusData`, `salesStatusData`,
  `purchaseStatusData`, `inventoryData`, `machineList`, `priorityData` are computed but
  never rendered anywhere in the file.
- `SalesPurchaseTrendChart.tsx` — full rebuild, all 5 modes (bar/area/pie/radar/table)
  onto the series palette; Net Margin onto success/danger tokens (a genuine delta, not
  a category); verified interactively in both themes.
- `InventoryStockIntelligence.tsx` + `WorkforceShiftAttendance.tsx` — the slice's core
  `dark:`-bug fix: 196 combined `dark:`-paired hardcoded classes (a silent no-op here,
  since dark mode is driven by `[data-theme]`, not Tailwind's `dark:` variant) collapsed
  to single tokens.
- `SalesPersonLiveMap.tsx` — marker palette onto `--chart-series-*`; freshness state
  (live/recent/stale) onto status tokens; selection state onto the reserved accent.
- `ProductionDashboard.tsx` — real bug: `TailwindPrimitives`' `Col` silently strips
  `xs/sm/md/lg/xl/xxl` span props before spreading, so every `Col lg={3}` etc. was
  dead — the KPI/machine/shift grids were rendering single-column. Converted to
  explicit responsive classNames (`col-span-12 sm:col-span-6 lg:col-span-3`-style).
- `OeeDashboard.tsx` — real bug: `getStatusColor()` built dynamic `bg-${...}`/`text-${...}`
  classNames from string interpolation, which Tailwind can't statically detect and
  which never rendered correctly in this build — replaced with a literal token map.
  OEE% readings (real thresholds) get success/warning/danger; Availability/Performance/
  Quality sub-metrics (fixed category identity, not a threshold) get `--chart-series-1/2/3`.
- `StatusPage.tsx` — tokens throughout.

**Scheduling and Allocation register:**

- `WeeklyMachineSchedule{List,Create}.tsx` — wrapper/token pass.
- `WeeklyMachineScheduleEdit.tsx` — real fix: dropped `Container/Row/Col/Card` from
  `TailwindPrimitives` plus legacy `inner-container`/`page-header` global CSS classes
  (confirmed those rules carry non-token hardcoded colors), rebuilt mirroring the
  sibling Create page. Business logic and the update call untouched.
- `DailyProductionPlanningPage.tsx`, `DailyPlanCreate.tsx`, `DailyPlanView{Page,Modal}.tsx`,
  `DailyReportPage.tsx`, `DailyProductionReportModal.tsx` — solid-fill colored pills
  (progress bars, completion/efficiency/status chips, banners) converted to flat
  bordered chips on success/warning/danger/accent tokens.
- `ShiftExecutionBoard.tsx` — full rewrite: this screen fed Bootstrap-shaped props
  (`d-flex`, `badge bg-danger`, `form-control`) into `TailwindPrimitives`, on top of
  the same silently-dropped `Col` span bug as `ProductionDashboard.tsx` — the
  two-column layout never actually rendered. Shift-status controls are now flat
  bordered toggles (accent/neutral/danger); both modals moved onto the existing
  `CommonModal` shell with the same handlers wired through `CustomButton` footers.

**Production orders and job work:**

- `ProductionOrderList.tsx`, `AllProductionOrderList.tsx`, `ProductionOrderCreate.tsx`,
  `ProductionOrderHistoryView.tsx` — wrapper/token pass; ad hoc dispatch-status color
  maps collapsed to the one neutral chip; a raw Bootstrap alert block converted to
  Tailwind.
- `ApprovedSalesOrderList.tsx` — full rework off legacy `Container/Row/Col/Modal`
  Bootstrap-shaped markup onto the established master-list wrapper and plain Tailwind
  table (same precedent as `PermissionList.tsx`/`UserList.tsx` in slice 3); business
  logic and handlers unchanged.
- `ProductionOrderViewModal.tsx` — full token rewrite (was 100% hardcoded
  slate/gray/red/green/blue); the Issue Raw Materials CTA moved to the reserved accent.
- `MaterialIssueModal.tsx`, `JobWorkPage.tsx` — remaining hardcoded spots and an ad hoc
  challan-status color map converted to tokens.

**Hourly work reports and stock/inventory operational remainder:**

- `CapacityHistoryModal.tsx` — full rewrite off raw Bootstrap markup (`Modal.Title`
  from the app's own `TailwindPrimitives` compound component, not react-bootstrap)
  onto the shared `DataTable` primitive.
- `StatusPage.tsx`, `InventoryReportsCenter.tsx`, `StockList.tsx`,
  `StockAdjustment{Form,List,View}.tsx`, `EodStockList.tsx` — wrapper/token pass; ad hoc
  type/category badge maps (adjustment type, source, wastage) collapsed to the neutral
  chip; genuine status/threshold colors (approval state, stock level, increase/decrease
  deltas) onto success/warning/danger tokens.
- `HourlyWorkReport{Create,Edit,List}.tsx` — same treatment, plus a decorative indigo
  "New Production High" celebratory modal moved to neutral ink (accent is reserved for
  primary action only) and an inline-hex row highlight converted to `color-mix()`
  against the success token.
- `CommonModal.tsx` (shared, used well beyond this slice) — `rounded-2xl`/`shadow-2xl`
  → `rounded-sm`/`shadow-md`, to match the rest of the app's modal chrome; both
  `HourlyWorkReportCreate.tsx`/`Edit.tsx` render it directly, so its old chrome would
  otherwise have defeated the surrounding fix.

Every destructive-confirmation swap and business-logic path (data fetching, handlers,
computed values, socket subscriptions, drag/drop, validation, API calls) carried over
unchanged — only JSX structure and `className` strings moved, except the four named
"real bug" fixes above (the invisible hover text, and three instances of props/classNames
that structurally never worked).

## Verification

`npm run typecheck -w @shiftline/web` and `npm run build -w @shiftline/web` green after
every commit in the slice (7 total: dead code + chart infra, the two `dark:`-bug
components, the `DashboardPage.tsx` remainder, production orders, hourly
reports/stock, `SalesPersonLiveMap`/`ProductionDashboard`/`OeeDashboard`, and the
scheduling/Allocation cluster). Verified on the real running stack: local Postgres,
the demo seed, API and web dev servers, Playwright screenshots across both themes and
two viewports (1440px desktop, 390px mobile) covering all seven restyle groups —
the dashboard KPI row and remainder, all 5 `SalesPurchaseTrendChart` modes (bar/area/
pie/radar/table, interactively switched), `ProductionDashboard`/`OeeDashboard`,
`inventory/stock-adjustments`, `inventory/eod-stock`, the scheduling/daily-planning/
shift-execution cluster, `production-orders/create`, `production/job-work`,
`daily-production-plans/create`, `daily-machine-planning/report`, and
`hourly-work-reports/create`.

## Half-done / known gaps

- **`DashboardPage.tsx` has pre-existing dead code** (not introduced this slice):
  `prodStatusData`, `salesStatusData`, `purchaseStatusData`, `inventoryData`,
  `machineList`, `priorityData` are computed but never rendered. Left as-is — a
  visual-only migration doesn't remove logic, and whether that data should surface
  somewhere is a product call.
- **`style.css`'s legacy `.page-header`/`.page-breadcrumb`/`.page-search-*` rules still
  carry raw hex** (`#e5e7eb`, `#6b7280`, `#94a3b8`, etc.). Out of this slice's file list
  since it's shared global CSS, not a page — flagging for whoever next touches that
  stylesheet.
- **Two small dead/commented-out JSX snippets were left alone rather than churned**:
  a "Delete Entire Week Schedule" link in `WeeklyMachineScheduleList.tsx` and a
  commented "Log Hourly Entry" button in `DailyPlanViewPage.tsx`, both still on
  `text-red-500`/`shadow-sm`. Neither renders, so fixing their colors would be pure
  churn on inert code.
- **The `/approved-sales-orders` route renders `<ProductionOrderList />`**, not
  `ApprovedSalesOrderList.tsx` (`AppRoutes.tsx`) — the latter file exists, was restyled
  as part of this slice per its assignment, but isn't currently reachable through that
  route. Not introduced this slice; noted the same way slice 3 flagged its two
  unreachable pages, since re-wiring routes is a product decision, not a visual one.
- **`StatusBadge`'s color system is still the pre-migration hardcoded-hex pill set**,
  as called out in slices 2 and 3 and repeated here so it doesn't get lost.

## Next

Slice 5: commercial and finance — document editors, totals, approvals, print actions
and Indian numeric presentation (quotations, sales/purchase orders, invoices,
receivables/payables, returns, vouchers, expenses, GST filing/e-invoice/e-way bill
panels), per `docs/specs/P1-UI-remake.md`'s migration order. This is Document/Ledger
register territory — the two registers not yet designed at all, same situation
Monitoring/Allocation were in going into this slice.

## Blocked on you

Nothing blocks continuing — UI-only, no schema/permission/API change. Open decisions
carried forward, none urgent: the TV Dashboard exclusion (revisit only if that
surface's product direction changes), the `/approved-sales-orders` route/file
mismatch, and the still-pending `StatusBadge` design call from slice 2.

## Changelog

Restyled the dashboards (executive, production, OEE), weekly/daily scheduling, shift
execution, production orders and the remaining inventory operational screens (stock
adjustments, EOD stock, capacity history) onto the new look, established the
dashboard/chart color system, and fixed three real layout/color bugs found along the
way: two dashboards were silently collapsing to single-column, and one status-color
function was building CSS classes that never worked.
