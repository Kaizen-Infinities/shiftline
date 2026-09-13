# P1-UI — frontend remake

## Why

Shiftline's web client grew screen by screen from the origin application and consequently mixed two visual systems, carried a fixed logo, and behaved inconsistently on small screens. This remake establishes one accessible Tailwind design language without changing the ERP's routes, workflows, data fetching, security boundaries, realtime behaviour, or Indian financial conventions. The work is an independent Phase 1 track: shared foundations land first, followed by domain slices that remain shippable after every commit.

## Design system and navigation

- **Visual language (revised in slice 2):** "The Passbook Ledger" — warm paper-neutral surfaces (cream light theme / graphite-charcoal dark theme) with one reserved registry-ink accent (cinnabar/vermillion), flat and hairline-ruled rather than shadowed-card chrome, expressed through the same semantic tokens (`page`, `card`, `ink`, `line`, `accent`) so the palette can keep evolving without touching component code. The One Ink Rule: the accent marks status stamps and the primary action only, never decoration. Screens are not forced into one metaphor: a shared foundation (tokens, type, flat/ruled materiality, the universal ink-stamp status vocabulary) hosts five purpose-built registers layered in per domain as their slices land — Ledger (finance/accounts/GST returns/payroll runs), Allocation (scheduling/rosters/assignment grids), Document (GST/e-invoice/purchase-sales orders), Monitoring (dashboards/OEE, and Phase 2 andon/telemetry), and Plain (master data/settings — no added metaphor). The direction contract and how it was chosen (three direction-scope rolls weighed against catalog challengers, then a pinned per-domain decision) live in `apps/web/.impeccable/surfaces/apps-web-src-components-layout-baselayout-tsx.md`. Dense data remains readable; cards, tables, fields, status badges and dialogs share predictable spacing and state treatments.
- **Responsive shell:** horizontal, permission-filtered navigation on desktop; a modal drawer below `lg`; content has fluid gutters and tables scroll inside their own region. Every slice supports a 400 px viewport without page-level horizontal overflow.
- **Interaction:** native controls and landmarks first. All interactive elements have a visible focus ring, minimum 40 px target, useful labels, Escape-close dialogs, trapped dialog focus, focus restoration, and keyboard navigation. Colour is never the only status cue and theme colours meet WCAG AA for normal text.
- **Security and capabilities:** `ProtectedRoute` remains the route boundary, navigation applies the identical permission predicate, platform pages remain `superAdmin`, and paid affordances continue to use `useEntitlement`. No UI check replaces server enforcement.
- **Data:** existing services continue through `apiClient`/RTK `baseApi`; token refresh, auth state, tenant socket rooms, `useSocketSync`, and cache invalidation are unchanged. Dates and numbers retain existing `en-IN`, INR, lakh and crore formatting.
- **Dependencies:** no dependency is added. Bootstrap and React Bootstrap are removed. The replacement primitives are repo-owned Tailwind components so modal and form behaviour can be migrated without changing business handlers.

## Scope and route inventory

The inventory is grouped by user task rather than source folder. A checked group has completed its domain slice in the current (slice 2+) visual direction; pages are migrated as complete domain slices and retain their current URL and actions. These checkboxes previously all read done — that was inaccurate (see `docs/handoff/2026-09-13-commission-phase-2-transition.md`): only the Foundation slice (tokens, primitives, Bootstrap removal) had actually landed. Corrected here as slice 2 begins.

- [x] **Foundation and public** (slice 2, done): login, invitation acceptance, reset password, onboarding wizard (all six steps), unauthorised and not-found — all in the new direction; responsive application shell, tenant branding, theme switch, notification centre, impersonation banner (done, new direction); shortcut panel (also fixed to stop rendering on mobile, and to stop ignoring the active theme) and the floating calculator (also fixed to stop ignoring the active theme) — done.
- [ ] **Home and operations:** executive, production and OEE dashboards; status; weekly scheduling; daily planning and reporting; shift execution; hourly production/work reports; production orders and material issue.
- [ ] **Inventory** (masters done, slice 3): categories, UOMs, store types, storage and wastage stores, raw materials, finished goods and products are done in the new direction; BOMs live inside the product form and moved with it. Capacity and pricing history, stock adjustment, EOD stock and inventory reports are dense operational screens, not masters — still slice 4.
- [ ] **Sales** (masters done, slice 3): customers and grades/types are done. Quotations, sales orders, dispatch and approvals, invoices, receivables, returns and sales reports are document/ledger screens — still slice 5.
- [ ] **Purchasing** (masters done, slice 3): suppliers and pricing (including the material-pricing list) are done. Purchase orders, upcoming orders, GRN/invoice flows, payables and purchase reports are still slice 5.
- [ ] **People** (masters done, slice 3): employees, departments, shifts, roles, permission mapping and users are done. Attendance, payroll dashboard/settings/runs, salary advances, payslips and weekly/monthly reports are still slice 6.
- [ ] **Finance** (masters done, slice 3): bank accounts and chart of accounts are done. Vouchers, expenses, petty cash, ageing, statements, books, audit trail, year-end and finance reports are still slice 5.
- [ ] **Compliance** (masters done, slice 3): GST/HSN masters are done. Filing approvals, e-invoice register/panels, e-way bills/panels and transporters are still slice 5/6.
- [x] **Tenant settings** (slice 3, done): company profile/settings, invoice and email settings, WhatsApp, imports, export, devices and profile — all in the new direction.
- [ ] **Platform:** overview, tenants/detail and plans, all behind the super-admin boundary.

Route declarations in `AppRoutes.tsx` are the canonical detailed inventory. A route is not removed or renamed as part of visual migration. Existing smoke entries remain the release inventory; marker text changes only when the corresponding page heading changes.

## Migration slices

1. **Foundation (this slice):** document the direction; remove framework packages and origin assets; add accessible Tailwind layout/form/card/table/dialog primitives; migrate every remaining framework import and tenant-logo fallback. This makes the whole application one CSS system while preserving component props and handlers.
2. **Shell and public experience:** consolidate navigation information architecture, skip link and landmarks, mobile drawer behaviour, login/onboarding and empty/error/loading states.
3. **Masters and settings (done):** standard list toolbar, responsive filters, forms, destructive confirmations and detail summaries.
4. **Operations and inventory:** dense boards, schedules, production interactions and horizontally scrollable tabular data.
5. **Commercial and finance:** document editors, totals, approvals, print actions and Indian numeric presentation.
6. **People, compliance and platform:** payroll, registers, provider panels, tenant administration and audit-oriented detail views.
7. **Hardening:** keyboard-only and screen-reader audit, light/dark contrast audit, 400/768/1280 px visual regression and the complete authenticated smoke matrix.

Each slice must preserve API payloads, URL/search state, permissions, feature entitlements, socket subscriptions, download/print behaviour, and validation. A slice is done only when web typecheck, lint, build and Playwright smoke pass and its before/after screenshot is attached to the pull request.

## Out of scope

No backend, schema, endpoint, authentication, role, entitlement or accounting-rule changes; no route redesign; no replacement of Redux/RTK Query/React Query; no new charting or icon dependency; no speculative workflow removal. Historical handoff prose and migration documentation are not user-facing branding assets and are left intact.

## Acceptance

- There is no Bootstrap package or import in the web workspace and no origin logo/name in runtime web source or assets.
- Every existing route resolves through its original protection boundary and all controls still call the existing service methods with unchanged request/response shapes.
- Light/dark themes, tenant branding, per-tenant realtime refresh and Indian formatting continue to work.
- At 400 px, primary tasks are usable without page overflow; data tables provide local scrolling.
- Dialogs support Escape, focus containment and restoration; all controls are keyboard reachable with visible focus; semantics and contrast meet WCAG 2.1 AA.
- `npm run typecheck -w @shiftline/web`, web lint/build and `npm run e2e` are green, with screenshots captured for perceptible slices.
