# Shiftline — product context

## What it is

A multi-tenant ERP SaaS for Indian secondary-sector manufacturers (job-shop and
process manufacturing: production, machine scheduling, inventory, sales,
purchasing, accounts, GST/statutory compliance, payroll). Each tenant is a
manufacturing company; Shiftline is the vendor/product, never a tenant's own
brand.

Remastered from an earlier codebase ("Sun Sea ERP"). That name and its
branding are legacy history only — they must never appear in code, UI copy,
or assets going forward.

## Platform

Web (React 19 SPA). There is also a field-sales mobile sync API
(`apps/api` `/api/mobile`) consumed by a native field app, but no native
client lives in this repository.

## Who uses it

- **Tenant company staff**, scoped by role/permission: owner, accountant,
  storekeeper, production supervisor, sales, auditor, and other permissioned
  roles defined per tenant (`packages/shared` permission registry).
- **Platform admins** — Shiftline's own operators, not tenant staff. No
  tenant context of their own; console screens sit behind a super-admin
  boundary and act on tenant data only through explicit, audited
  impersonation.
- **Field-sales device users** — native app, syncing through the mobile
  module with server-owned/append-only/merge conflict rules.

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
  users, attendance, payroll (dashboard, settings, runs, advances,
  payslips, reports).
- **Finance** — bank accounts, chart of accounts, vouchers, expenses, petty
  cash, ageing, statements, books, audit trail, year-end.
- **Compliance** — GST/HSN masters, filing approvals, e-invoice, e-way bill,
  transporters.
- **Tenant settings** — company profile, invoice/email settings, WhatsApp,
  imports/export, devices, user profile.
- **Platform** — super-admin console: tenant overview, tenant detail, plans.

## Business model and hard constraints

- **Multi-tenant, tenant-isolated.** Every query is scoped to a tenant
  (`companyId`); a cross-tenant lookup must return nothing. New tenants are
  provisioned only through `provisioningService`, onboarded through a wizard,
  and staffed through invitations — never a password emailed to a new user.
- **Plans and entitlements.** Some features are paywalled per plan
  (`useEntitlement` on the client, entitlement checks on the server); the UI
  must never be the only gate.
- **Indian statutory compliance is load-bearing, not decorative.** GST tax
  split by business-place state code vs. place of supply, HSN/rate from the
  item master, GSTIN validation, e-invoice/e-way bill through their provider
  abstractions only, document numbering through the shared series service.
  Numbers and dates render `en-IN`, INR, with lakh/crore grouping — this is
  existing, reused formatting, not a design choice to revisit.
- **Books of account are permanent.** No hard delete; cancellation posts a
  reversal and is gated by the accounting period. Audit trail is a database
  trigger on a fixed model list, never a hand-written log row.
- **No hosting yet.** Runs locally via Docker compose; CI is GitHub Actions.

## Brand

Product name: **Shiftline**. Tenant-facing chrome (logo, company name, email
domain) comes from the tenant record, not from the product shell — the
product itself has no customer-facing marketing site or public brand voice
to protect beyond "Shiftline" and its own login/onboarding screens.

## Design system status (current, not aspirational)

A single Tailwind v4 design language is implemented and largely migrated
across the web app (see `docs/specs/P1-UI-remake.md` for the accepted spec;
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
  the sole status cue.
- No Bootstrap/React-Bootstrap; no new UI dependency without cause. A small
  legacy pocket of old (`bg-surface`, `sidebar-*`, red-primary) styling
  still exists in a handful of files (`tailwind.config.js` v3-style tokens,
  ~6 stray usages) — treat as not-yet-migrated debris, not the intended
  direction.

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
- `docs/specs/` — one half-page spec per work package.
- `docs/handoff/` — dated session hand-off notes; read the newest one first.
