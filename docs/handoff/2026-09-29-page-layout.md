# Page layout — one frame for every screen

**Changelog:** Every screen now starts at the same place, with the same spacing between its title,
filters and content, and titles, tables and buttons fit phones and touch screens.

Spec: `docs/specs/UI-v2.md` › "Page layout". Commits `c0d47be`, `c3b1708` and the follow-up on
this branch. Visual only: no route, permission, data call or test id changed.

## Before

Page roots carried their own spacing (`space-y-3/4/6`, `my-3`, centred `max-w-[1480px]`
wrappers with padding), so the title, the content edge and the gaps moved from screen to screen.
`PageHeader`'s `mb-5` and `Toolbar`'s `mb-4` stacked on top of the page's own spacing (36 px from
toolbar to table on some pages), tables were drawn as a card inside a card, long titles were cut
off on phones, and small pill buttons were 36 px tall on touch screens.

## Now

- **`.sl-page`** (component layer in `assets/css/style.css`) is the page root: a column with a
  20 px gap. `PageBody` (production) and `PageShell` (payroll/HR) render it. Width tiers only move
  the right edge: none for lists, reports and consoles; `.sl-page-form` (70 rem) for forms and
  settings; `.sl-page-doc` (90 rem) for document editors and views.
- **Spacing lives in component rules, not utilities.** `.sl-page-header` and `.sl-toolbar` own their
  margins and give them back inside `.sl-page`. Tailwind utilities outrank component rules, so a
  `mb-*` or `space-y-*` on a page root or header would undo this: do not add them.
- **Toolbar to table is 16 px** on every page; **a `DataTable` inside a tile** is a framed region
  (`.sl-tile .sl-table-tile`), so do not wrap one in another `Tile`.
- **Titles** wrap below `sm` and truncate from `sm` up; the in-page breadcrumb shows below `lg`.
- **Touch targets:** chips, tabs and every pill button, including `.sl-pill-sm`, are at least 40 px
  on `pointer: coarse`. The `.sl-pill-sm` rule restates it because it is declared later.
- The hand-built headers on the accounts screens (Forex, Tally, Costing, Bank reconciliation,
  Fixed assets, MSME), audit trail, and sales/purchase returns are `PageHeader` now; the books and
  statements screens use `.sl-page`; the ledger statement has a title while it is being set up.
  `ReportFilterBar` (accounts) no longer carries `mb-4`: every report using it sits in `.sl-page`.
- **Smoke test:** the marker check matches visible text only (`filter({ visible: true })`). The
  in-page breadcrumb repeats the title and comes first in the DOM, but is hidden from `lg` up, so
  `.first()` alone picked the hidden copy on five screens.

## Checked

A measuring script over all routes at 1440 × 900 and 390 × 844 (signed in as the seeded owner):
no console errors, no horizontal page scroll on phones, no truncated titles on phones, and the
title sits at the same x/y on every desktop screen except three back-button rows (5 px lower,
consistent with each other). Intentional exceptions: the home dashboard keeps 32 px between its
labelled sections; a toolbar sits 16 px above its table. A title without a header icon starts at
the content edge, one with an icon 56 px further in.

`e2e/smoke.spec.ts` and `e2e/platform.spec.ts` passed three runs in a row (59/59).

Running e2e locally:

- Point Playwright at the preinstalled browser with `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Set `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` to the seeded admin. A database seeded before the
  `.env` quoting fix has the password `DevAdmin`, cut off at the `#`.
- Failed sign-ins count per IP in `login_attempts`, and a run with a wrong password locks
  localhost out with a 429. Clear `login_attempts where success = false` in the dev database.

## Open

- `modules/purchase/purchase-order/upcoming-orders/` (InvoiceList, UpComingOrderDetail,
  UpComingOrderList) is unrouted dead code with a placeholder title; delete it?
- `PRODUCT.md` contradicts the maker credit in the footer ("Applied Softwares" is intentional).
- The API answers a tenantless tenant-scoped call with 500; a 4xx is a tenancy/auth change and
  needs the named human approver.
