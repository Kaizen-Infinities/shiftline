# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are **tenant company staff** running day-to-day operations for
an Indian secondary-sector manufacturer (job-shop / process manufacturing):
owner, accountant, storekeeper, production supervisor, sales, auditor, and
other permissioned roles defined per tenant (`packages/shared` permission
registry; roles wired in `provisioningService`'s `ROLE_DEFS`).

Other confirmed audiences:

- **Platform admins** — Shiftline's own operators, not tenant staff. No
  tenant context of their own; provision tenants and manage plans; touch
  tenant data only through explicit, audited impersonation.
- **Field-sales device users** — a native field app syncing sales/visit data
  through `apps/api`'s `/api/mobile`, under server-owned/append-only/merge
  conflict rules. No native client lives in this repository.
- (Roadmap, Phase 2 — not yet built) shop-floor operators, quality
  inspectors and maintenance staff; a labour inspector as the audience for
  statutory registers (muster roll, wages, overtime, fines, deductions,
  advances).

## Product Purpose

Shiftline runs the day-to-day operations of an Indian secondary-sector
manufacturer — production scheduling and shift execution, inventory, sales
and purchasing, accounts — while treating Indian statutory compliance (GST,
e-invoice, e-way bill, TDS/TCS, MSME Section 43B(h), Labour Code payroll) as
load-bearing rather than a bolt-on module. Success means a tenant can run its
business and stay compliant without a parallel spreadsheet/Tally workflow,
and the ERP is never the reason a filing is late or a book is wrong.

## Positioning

**Undecided — not yet confirmed by the product owner.** Do not invent a
competitive claim (e.g. "vs. Tally", "vs. SAP B1", "shop-floor-first") in
copy or design work; ask before anything implies one. Revisit this section
once the owner states the claim.

## Operating Context

- **Multi-tenant SaaS.** Each tenant is one manufacturing company, created
  only through `provisioningService.provisionTenant()`, finished by its
  owner in an onboarding wizard, and staffed through invitations — never a
  password sent by email.
- **No hosting yet.** Runs locally via Docker compose; CI is GitHub Actions.
  There is no production deployment to design around yet.
- **Monorepo, npm workspaces:** `apps/api` (Express 5, Prisma 6, PostgreSQL,
  pg-boss, pino, zod), `apps/web` (React 19 SPA, Vite, Redux Toolkit,
  Tailwind), `packages/shared` (permission registry, feature tiers, API
  paths, filings registry), `packages/config`, `e2e` (Playwright).
- **Commissioned in named phases**, each with a brief in `docs/handoff/` and
  a spec per work package in `docs/specs/`. Read the _newest_ dated note in
  `docs/handoff/` before assuming any status below is still current —
  phase status is the most perishable fact in this file.
  - **Phase 1 (finished):** GST returns (1, 2B/IMS, 3B + ITC ledger, 9),
    TDS/TCS, Tally XML export, MSME 43B(h), fixed assets/depreciation,
    forex and import advances, costing/valuation/cost centres/budgets, bank
    reconciliation and cheques, statutory payroll, Labour Code entitlements
    (leave, gratuity, bonus, settlement), subscription billing and payment
    links, SMS/DLT/OTP. 44 new models, 11 new modules.
  - **Phase 2-T ("transition", in flight as of this writing):** closes
    cross-cutting gaps before Phase 2 starts — three jobs that exist only
    as manual/synchronous code and need to become pg-boss jobs (subscription
    invoicing, leave accrual, the SMS queue); Labour Code overtime/wage
    rules computed but not yet wired into the actual payroll run; the
    statutory inspector's registers (reports over existing data); the
    frontend remake (only slice 1 of 7 in `docs/specs/P1-UI-remake.md` has
    landed — do not assume a screen has had its domain-slice treatment just
    because it renders with the new design tokens); characterisation tests
    for eight modules with **no integration coverage today** (OEE, machine,
    production-order, hourly-production, inventory, GRN/invoice, goods
    dispatch, payroll).
  - **Phase 2 (next, shop floor — nothing built yet beyond planning/manual
    entry):** machine telemetry (OPC UA / EUROMAP 63 / Modbus, always
    behind an adapter + simulator), machine-state timeline and live andon,
    energy metering, cycle-time variance and regrind ratio, preventive
    maintenance and breakdown tickets, quality foundation, inspections/SPC/
    certificate of analysis, lot traceability and recall, engineering
    change control, CAPA and non-conformance, biometric attendance
    ingestion, piece-rate/incentive pay. Explicitly out of scope: operations
    scheduling/dispatch, shop-floor document control, the operator skill
    matrix, multi-warehouse/bin-location inventory, barcode picking,
    AI-vision defect detection, ESG disclosure. There is deliberately **no
    mould/tooling module** carried over from the origin codebase.
- Scale as of this writing: 160 Prisma models, 85 API modules, ~59
  integration suites (400+ tests).

## Capabilities and Constraints

Confirmed domain modules, grouped by user task (full route inventory in
`docs/specs/P1-UI-remake.md`):

- **Operations** — dashboards (executive, production, OEE), status, weekly
  machine scheduling, daily planning/reporting, shift execution, hourly
  production/work reports, production orders, material issue, wastage.
- **Inventory** — categories, UOMs, store types, raw materials and stock,
  finished goods, products, BOMs, capacity/pricing history, stock
  adjustments, EOD stock, inventory reports.
- **Sales** — customers, grades/types, quotations, sales orders, dispatch
  and approvals, invoices, receivables, returns, sales reports.
- **Purchasing** — suppliers and pricing, purchase orders, GRN/invoice
  flows, payables, purchase reports.
- **People** — employees, departments, shifts, roles/permission mapping,
  users, attendance, payroll (dashboard, settings, runs, advances,
  payslips, reports), Labour Code entitlements.
- **Finance** — bank accounts, chart of accounts, vouchers, expenses, petty
  cash, ageing, statements, books, audit trail, year-end, bank
  reconciliation, costing/valuation/budgets, fixed assets, forex, MSME
  dues, Tally export.
- **Compliance** — GST/HSN masters, filing approvals, e-invoice, e-way
  bill, transporters, the full GST-return set, TDS/TCS, job work and
  delivery challans (ITC-04), the compliance calendar and GST hub.
- **Billing & comms** — subscription billing and payment links (platform
  and tenant Razorpay, kept as separate integrations), SMS/DLT/OTP
  (MSG91), WhatsApp.
- **Tenant settings** — company profile, invoice/email settings, imports,
  export, devices, user profile.
- **Platform** — super-admin console: tenant overview, tenant detail,
  plans.

Hard constraints that bound any future work:

- **Tenant isolation is absolute.** Every query is scoped to `companyId`;
  every module's integration suite proves a foreign `companyId` returns
  nothing.
- **Books of account are permanent.** No hard delete; cancellation posts a
  reversal and is gated by the accounting period. Audit trail is a
  database trigger on a fixed model list, never a hand-written log row.
- **Plans and entitlements gate paid features server-side**
  (`useEntitlement` on the client mirrors, never replaces, the server
  check).
- **Document numbering, GST tax-split, and filing submission** each run
  through one fixed shared service (`documentNumberService`, `gst.calc.ts`/
  `gst.context.ts`, `filingApprovalService.assertSubmittable`) — never
  reimplemented per module.
- **Every hardware or external-provider integration is adapter-shaped and
  simulator-first**: the GSP (e-invoice/e-way bill), Razorpay, MSG91, and
  every planned Phase 2 shop-floor device reach the outside world only
  through a provider/adapter interface with a deterministic simulator.
  Several of these have no live account behind them yet — a known,
  deliberate, owner-blocked gap, not a defect to route around.
- Terminology: a **tenant** is one manufacturing company. "The origin
  codebase" ("Sun Sea ERP") is history only — its name and assets must
  never appear in code, UI, or new assets.

## Brand Commitments

Product name: **Shiftline**. There is no customer-facing marketing site;
brand voice exists only within the product itself (login, onboarding, and
its screens). Tenant-facing chrome — logo, company name, email domain —
comes from the tenant record, not from the product shell: the shell carries
no fixed brand identity beyond "Shiftline." The prior codebase's name and
assets ("Sun Sea") must not appear anywhere in code, UI, or assets going
forward.

## Evidence on Hand

No external evidence exists (customer testimonials, case studies, press,
usage metrics) and none should be fabricated. What exists: a seeded demo
tenant exercising the real workflows (credentials in `README.md`), and
dated specs (`docs/specs/`) and hand-off notes (`docs/handoff/`) recording
what has actually shipped, package by package. Treat the newest hand-off
note as the source of truth for current completeness — not this file's
Operating Context snapshot, which will drift.

## Product Principles

1. Tenant isolation is non-negotiable — every query scoped, every module
   proven with a cross-tenant test.
2. Compliance and accounting integrity are load-bearing, not decorative —
   filings gate on approval, books never hard-delete, numbering and tax
   logic each run through one shared service.
3. No device or external provider is trusted directly — everything reaches
   hardware or a portal through an adapter with a deterministic simulator,
   so a missing live account never blocks the code that will use it.
4. One system, not parallel ones — a single Tailwind design language and a
   single state/data pattern (RTK/axios services), not accreted frameworks
   or ad hoc HTTP calls.
5. Say what's unfinished — specs and hand-off notes record gaps explicitly
   (owner-blocked items, half-done slices, missing tests) rather than
   presenting partial work as done.

## Accessibility & Inclusion

WCAG 2.1 AA is an explicit, committed standard for the web app
(`docs/specs/P1-UI-remake.md`): visible focus rings, ≥40px targets,
keyboard reachability, Escape-to-close and focus-trapped/restored dialogs,
colour never the sole status cue, usable at a 400px viewport with tables
scrolling locally rather than the page. This is a target the frontend
remake is still completing — only its foundation slice has landed — so new
UI work should meet the standard rather than assume it already holds
everywhere.
