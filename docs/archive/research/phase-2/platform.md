Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Platform domain research: owner dashboard, reports, insights, cross-cutting platform

Domain: dashboard, insights, reports, status, notifications, realtime, jobs, company,
onboarding, settings, users/roles/permissions, platform console, entitlements/plans,
imports, mobile.

## 1. Inventory

### Dashboard

- `apps/api/src/modules/dashboard/{dashboard.controller.ts,dashboard.routes.ts,dashboard.tv.service.ts}`.
  Routes (`dashboard.routes.ts`): `GET /api/dashboard/summary`, `/accounts-summary`, `/tv-summary`.
  **Quality issue**: only `authMiddleware`, no `requirePermission` — every logged-in user sees
  full financial data (receivables, payables, all vouchers) regardless of role. Contrast with
  every other module which gates with `requirePermission`.
  **Quality issue**: uses `prisma` from `../../config/prisma` (a thin re-export of `lib/prisma.ts`,
  fine) but bypasses the module convention of thin controller/service split — `dashboard.controller.ts`
  has ~300 lines of business logic (bank/receivable/payable aggregation) directly in the controller,
  no `dashboard.service.ts`. `getSummary` does 14-way `Promise.all` of unfiltered `findMany()` with
  no `take` on several (salesOrders, purchaseOrders, productionOrders, weeklyPrograms, dailyPlans) —
  will not scale past a few thousand rows per tenant; no pagination, no date range.
  No dedicated test file for dashboard endpoints.
- TV wall: `dashboard.tv.service.ts` (591 lines) — `getTvSummary()` used both by `/tv-summary` and by
  `insights.service.ts`. Web: `apps/web/src/modules/dashboard/tv/` (scenes: Overview, Sales, Production,
  FieldSales, InventoryFinance) — a big rotating full-screen board, not an "owner daily view".
- Web dashboard screen: `apps/web/src/modules/dashboard/pages/DashboardPage.tsx` + components in
  `modules/dashboard/components/` (Card, SparklineCard, DashboardStatsGrid, DashboardMachineOverview,
  DashboardProductionOverview, DashboardScheduleOverview, DashboardStatusPriority,
  InventoryStockIntelligence, SalesPersonLiveMap, SalesPurchaseTrendChart, WorkforceShiftAttendance,
  DashboardRecentActivity, DashboardQuickNav, DashboardFooter). Widget-level permission keys exist
  (`dash-overview`, `dash-trend`, `dash-tasks`, `dash-inventory`, `dash-machines`, `dash-top-products`,
  `dash-recent-sales` in `packages/shared/src/permissions.ts` lines 14-20) but `dashboard.routes.ts`
  does not enforce them server-side — permission split exists in the registry but is not wired to the
  API, only (presumably) to widget visibility in the UI. Confirm before reuse.
- Also `ProductionDashboard.tsx`, `OeeDashboard.tsx` (gated by `oee-dashboard.view`), `PayrollDashboard.tsx`.

### Insights (companion app / TV wall / integrations API)

- `apps/api/src/modules/insights/{insights.routes.ts,insights.service.ts}` (291 lines). Mounted at
  `/api/v1/insights` (routes/index.routes.ts:88,193). Gated by single permission `insights.view`
  (registry: `insights` module, `view` action). Endpoints: `/summary`, `/accounts`, `/ageing`,
  `/field-team`, `/plant`, `/attention`. **This is the best-built read model in the domain** — see
  §4a pattern notes: 60s per-tenant, per-endpoint in-memory cache (`cached()` helper, `INSIGHTS_TTL_MS`),
  `Cache-Control`/`X-Cache` headers, composes from other services (`ageingService`, `accountsService`,
  `getTvSummary`, `mobilePositionService`) rather than querying Prisma directly — a good template for
  an owner-summary endpoint. No web screen consumes `/v1/insights/*` yet (grep found none) — it is
  for companion app / TV wall / third-party integrations, unused as an owner-dashboard source today.

### Reports

- `apps/api/src/modules/reports/{reports.controller.ts,reports.routes.ts,reports.service.ts}` (416
  lines service). Endpoints (all `requirePermission("reports.view")`): `GET /api/reports/machines`,
  `/weekly-programs`, `/production-orders/:productionOrderId`, `/sales-orders`, `/purchase-orders`.
  Single flat `reports.view` permission for everything (no per-report key) — coarse; other domains
  register per-report permissions (`sales-reports.view`, `purchase-reports.view`,
  `inventory-reports.view`, `production-reports.view`, `audit-reports.view` in permissions.ts:389-393)
  that this `reports` module does not actually use — dead/unused permission keys, or a second
  reporting surface (web `modules/reports`) that calls different endpoints; check both before adding
  a 6th report here. No report builder/exporter (CSV/PDF) in this module — compare `ExportCSVButton`
  component (`apps/web/src/components/ui/ExportCSVButton`) used ad hoc per screen.
  Web: `apps/web/src/modules/reports/` (screens use the audit-trail marker `/reports/audit` in
  `e2e/smoke.spec.ts:24`) — so "reports" as a web module is mostly the audit trail viewer, not the
  5 API reports above; the two "reports" surfaces are not the same set of screens. No integration
  test file found under `test/integration/` matching `reports*`.

### Status (public/ops status page)

- `apps/api/src/modules/status/status.service.ts` (189 lines) — component checks (api, database,
  migrations, worker heartbeat via `isJobsStarted`, backups) behind `/ready` and `/api/status`;
  no controller/routes file colocated (mounted from `routes/index.routes.ts`, search there for
  `/status`). Web screen `/status` (smoke test marker `All systems operational|Some systems degraded`).
  This is ops/uptime status, not business status — do not confuse with a workflow "document status".

### Notifications (in-app notification centre, P1-00)

- Prisma model `Notification` (schema.prisma:2803) — `companyId` default from
  `current_setting('app.company_id')`, `userId`, `level` (NotificationLevel), `category` (producer
  area free string, e.g. onboarding/team/imports/retention/inventory/system), `title`, `body`,
  `link`, `data` Json, `readAt`. Indexed `[companyId, userId, readAt, createdAt]`.
- Consumer API: `apps/api/src/modules/notifications/{notifications.controller.ts,notifications.routes.ts,
notifications.service.ts}` — `GET /api/notifications` (cursor paginated, `unreadOnly` filter),
  `POST /read-all`, `POST /:id/read`. Only `authMiddleware`, no extra permission (by design — own
  notices). Uses `validateMiddleware(listNotificationsSchema)` / `notificationIdSchema` (zod, defined
  in the controller file, not a separate `.validation.ts` — a minor convention deviation, harmless).
- Producer API: `apps/api/src/modules/notifications/notify.ts` — `notify({category, title, body, link,
level, data, to, createdBy})`. `to` is `NotifyAudience`: explicit `userIds`, or `{permission}` (every
  active user whose role grants that permission key), or `{all}`. Resolves recipients, writes one row
  per recipient with `createManyAndReturn`, emits `notification:created` via `emitToUser` per row.
  Never throws (catches and logs a warn) — "a notification is a courtesy". **This is the module to
  reuse for any new alert** (see gaps below) — do not build a second notification pipe.
  **Gap**: no rules engine / no scheduled digest — every existing caller of `notify()` fires
  synchronously from a request or a job at the moment of the event; there is no "check condition X
  daily and notify if breached" abstraction (e.g. no generic threshold/overdue watcher). No web
  bell/notification-center UI found under `apps/web/src/modules/notifications` beyond a bare listing
  module — confirm before building more.

### Realtime

- `apps/api/src/lib/realtime.ts`: `emitToTenant(event, payload?, companyId?)` (room `tenant:<id>`,
  drops silently with no tenant in scope — never a cross-tenant leak), `emitToPlatform` (room
  `platform`), `emitToUser(userId, event, payload)` (room `user:<id>`). All go through `getIO()` from
  `apps/api/src/socket/socket.ts`. Convention: **never** call `getIO()` or `io.emit` directly outside
  `lib/realtime.ts` — grep the codebase for `getIO()` before adding a new socket emit elsewhere.

### Jobs (pg-boss)

- `apps/api/src/lib/jobs.ts`: `QUEUES` registry (naming `<area>.<job>`), `startJobs()`,
  `sendTenantJob(name, {companyId,...}, opts)` (singleton key = companyId, `policy: "stately"` for
  tenant queues so a fan-out never stacks duplicate work). Handlers in `apps/api/src/jobs/*.job.ts`
  (`account-export`, `assets`, `backup`, `compliance`, `e-invoice`, `eod-snapshot`, `eway-bill`, `fx`,
  `heartbeat`, `ims`, `job-work`, `msme`, `retention`), wired in `apps/api/src/jobs/index.ts`.
  Pattern: nightly/daily fan-out job enqueues one per-tenant job (`runAsTenant`), each idempotent.
  **No job today produces a WhatsApp/email daily owner summary** — nearest analogue is
  `compliance.job.ts` (COMPLIANCE_CALENDAR, "warn 7 and 2 days before each statutory due date") and
  `msme.job.ts` (MSME_CLOCK) — both call `notify()`, a good template for a new "daily digest" job.

### Company / Onboarding / Settings

- `apps/api/src/modules/company/{company.controller,routes,service,validation}.ts`. `settings`
  itself is spread across many modules (`invoice-settings`, `email-config`, `retention`,
  `entitlements`) rather than one `settings` module — the web `/settings/*` routes fan out to many
  API modules; there is no single API "settings" module to inventory.
- Onboarding: `apps/api/src/modules/onboarding/{onboarding.controller,routes,service,types}.ts`.
  `POST /api/onboarding/complete` is the only thing allowed to set `Company.isOnboarded` (CLAUDE.md
  rule) — grep any new company-setup code for that rule before touching `Company.isOnboarded`
  elsewhere. Web `/onboarding` wizard.

### Users / Roles / Permissions

- `apps/api/src/modules/users/{user.controller,user.repository,user.service,user.routes,
invitation.controller,invitation.service,invitation.routes}.ts`. Users join only via invitation
  (`invitation.service.ts`), never a password emailed directly (CLAUDE.md rule).
- `apps/api/src/modules/role/{role.controller,role.service,role.routes,role.validation}.ts`,
  `apps/api/src/modules/role-permissions/*`, `apps/api/src/modules/permissions/*` — permission CRUD
  reads from `packages/shared/src/permissions.ts` `PERMISSION_REGISTRY` (single source of truth, 485
  lines, `module: "x"`/`actions: [...]`/`description`), consumed by API middleware+bootstrap and web
  routes/sidebar/role matrix (see §4c).

### Platform console (super-admin)

- `apps/api/src/modules/platform/{backups.controller,backups.routes,console.controller,
console.routes,impersonation.routes,impersonation.service,plans.controller,plans.routes,
provisioning.service,tenants.controller,tenants.routes}.ts`. `Admin` rows / `isSuperAdmin`, no
  tenant; screens behind `ProtectedRoute superAdmin` + `requireSuperAdmin()`; act-as-user only via
  `impersonationService` (30-min token, reason, `impersonatedBy` stamped on every audit row).
  New tenants only via `provisioningService.provisionTenant()`.

### Entitlements / Plans

- Prisma models `Plan` (global catalogue: `code`, `features: String[]` from shared `FEATURE_KEYS`,
  `seatLimit`, `apiLimit`, `priceInrMonthly`, schema.prisma:2836) and `Subscription` (per tenant:
  `status: SubscriptionStatus`, `seats`, `apiLimit` overrides, `trialEndsAt`,
  `currentPeriodStart/End`). `apps/api/src/modules/entitlements/{entitlement.service.ts,
entitlements.routes.ts}` — `entitlementService.resolve(companyId?)`, 60s cache,
  `readOnly` (suspended/cancelled tenants: reads work, writes refused) and `pastDue` (grace window,
  banner only) flags. Invalidated by `invalidate()` from platform plan changes.

### Imports

- `apps/api/src/modules/imports/{imports.controller,imports.csv,imports.routes,imports.service,
imports.types}.ts`. CSV bulk import; web `/settings/imports` (smoke marker "Data imports").

### Mobile (field app sync)

- `apps/api/src/modules/mobile/` — largest module here: `mobile.attachment.service`,
  `mobile.collection.service`, `mobile.controller`, `mobile.device.service`, `mobile.mappers`,
  `mobile.ocr.service`, `mobile.order.service`, `mobile.position.service`, `mobile.routes`,
  `mobile.sync.service`, `mobile.types`, `mobile.visit.service`. Prisma models `MobileDevice`,
  `MobileVisit`, `MobileCollection`, `MobileRouteCustomer`, `MobileRouteAssignment`,
  `MobileSyncRecord`. Conflict policy fixed in `mobile.types.ts` (server-owned tables pull-only,
  documents append-only, visits merged field-by-field); enforced server-side, never let a device
  overwrite a server-owned row (CLAUDE.md rule). `mobilePositionService` already feeds
  `insights.fieldTeam()` — the field-sales live map on the dashboard
  (`SalesPersonLiveMap.tsx`) is the existing pattern for "where is my team right now".

## 2. How things are built (for build agents to copy)

### (a) One complete backend module — sales-invoice

- Files: `apps/api/src/modules/sales-invoice/{sales-invoice.routes.ts, .controller.ts, .service.ts,
.validation.ts}`.
- Validation: `zod` (`z.object`, `z.coerce.number()`, `z.preprocess(blankToUndefined, ...)` to turn
  `""`/`"null"`/`"undefined"` form values into `undefined`, `.regex(/^\d{4,8}$/)` for HSN,
  `z.string().uuid()` for foreign keys). `CreateSalesInvoiceSchema` in `sales-invoice.validation.ts`.
  Wired with `validateMiddleware(schema)` (see notifications module) or validated inline in the
  service — sales-invoice validates in the route via schema, other modules (role, company) use
  `.validation.ts` + `validateMiddleware`.
- Errors: `throw new ApiError(status, message)` from `apps/api/src/utils/ApiError.ts`; controllers
  wrapped in `asyncHandler` (`apps/api/src/utils/asyncHandler.ts`) so a thrown `ApiError` reaches the
  central error handler — never return a raw error message or a bare `catch` that leaks `err.message`
  to the client (CLAUDE.md "no endpoint returns a raw error message").
- Permission keys: declared as `{module, actions, description}` entries in
  `packages/shared/src/permissions.ts` `PERMISSION_REGISTRY` (e.g. `sales-invoices` with
  `["view","create","edit","delete","whatsapp-email"]`), then referenced in the route with
  `requirePermission("sales-invoices.create")` (`apps/api/src/middleware/permission.middleware.ts`).
  Registry keys drive: API middleware, web `ProtectedRoute permission="..."`, sidebar
  `pathsByPermission`/`permission`, and the role-permission matrix UI. Add the module entry once,
  reuse the key everywhere.
- `documentNumberService`: `sales-invoice.service.ts:298` —
  `documentNumberService.next(gst.series, { date: new Date(data.invoiceDate), businessPlaceId:
gst.place.id, tx })` inside the `prisma.$transaction` that creates the row; only used when
  `data.invoiceNo` is not supplied by the caller. Never build a number from `count()` or the last row
  (CLAUDE.md rule) — always go through `documentNumberService` (`modules/documents`).
- Realtime + jobs from a controller: `sales-invoice.controller.ts` posts the voucher
  (`voucherPostingService.postSalesVoucher`) then `emitToTenant("salesInvoice:created", ...)` and a
  few related `emitToTenant` calls — copy this "mutate, then emit, wrapped in try/catch so a socket
  failure never fails the request" shape for any new write endpoint.

### (b) Prisma migration, audited models, RLS

- Never `prisma db push`; always `npx prisma migrate dev --name <change>` (CLAUDE.md).
- Audited models: add the new model name to `AUDITED_MODELS` in `apps/api/src/lib/audited-models.ts`
  (books, tax documents, payroll, masters they depend on — MCA Companies (Accounts) Rules 3(1)),
  then regenerate the trigger migration:
  `npx tsx scripts/gen-audit-migration.ts > prisma/migrations/<timestamp>_audit_trail_<name>/migration.sql`
  (adds a row-level trigger writing old/new JSON + actor + request id into `audit_log`; never write
  to `audit_log` by hand, never delete from it).
- RLS: any new model with a `companyId` field is picked up automatically by
  `scripts/gen-rls-migration.ts` (filters out the fixed `GLOBAL` set: Company, Admin, Permission,
  UserSession, PasswordResetToken, LoginAttempt) — regenerate after adding tenant models:
  `npx tsx scripts/gen-rls-migration.ts > prisma/migrations/<timestamp>_rls_<name>/migration.sql`.
  Pattern per table (see `prisma/migrations/20260906220000_enable_rls/migration.sql`): `ENABLE ROW
LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, `CREATE POLICY tenant_isolation ... USING
(company_id = app_company_id())`, `CREATE POLICY platform_bypass ... USING (app_rls_bypass())`.
  `lib/prisma.ts`'s query extension sets `app.company_id` per transaction from `AsyncLocalStorage`
  (`tenant-context.ts`); RLS is the second, database-level fence behind it.

### (c) Integration test pattern

- Helpers: `apps/api/test/helpers/{app.ts,books.ts,db.ts,routes.ts}`; factories:
  `apps/api/test/factories/index.ts` (`demoCompany()`, `createRawMaterial()`, `createSupplier()`,
  `createProduct()`, `asDemoTenant`, etc.).
- Example spec: `apps/api/test/integration/msme.spec.ts` — imports `api, authed` from
  `../helpers/app`, `getPrisma` from `../helpers/db`, factories, and the service under test directly
  for whitebox assertions; builds fixtures with a unique per-run suffix (`Date.now().toString(36)`)
  and a financial year past every other suite's (`FY = "2029-30"`) so parallel suites never collide.
- Cross-tenant pattern (canonical file `apps/api/test/integration/rls.spec.ts`): create/lookup two
  `Company` rows (`tenantA`, `tenantB`), `runAsTenant(tenantA, ...)` vs `runAsTenant(tenantB, ...)`
  (from `../../src/lib/tenant-context`) around the same query and assert tenant B sees zero rows /
  a write for tenant A's `companyId` while running as tenant B throws `/row-level security/i`; also
  asserts `withoutTenant` + explicit bypass only for platform paths. Also see
  `test/integration/leak.spec.ts` for an endpoint-level (HTTP, not raw SQL) cross-tenant check —
  useful as the template for a new module's own cross-tenant HTTP test (create as tenant A via API,
  fetch as tenant B via API, expect 404/empty).

### (d) One complete web screen — sales-invoice / dashboard

- Module folder: `apps/web/src/modules/<name>/{pages,components}` (e.g. `modules/dashboard/pages/
DashboardPage.tsx`, `modules/dashboard/components/*`).
- Data layer: this repo mixes RTK Query (`apps/web/src/services/baseApi.ts`) and a plain axios
  client (`apps/web/src/api/apiClient.ts`, interceptor injects bearer token from the Redux store,
  handles FormData). Check which a given module already uses before adding a third pattern —
  dashboard reads directly via `apiClient`-style calls in most existing dashboard components.
- Route registration: `apps/web/src/routes/AppRoutes.tsx` — lazy import at top
  (`const X = lazy(() => import("../modules/x/pages/X"))`), then a `<Route>` under `<BaseLayout>`,
  wrapped in `<Route element={<ProtectedRoute permission="x.view" />}>` when gated (ungated routes
  like `/dashboard` and `/settings` are the exception, not the rule — confirm this is intended before
  copying the ungated pattern for a new owner screen with financial data).
- Nav registration: `apps/web/src/components/common/sidebar/sidebar.data.ts` — `SidebarItem[]` tree;
  entries carry `permission` / `permissionAny` / `pathsByPermission` so the sidebar self-filters by
  the signed-in user's grants; groups: "Dashboard" (top-level direct link), "Administration"
  (Masters/Configuration/Users), and further groups for accounts, production, compliance, etc.
  (see §2f).
- `ProtectedRoute`: two files exist — `apps/web/src/components/common/ProtectedRoute.tsx` and
  `apps/web/src/routes/ProtectedRoute.tsx` — confirm which one `AppRoutes.tsx` actually imports
  before reusing (only one is live; check the import at the top of `AppRoutes.tsx`). Props seen in
  use: `permission="..."` and `superAdmin` (platform console screens).
- Tailwind primitives available in `apps/web/src/components/ui/`: BackButton, Button, Calculator,
  CancelReasonModal, CityStateSelect, ColumnToggle, CommonConfirmModal, CommonViewModal,
  DatePickerCalendar, DayScheduleCard, DeleteButton, DetailBox, EditButton, EmailButton,
  ExportCSVButton, FilterCard, FilterPopover, FlowInput, HistoryLink, IconButton, LiveBadge, Loader,
  Modal, PhoneInput, Planning, PricingButton, SearchInput, Section, ShortcutPanel,
  StartProductionModal, StatusBadge, StopProductionModal, TailwindPrimitives.tsx, ToggleSwitch,
  WhatsappButton, chart.tsx, plus `custombutton/`, `tab/`, `table/`, `viewbutton/` subfolders. Also
  `components/common/` (auth, employee, form, layout, sales, salesOrder). No Bootstrap — Tailwind
  only (CLAUDE.md).
- `e2e/smoke.spec.ts`: one entry per screen, `{ path, marker }` where `marker` is a stable regex on
  page text; the runner also fails on any 5xx during the visit. New screen ⇒ append one entry (see
  the 40+ existing entries for the exact shape, e.g. `{ path: "/payable/msme", marker: /MSME Dues/ }`).

### (e) Changelog

- No single `CHANGELOG.md`. "The changelog" is the `## Changelog sentence` (or `## Changelog`)
  section inside each work package's handoff note under `docs/handoff/<date>-<id>-<slug>.md`
  (e.g. `docs/handoff/2026-09-12-P1-07-msme-43bh.md`). `.github/pull_request_template.md` has a
  checklist item "One user-facing sentence for the changelog:" — write it in the PR description and
  in the handoff doc; there is nowhere else to put it.

### (f) Nav structure

- `apps/web/src/components/common/sidebar/sidebar.data.ts`, typed by `sidebar.types.ts`, rendered by
  `Sidebar.tsx`. Top level: a flat "Dashboard" link, then permission-gated groups (`title`, `icon`
  from `react-icons/fi`, `path` default target, `pathsByPermission` for the group's own click target,
  `permissionAny`/`permission` to show/hide, nested `children` (sub-groups → leaf items, each leaf a
  `{title, path, permission}` or itself grouped, e.g. "Administration" → "Masters" → "Customers" →
  {Add, List}). Follow this three-level nesting (top group → sub-group → leaf) for any new area;
  do not add a fourth level without checking `Sidebar.tsx` renders it.

## 3. GAPS — owner dashboard for a plastics SME

Ranked by value to the owner/accountant/plant manager. Constraints: no concealment of transactions;
tenant-scoped; audited where it touches books/documents/masters; nav-gated; pg-boss for background
work; `notify()` for alerts; Tailwind only.

1. **Owner daily brief endpoint** — one `requirePermission`-gated, cached endpoint that answers
   "how is my business today" in one call (cash position, receivables due today/this week, today's
   production vs plan, machine status counts, rejection %, top 5 customers by receivable, pending
   orders, overdue payments, GST due dates this week, attendance today, power/utility cost if
   tracked). Rationale: today's summary endpoint returns raw unfiltered lists, nothing pre-computed/cached/gated. Data model: no new tables —
   aggregation service composing existing `insightsService`, `ageingService`, production/attendance
   models. Endpoints: `GET /api/v1/insights/owner-brief` (new method on `InsightsService`, reuse the
   `cached()` helper). Screens: new `/dashboard` "Owner Brief" card row at the top, mobile-friendly.
   Touches: insights, dashboard, ageing, production, attendance, gst-returns/compliance-calendar.
   Size: M. Isolation: buildable alone (read-only composition of existing services).

2. **WhatsApp daily summary to owner** — plastics SME owners live on WhatsApp, not dashboards;
   send the owner-brief numbers every morning via the existing `whatsappService`. Rationale: closes
   the loop the "owner daily brief" (gap 1) opens; matches how this persona actually consumes data.
   Data model: none, or a small `OwnerDigestPreference` (companyId, userId, enabled, sendHour) if
   per-owner opt-in/timing is wanted. Endpoints: none required (job-driven) or
   `PATCH /api/settings/owner-digest`. Jobs: new `OWNER_DIGEST` queue + fan-out job in `src/jobs/`,
   pattern-copy `compliance.job.ts` (daily fan-out, `runAsTenant`, calls `whatsappService.send` and
   `notify()`). Touches: jobs, whatsappservice, insights, notifications. Size: M. Sequencing: depends
   on gap 1's aggregation existing (or inline the same queries).

3. **Alert/notification rules engine (threshold watcher)** — today every `notify()` call is
   hand-coded per event (MSME clock, compliance calendar); there is no generic "if X crosses
   threshold Y, notify Z" primitive an owner or admin can configure (e.g. "notify me when any
   machine is idle > 2 hours", "notify when rejection % > 5% for a shift", "notify when cash balance
   < ₹X"). Rationale: every "exception report" gap below becomes actionable only when it pushes,
   not when someone remembers to check a screen. Data model: `AlertRule` (companyId, metric key,
   comparator, threshold, scope e.g. machine/store/global, audience `NotifyAudience`-shaped, cooldown
   minutes, isActive) + `AlertFire` (ruleId, firedAt, value, dedupe key) for audit/cooldown. Endpoints:
   `modules/alert-rules` CRUD, `requirePermission("alert-rules.*")`. Jobs: periodic evaluator job
   (e.g. every 15 min) that reads active rules, evaluates against live aggregates, calls `notify()`.
   Screens: `/settings/alerts` rule builder. Touches: notifications, jobs, dashboard/insights (metric
   sources), permissions. Size: L. Sequencing: build after 1-2 concrete alert use-cases exist so the
   metric registry isn't speculative; can proceed in parallel with domain teams supplying metric
   functions.

4. **Cash position widget with forecast** — today `getAccountsSummary` computes bank/cash balance
   but no forward view (what's due to be received/paid in next 7/30 days from open sales/purchase
   invoices and MSME clock). Rationale: #1 daily question for an SME owner is "how much cash do I
   have and what's coming". Data model: none new — compose `ageingService` receivable/payable buckets
   with due dates. Endpoints: extend `insights.accounts()` with a `next7Days`/`next30Days` bucket.
   Screens: cash position card with a simple bar. Touches: insights, dashboard, accounts/ageing.
   Size: S. Isolation: standalone.

5. **Today's production vs plan (owner view)** — `dashboard.tv.service.ts` already computes
   planned/produced/pending/achievement for the TV wall; the plain dashboard doesn't surface it
   as a single number with drill-down to which machines/orders are behind. Data model: none new.
   Endpoints: reuse `getTvSummary().production`; add drill-down
   `GET /api/dashboard/production-today?breakdown=machine|order`. Screens: dashboard card + drill-down
   table. Touches: dashboard, production-order, daily-production-plan, hourly-production. Size: S.
   Isolation: standalone (data already computed).

6. **Machine status board (owner-level, not shop-floor)** — a compact "N running / N idle / N down"
   with rejection % per machine for today, distinct from the detailed OEE dashboard
   (`oee-dashboard.view`) which is too granular for a daily owner glance. Data model: none new
   (from `machine`, `production-wastage`, `hourly-production`, `machine-operation-assignment`).
   Endpoints: `GET /api/dashboard/machine-status-today`. Screens: dashboard card, tap-through to
   `/oee-dashboard` for detail. Touches: dashboard, machine, production-wastage, hourly-production.
   Size: S. Isolation: standalone.

7. **Rejection % / scrap exception report** — plastics-specific: daily/weekly rejection and regrind
   % by machine, mould, material, shift with a threshold-flagged "needs attention" list. Rationale:
   rejection directly eats margin in injection/blow moulding; currently only raw
   `production-wastage` rows exist, no rolled-up report. Data model: none new — aggregate
   `ProductionWastage`/`HourlyProductionRecord`/`DailyProductionPlan`. Endpoints: `GET
/api/reports/rejection-summary?groupBy=machine|mould|material|shift&from&to`. Screens: new report
   page under `/reports`, exportable via `ExportCSVButton`. Touches: reports, production-wastage,
   hourly-production, daily-production-plan. Size: M. Isolation: standalone.

8. **Top customers / top products (rolling, with trend)** — dashboard has "recent sales orders" but
   no ranked "who buys the most / what sells the most, this month vs last". Data model: none new
   (aggregate `SalesInvoice`/`SalesInvoiceItem`). Endpoints: `GET /api/dashboard/top-customers`,
   `/top-products`. Screens: dashboard cards. Touches: dashboard, sales-invoice. Size: S. Isolation:
   standalone.

9. **Pending orders exception list (owner cross-cut)** — sales orders not yet dispatched past
   promised date, purchase orders overdue from suppliers, production orders behind schedule — one
   merged "what needs my attention today" list rather than three separate module screens. Data
   model: none new. Endpoints: `GET /api/dashboard/attention` (note: `insightsService.attention()`
   already exists at `/v1/insights/attention` — reuse/extend rather than duplicate; check its current
   contents first). Screens: dashboard "Needs Attention" panel. Touches: insights, sales-order,
   purchase-order, production-order. Size: S. Isolation: standalone, but check for overlap with
   existing `insights.attention()` before building — likely mostly already present.

10. **GST/compliance due-dates-this-week widget on owner dashboard** — `compliance.job.ts`/
    `COMPLIANCE_CALENDAR` already warns 7/2 days out via `notify()`, and `/compliance/calendar` is a
    full screen, but the owner dashboard itself shows nothing about upcoming filings. Data model:
    none new. Endpoints: small read endpoint reusing the compliance calendar's due-date computation.
    Screens: dashboard card linking to `/compliance/calendar`. Touches: dashboard, compliance,
    gst-returns. Size: S. Isolation: standalone.

11. **Attendance-today widget** — how many employees are marked present/absent/on-leave today,
    surfaced on the owner dashboard (currently `WorkforceShiftAttendance.tsx` exists as a dashboard
    component — verify it is wired to real attendance data or still a stub; if real, this gap is
    already partly covered and should be downgraded to "polish", not a new build). Touches:
    dashboard, employee/payroll (attendance). Size: S (verification first).

12. **Power/utility cost tracking** — plastics processing (injection/blow moulding, extrusion) is
    power-intensive; no `PowerReading`/`UtilityExpense` model found in schema. Rationale: owners
    explicitly asked (per brief) for power cost visibility; today only generic `expense` module
    exists with no per-machine or per-shift power attribution. Data model: `UtilityReading`
    (companyId, meterCode, readingDate, unitsConsumed, shiftId?, machineId?, ratePerUnit, cost) or
    simpler: a category on `Expense` plus a manual daily-entry screen; full metering integration is
    out of scope for MVP. Endpoints: `modules/utility-cost` CRUD + `GET
/api/reports/power-cost-summary`. Screens: `/production/power-cost` entry + dashboard card
    (cost per kg produced). Touches: new module, dashboard, production. Size: M. Isolation: standalone
    but needs a decision on manual-entry vs meter-integration scope before sizing precisely.

13. **Report builder / scheduled reports / export** — no generic report builder; each report is a
    bespoke endpoint (`reports.service.ts` has 5 hardcoded reports). No scheduling (email/WhatsApp a
    report on a cron) exists anywhere in `src/jobs/`. Rationale: accountants and owners routinely
    want "send me the sales report every Monday morning" — a real ERP capability. Data model:
    `ReportSubscription` (companyId, reportKey, params Json, cron/day-of-week, channel
    email/whatsapp, recipients, isActive) + reuse `notify()`/email/whatsapp senders. Endpoints:
    `modules/report-subscriptions` CRUD. Jobs: evaluator job (daily) matching due subscriptions,
    rendering via existing report services, sending via `sendEmail`/`whatsappService`. Screens:
    "Schedule this report" action on each existing report screen. Touches: reports, jobs,
    notifications, email-config, whatsappservice. Size: L. Sequencing: needs a small
    report-registry (name → renderer) refactor of `reports.service.ts` first so subscriptions can be
    generic rather than one cron per report; do after at least 2-3 more reports exist (gap 7, 8).

14. **Mobile-friendly owner view / PWA-lite dashboard** — current dashboard is a wide desktop grid
    (`DashboardStatsGrid`, multi-column cards); no responsive "owner glance" mode confirmed for phone
    width. Rationale: owners check the business from their phone, not a desktop. Data model: none.
    Endpoints: reuse gap 1's owner-brief endpoint. Screens: a `/dashboard?compact=1` or a dedicated
    `/m/dashboard` responsive layout, single-column, top 6 numbers + Needs Attention list. Touches:
    web dashboard module only. Size: M. Isolation: standalone (pure frontend once gap 1 exists).

15. **KPI targets & trend (owner-settable goals)** — no `Target`/`Goal` model; owners cannot set "₹X
    sales this month" or "≤3% rejection" and see progress. Data model: `KpiTarget` (companyId, metric
    key, period type month/quarter/year, targetValue, effectiveFrom). Endpoints: `modules/kpi-targets`
    CRUD + dashboard reads target alongside actual. Screens: dashboard "vs target" badges, settings
    screen to set targets. Touches: dashboard, new module, permissions. Size: M. Isolation:
    standalone but low value until gaps 1/7/8 give it real metrics to target.

16. **Dashboard permission enforcement** (bug fix, not a feature) — `dashboard.routes.ts` has no
    `requirePermission`; any authenticated user (any role) can call `/api/dashboard/accounts-summary`
    and see bank balances, receivables/payables by name, recent vouchers. The widget-level
    `dash-*` permission keys exist in the shared registry but aren't enforced on the API. Fix: add
    `requirePermission("dash-overview.view")`-equivalent gating per endpoint (or a single
    `dashboard.view` gate on `/accounts-summary` given it's the most sensitive). Size: S. Isolation:
    standalone, should be done regardless of any other gap here — flag to a human reviewer since it's
    a real access-control gap in the current codebase.

17. **Dashboard query cost/pagination** (bug fix) — `dashboard.controller.ts` `getSummary` fetches
    full `findMany()` of sales orders, purchase orders, production orders, weekly programs (`take:
100`), daily plans (`take: 50`) with no date filter for most; will degrade badly per tenant as
    data grows and has no test coverage. Fix: bound every list by date range and/or move to the
    `insights`-style cached-aggregate approach used elsewhere in this domain. Size: M. Isolation:
    standalone refactor; should precede gap 1 if gap 1 is meant to replace `/dashboard/summary`
    rather than sit alongside it.

18. **Reports permission granularity** — single `reports.view` gates all 5 reports; the registry
    already has finer-grained `sales-reports.view`, `purchase-reports.view`, `inventory-reports.view`,
    `production-reports.view`, `audit-reports.view` keys that this module ignores (either dead
    entries or meant for a different reports surface — needs a human decision, not a silent fix).
    Size: S once decided. Sequencing: clarify with the reports module owner before changing.

19. **Notification digest / grouping in-app** — `notifications.service.ts` lists individually; for
    a rules engine (gap 3) firing many alerts, an owner needs grouping/mute-by-category, not a raw
    feed. Data model: extend `Notification.category` usage with a per-user
    `NotificationPreference` (companyId, userId, category, muted). Endpoints: `modules/notifications`
    preferences CRUD. Screens: notification bell settings. Touches: notifications. Size: S.
    Sequencing: after gap 3 exists (no volume problem to solve yet otherwise).

20. **Exception dashboard for the accountant persona** — distinct from the owner brief: unposted
    draft vouchers, unreconciled bank lines, invoices without e-invoice/e-way bill where required,
    stale advances. Rationale: brief calls out "accountant" as a persona alongside owner/plant
    manager; today's alerts array in `getAccountsSummary` has a start (draft vouchers, negative bank
    balances) but it's embedded in one controller, not a reusable "accountant exceptions" endpoint.
    Data model: none new. Endpoints: `GET /api/v1/insights/accountant-exceptions` (new
    `InsightsService` method). Screens: `/dashboard` role-aware panel (only for accounting
    permissions) or a dedicated `/accounts/exceptions` screen. Touches: insights, accounts, e-invoice,
    eway-bill. Size: M. Isolation: standalone.

## 4. Sequencing summary

- **Build in isolation (no cross-domain deps beyond read access to existing tables)**: 4, 5, 6, 7, 8,
  9 (check overlap first), 10, 11 (verify first), 16 (fix), 17 (fix).
- **Needs sequencing**: 1 (foundation for 2, 14, partly 15, 20); 2 depends on 1; 3 (rules engine)
  should follow 1-2 concrete alert cases; 13 (report builder) should follow a small registry
  refactor and 2-3 more reports (7, 8); 15 (KPI targets) has low value until 1/7/8 exist; 19 depends
  on 3 creating notification volume; 18 needs a human decision before touching permission keys.
- **Fix, not feature, flag to reviewer**: 16 (dashboard has no permission gating — real
  access-control gap) and 17 (unbounded queries, no tests) are pre-existing quality issues in this
  domain, independent of any new gap work.
