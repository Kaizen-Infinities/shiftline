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
- **Labour inspector** — the audience for the statutory registers (muster
  roll, wages, overtime, fines, deductions, advances), which are built
  (Payroll → Registers).
- (Roadmap, not yet built) quality inspectors, maintenance staff and
  shop-floor operators as their own roles.

## Product Purpose

Shiftline runs the day-to-day operations of an Indian secondary-sector
manufacturer — production scheduling and shift execution, inventory, sales
and purchasing, accounts — while treating Indian statutory compliance (GST,
e-invoice, e-way bill, TDS/TCS, MSME Section 43B(h), Labour Code payroll) as
load-bearing rather than a bolt-on module. Success means a tenant can run its
business and stay compliant without a parallel spreadsheet/Tally workflow,
and the ERP is never the reason a filing is late or a book is wrong.

## Positioning

**Stated by the product owner (2026-10-05):** run your factory and know what is
happening, no matter where you are. The USP is the plain usefulness of one system
that shows orders, production, stock, money owed and owing, and compliance status
to the owner from any device, not a clever differentiator.

Still not confirmed: any competitive claim (e.g. "vs. Tally", "vs. SAP B1",
"shop-floor-first"). Do not invent one in copy or design work; ask before anything
implies one. Cash must always be recorded, never hidden (see
`docs/decisions/2026-09-14-no-hidden-books.md`).

No customer evidence exists yet. Desk research and the ranked problems are in the
Shiftline project doc `market-research-v1`.

## Operating Context

- **Multi-tenant SaaS.** Each tenant is one manufacturing company, created
  only through `provisioningService.provisionTenant()`, finished by its
  owner in an onboarding wizard, and staffed through invitations — never a
  password sent by email.
- **Hosted.** Live at https://shiftline.apps.kaizeninfinities.com on a
  single-node kind cluster; see
  [`docs/runbooks/hosting.md`](docs/runbooks/hosting.md). Also runs locally
  via Docker compose; CI is GitHub Actions.
- **Monorepo, npm workspaces:** `apps/api` (Express 5, Prisma 6, PostgreSQL,
  pg-boss, pino, zod), `apps/web` (React 19 SPA, Vite, Redux Toolkit,
  Tailwind), `packages/shared` (permission registry, feature tiers, API
  paths, filings registry), `packages/config`, `e2e` (Playwright).
- **Where things stand.** [`docs/AS-BUILT.md`](docs/AS-BUILT.md) records
  what is live, [`docs/STATUS.md`](docs/STATUS.md) the current state, and
  [`docs/ROADMAP.md`](docs/ROADMAP.md) what comes next. Each work package has
  a spec in `docs/specs/` and a hand-off note in `docs/handoff/`. Hidden or parallel books are ruled out; a mould/tooling module is an open
  owner decision (see the roadmap).

## Capabilities and Constraints

The 12 live hubs (see [`docs/AS-BUILT.md`](docs/AS-BUILT.md)), plus the
platform console. The route inventory is `apps/web/src/routes/AppRoutes.tsx`.

- **Dashboard** — executive dashboard: money tiles, alerts, stock,
  workforce, field map.
- **Sales** — quotations, sales orders, invoices, returns, advances,
  customers, goods dispatch, delivery schedules.
- **Purchases** — purchase orders, goods receipt, suppliers, returns,
  expenses.
- **Inventory** — raw materials and finished goods, wastage, stock
  adjustments, categories, UOMs, stores, products.
- **Production** — production orders, weekly and daily planning, shift
  execution, hourly reports, order milestones, job work (ITC-04), machines,
  OEE, TV display.
- **Exports** — export incentives, forex, currency rates.
- **Accounts** — vouchers, day book and ledgers, chart of accounts,
  receivables, payables, MSME dues, costing, year-end, fixed assets, Tally
  export.
- **Banking & Payments** — bank reconciliation, bank and cash books, petty
  cash, payment links, bank accounts.
- **GST & Compliance** — GST returns, e-invoice, e-way bill, TDS/TCS,
  compliance calendar, filing approvals, GST/HSN masters, transporters.
- **Reports** — financial statements, audit trail, sales, purchase,
  inventory and production reports.
- **People** — employees, departments, attendance, leave, Labour Code
  entitlements.
- **Payroll** — payroll run, statutory dues, registers, fines and
  deductions, advances, settings, reports.
- **Settings** — company and invoice settings, users and roles, permission
  matrix, imports, account export, integrations (e-invoice, WhatsApp, SMS,
  email, devices).
- **Platform console** — super-admin: tenant overview, tenant detail, plans.

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
  codebase" is history only — its name and assets must
  never appear in code, UI, or new assets.

## Brand Commitments

Product name: **Shiftline**. There is no customer-facing marketing site;
brand voice exists only within the product itself (login, onboarding, and
its screens). Tenant-facing chrome — logo, company name, email domain —
comes from the tenant record, not from the product shell: the shell carries
no fixed brand identity beyond "Shiftline." The origin codebase's name and
assets must not appear anywhere in code, UI, or assets going forward.

The sidebar currently reads "by Applied Softwares"
(`apps/web/src/components/brand/BrandMark.tsx`); whether to keep it is an
open owner decision.

## Evidence on Hand

No external evidence exists (customer testimonials, case studies, press,
usage metrics) and none should be fabricated. What exists: a seeded demo
tenant exercising the real workflows (credentials in `README.md`), the live
walk-through in [`docs/AS-BUILT.md`](docs/AS-BUILT.md), and dated specs
(`docs/specs/`) and hand-off notes (`docs/handoff/`) recording what has
shipped. Treat `docs/AS-BUILT.md` and `docs/STATUS.md` as the source of
truth for current completeness, not this file.

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
([`docs/specs/UI-v2.md`](docs/specs/UI-v2.md)): visible focus rings, ≥40px
targets, keyboard reachability, Escape-to-close and focus-trapped/restored
dialogs, colour never the sole status cue, usable at a 400px viewport with
tables scrolling locally rather than the page. It is a target, not a
guarantee: the UI-v2 rollout to the remaining areas and a hardening pass are
on the roadmap ([`docs/ROADMAP.md`](docs/ROADMAP.md)), so new UI work should
meet the standard rather than assume it already holds everywhere.
