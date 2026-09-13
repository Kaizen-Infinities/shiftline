# Shiftline — product context

## What it is

A multi-tenant ERP SaaS for Indian secondary-sector manufacturers (job-shop
and process manufacturing: production, machine scheduling, inventory, sales,
purchasing, accounts, GST/statutory compliance, payroll). Each tenant is a
manufacturing company; Shiftline is the vendor/product, never a tenant's own
brand.

Remastered from an earlier codebase ("Sun Sea ERP"). That name and its
branding are legacy history only — they must never appear in code, UI copy,
or assets going forward.

Current scale: 160 Prisma models, 85 API modules, ~59 integration suites
(400+ tests). This is a mature, deep ERP, not a starter app — most modules
already have real behaviour, real edge cases and real regulatory constraints
behind them.

## Platform

Web (React 19 SPA). There is also a field-sales mobile sync API
(`apps/api` `/api/mobile`) consumed by a native field app, but no native
client lives in this repository.

## Who uses it

- **Tenant company staff**, scoped by role/permission: owner, accountant,
  storekeeper, production supervisor, sales, auditor, and other permissioned
  roles defined per tenant (`packages/shared` permission registry; roles
  wired in `provisioningService`'s `ROLE_DEFS`).
- **Platform admins** — Shiftline's own operators, not tenant staff. No
  tenant context of their own; console screens sit behind a super-admin
  boundary and act on tenant data only through explicit, audited
  impersonation.
- **Field-sales device users** — native app, syncing through the mobile
  module with server-owned/append-only/merge conflict rules.
- (Roadmap) **Shop-floor operators, inspectors and maintenance staff**, and a
  **labour inspector** as an audience for statutory registers — see Roadmap
  below.

## Domain modules

Grouped by user task (see `docs/specs/P1-UI-remake.md` for the full route
inventory):

- **Operations** — dashboards (executive, production, OEE), status, weekly
  machine scheduling, daily planning/reporting, shift execution, hourly
  production/work reports, production orders, material issue, wastage.
- **Inventory** — categories, UOMs, store types, raw materials and stock,
  finished goods, products, BOMs, capacity/pricing history, stock
  adjustments, EOD stock, inventory reports.
- **Sales** — customers, grades/types, quotations, sales orders, dispatch and
  approvals, invoices, receivables, returns, sales reports.
- **Purchasing** — suppliers and pricing, purchase orders, GRN/invoice
  flows, payables, purchase reports.
- **People** — employees, departments, shifts, roles/permission mapping,
  users, attendance, payroll (dashboard, settings, runs, advances, payslips,
  reports), Labour Code entitlements (leave, gratuity, bonus, settlement).
- **Finance** — bank accounts, chart of accounts, vouchers, expenses, petty
  cash, ageing, statements, books, audit trail, year-end, bank
  reconciliation and cheques, valuation/costing/cost centres/budgets, fixed
  assets and depreciation, foreign exchange and import advances, MSME dues
  (Section 43B(h)), Tally XML export.
- **Compliance** — GST/HSN masters, filing approvals, e-invoice, e-way bill,
  transporters, the full GST-return set (GSTR-1, 2B/IMS, 3B and the ITC
  ledger, GSTR-9), TDS/TCS, the compliance calendar and GST hub, job work
  and delivery challans (ITC-04).
- **Billing & comms** — subscription billing and payment links (platform
  and tenant Razorpay), SMS/DLT templates and OTP delivery (MSG91),
  WhatsApp.
- **Tenant settings** — company profile, invoice/email settings, imports,
  export, devices, user profile.
- **Platform** — super-admin console: tenant overview, tenant detail, plans.

## Roadmap and current state (durable — check `docs/handoff/` for what has
actually shipped since this was last updated)

Work is commissioned in named phases, each with its own brief in
`docs/handoff/`. Read the *newest* handoff note before assuming any of the
below is still accurate.

- **Phase 1 (finished):** the compliance/money depth above — GST returns,
  TDS/TCS, Tally export, MSME dues, fixed assets, forex, costing, bank
  reconciliation, statutory payroll, Labour Code entitlements, subscription
  billing, SMS/OTP. 44 new models, 11 new modules.
- **Phase 2-T ("transition", current work as of this writing):** not new
  product surface — it closes cross-cutting gaps before Phase 2 starts:
  - Three jobs that exist only as manual/synchronous code and need to be
    pg-boss jobs: subscription invoicing, leave accrual, the SMS queue.
  - Labour Code overtime/wage rules are computed (`modules/payroll`'s P1-17b
    engine) but not yet wired into the actual payroll run, which still uses
    its own slabs.
  - The statutory inspector's registers (muster roll, wages, overtime,
    fines, deductions, advances) — reports over data that already exists,
    not new data.
  - **The frontend remake is genuinely mid-flight**: only slice 1 of 7 in
    `docs/specs/P1-UI-remake.md` has landed (Bootstrap and the origin logo
    removed, `apps/web/src/components/ui/TailwindPrimitives.tsx` and the
    semantic token system adopted app-wide). Slices 2–7 — shell/navigation
    polish, per-domain forms/tables/lists, and the final a11y/contrast/
    responsive hardening pass — are still to be built, in order. Do not
    assume a screen has had its "domain slice" treatment just because it
    renders with the new tokens.
  - Characterisation tests for eight modules Phase 2 is about to modify and
    that currently have **no integration coverage at all**: OEE, machine,
    production-order, hourly-production, inventory, GRN/invoice, goods
    dispatch, payroll.
- **Phase 2 (next, shop floor — nothing built yet beyond planning/manual
  entry):** machine telemetry ingestion (OPC UA / EUROMAP 63 / Modbus
  adapters, always behind a simulator — no package may block on hardware),
  machine-state timeline and live andon, energy metering, cycle-time
  variance and regrind ratio, preventive maintenance and breakdown tickets,
  quality foundation (characteristics/plans/rejection master), inspections/
  SPC/certificate of analysis, lot traceability and recall, engineering
  change control, CAPA and non-conformance, biometric attendance ingestion,
  piece-rate/incentive pay. Explicitly out of scope for Phase 2: operations
  scheduling/dispatch, shop-floor document control, the operator skill
  matrix, multi-warehouse/bin-location inventory, barcode picking, AI-vision
  defect detection, ESG disclosure. There is deliberately **no mould/tooling
  module** — do not go looking for one.
- **Standing gaps regardless of phase:** no payout reconciliation for the
  payment gateway and no SMS delivery receipts (both need a live vendor
  account); several fields are known-loose and scheduled to be tightened by
  a specific later package rather than fixed opportunistically (e.g.
  `Machine.machineStatus` as a single mutable column, `AttendanceRecord.date`
  as a `String`, operator-id CSV/string fields) — see the newest Phase brief
  for the current list before "fixing" one of these as a side effect of
  unrelated work.

## Business model and hard constraints

- **Multi-tenant, tenant-isolated.** Every query is scoped to a tenant
  (`companyId`); a cross-tenant lookup must return nothing. New tenants are
  provisioned only through `provisioningService`, onboarded through a
  wizard, and staffed through invitations — never a password emailed to a
  new user.
- **Plans and entitlements.** Some features are paywalled per plan
  (`useEntitlement` on the client, entitlement checks on the server); the UI
  must never be the only gate. Subscription billing runs through a platform
  Razorpay account; tenants pay their own customers through their own
  Razorpay account — these are separate integrations.
- **Indian statutory compliance is load-bearing, not decorative.** GST tax
  split by business-place state code vs. place of supply, HSN/rate from the
  item master, GSTIN validation, e-invoice/e-way bill through their provider
  abstractions only, document numbering through the shared series service.
  Numbers and dates render `en-IN`, INR, with lakh/crore grouping — this is
  existing, reused formatting, not a design choice to revisit. Filings
  cannot submit until `filingApprovalService.assertSubmittable` passes.
- **Books of account are permanent.** No hard delete; cancellation posts a
  reversal and is gated by the accounting period. Audit trail is a database
  trigger on a fixed model list, never a hand-written log row.
- **Hardware/device integrations are adapter-shaped and simulator-first.**
  The e-invoice/e-way-bill GSP providers, and every Phase 2 shop-floor
  device (PLC, energy meter, biometric reader), are reached only through a
  provider/adapter interface with a deterministic simulator; several exist
  today with no live account behind them yet (GSP, Razorpay, MSG91/DLT) —
  that is a known, deliberate, owner-blocked gap, not a bug to route around.
- **No hosting yet.** Runs locally via Docker compose; CI is GitHub Actions.

## Brand

Product name: **Shiftline**. Tenant-facing chrome (logo, company name, email
domain) comes from the tenant record, not from the product shell — the
product itself has no customer-facing marketing site or public brand voice
to protect beyond "Shiftline" and its own login/onboarding screens.

## Design system status (current, not aspirational)

A single Tailwind v4 design language exists and its foundation is adopted
app-wide, but the *domain-level* redesign work is only one slice of seven
done — see Roadmap above before treating any given screen as finished (see
`docs/specs/P1-UI-remake.md` for the accepted spec;
`apps/web/src/assets/css/style.css` defines the tokens as CSS custom
properties under `@theme`, switched by `[data-theme="light"|"dark"]`):

- Neutral slate surfaces (`page`, `card`, `ink`, `line`) with a single teal
  `accent` (`#0d9488` light / `#2dd4bf` dark), light and dark themes fully
  defined, default theme dark, user-toggleable and persisted
  (`localStorage: shiftline-theme`).
- Dense, data-heavy screens: tables, cards, status badges and dialogs share
  spacing/state treatment; every screen must stay usable at a 400px
  viewport with local (not page-level) horizontal scroll on tables.
- Accessibility floor: WCAG 2.1 AA contrast, visible focus rings, ≥40px
  targets, Escape-to-close and focus-trapped/restored dialogs, colour never
  the sole status cue. This floor is a *target* for the still-pending
  hardening slice, not a verified property of every existing screen yet.
- No Bootstrap/React-Bootstrap; no new UI dependency without cause. A small
  legacy pocket of old (`bg-surface`, `sidebar-*`, red-primary) styling
  still exists in a handful of files (`tailwind.config.js` v3-style tokens)
  — treat as not-yet-migrated debris, not the intended direction.

## Non-goals for design/UI work

No backend, schema, endpoint, route, role, entitlement, or accounting-rule
changes as a side effect of visual work. No route redesign, no replacing
Redux/RTK Query, no speculative workflow removal. All HTTP goes through
`apiClient`/RTK `baseApi`; realtime through tenant-scoped socket rooms
(`useSocketSync`) — these are fixed, not negotiable during design changes.

## References

- `CLAUDE.md` — working conventions: tenancy, module structure, security,
  the full "definition of done."
- `docs/specs/P1-UI-remake.md` — the accepted design-system/navigation spec
  this codebase is executing against.
- `docs/handoff/2026-09-12-phase-1-complete.md` — the Phase 1 map and its
  carried-over gaps.
- `docs/handoff/2026-09-13-commission-phase-2-transition.md` and
  `docs/handoff/2026-09-13-commission-phase-2.md` — the current and next
  commissioned phases; read the newer of these plus the newest dated note
  in `docs/handoff/` for what is actually in flight right now.
- `docs/specs/` — one half-page spec per work package.
