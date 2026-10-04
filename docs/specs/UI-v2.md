# UI v2 — concept-art remake (design spec)

Owner's brief (2026-09-25): remake **everything visible** after the concept art. Full control over
design, navigation and categories; nothing from the old look or menu structure has to survive.
Every route and permission must still be reachable.

## The concept, in words

A calm, airy, cool-white product. The page is a pale blue-grey (`--color-page`). Everything sits on
**white rounded tiles** with a very soft, cool shadow: navigation rows, cards, list rows. The
**active** navigation row is **pale blue** (`--color-nav-active`), not a bar or an underline. The
brand is a **blue rounded square** with a white mark and a small raised edge (`.sl-brand-tile`).
Pages greet the user: **"Welcome Riya"**, with a light slate "Welcome" and a bold blue name
(`.sl-welcome`).

The one primary action on a screen is a **big green-to-lime pill with a raised edge**
(`.sl-cta`): "Run Payroll", "Pay Taxes", "New Invoice". Its sub-areas or filters are **pale-blue
chips** (`.sl-chip`): "TDS", "PF", "PT", "Admin". Secondary actions are white pills (`.sl-btn`).
Section labels ("Admin") are small slate text above a group (`.sl-section-label`). Loading states
are the concept's **grey slabs** (`.sl-skeleton`).

Type: Inter; headings tight (-0.02em), weights 400 / 600 / 700. Text is deep navy (`--color-ink`),
never pure black. The corners are generous: tiles 18px, nav rows 14px, inputs 12px, and every
button and chip is a pill.

## Tokens and classes (already in `apps/web/src/assets/css/style.css`)

- Colours as Tailwind utilities: `bg-page`, `bg-card`, `bg-card-2`, `text-ink`, `text-ink-muted`,
  `text-ink-subtle`, `border-line`, `border-line-soft`, `bg-nav-active`, `text-accent` /
  `bg-accent` (brand blue), `bg-cta`, `bg-chip`, `text-chip-fg`, `bg-brand`. Status colours come
  from CSS vars: `text-[color:var(--color-success|warning|danger|info)]`.
- Building blocks: `.sl-tile`, `.sl-tile-hover`, `.sl-cta`, `.sl-cta-lg`, `.sl-btn`,
  `.sl-btn-blue`, `.sl-btn-danger`, `.sl-chip` (+ `-muted`, `-success`, `-warning`, `-danger`,
  `[aria-pressed=true]`), `.sl-nav-item` (`aria-current="page"` = active), `.sl-section-label`,
  `.sl-brand-tile`, `.sl-welcome`, `.sl-h1`, `.sl-h2`, `.sl-muted`, `.sl-input`, `.sl-skeleton`.
- Light is the default theme; dark is a deep-navy version of the same tokens (`data-theme="dark"`,
  storage key `shiftline-theme-v2`). **Never hard-code a colour** (`bg-white`, `text-gray-*`,
  `bg-blue-600`, `#hex` …): use a token so both themes work.

## Colour roles

Colour carries meaning, never decoration. Three roles, each with its own tokens:

- **Brand and action:** `--color-accent` (blue) for links, the active nav row and the pale-blue
  default icon square; the green `.sl-cta` for the one primary action.
- **Status:** `.sl-chip-success | -warning | -danger | -muted` (and `--color-success|warning|danger`)
  say how something is doing: good, watch, act, or not applicable. Always paired with a word or
  number, never colour alone.
- **Domain identity:** `.sl-tone-sales | -purchase | -cash | -production` tint an icon square with
  the chart series of the same domain (`--chart-series-1..4`), so a figure and its chart line share
  a hue. Identity only: a domain tone never signals good or bad.

On dashboards, OEE and every "produced against target" percentage share one scale
(`oeeTone` / `oeeChipClass` in `modules/dashboard/components/dashboardFormat.ts`): 85% and up is
success, 60–85% warning, below 60% danger. A stat tile's delta chip is green when the move is good
news; figures where a rise is bad (payables) pass `upIsGood={false}`.

## Shell and information architecture

- **Left sidebar** (desktop ≥1024px, 272px, collapsible to a 76px icon rail): the brand tile and
  "Shiftline" at the top, then a column of `.sl-nav-item` tiles grouped under section labels. It
  replaces the horizontal menu.
  - **Home:** Dashboard
  - **Operate:** Sales, Purchases, Inventory, Production, Exports
  - **Money:** Accounts, Banking & Payments, GST & Compliance, Reports
  - **People:** People, Payroll
  - **Admin:** Settings, Platform (super admins only)

  A row whose area is active expands in place into its sub-links, shown as smaller pill rows.

- **Top bar**: the page title or breadcrumb, a search field that opens the **⌘K / Ctrl+K command
  palette** (fuzzy search over every screen the user may open, plus quick actions), the theme
  toggle, notifications and the profile menu.
- **Mobile** (<1024px): a top bar with a menu button that opens the sidebar as a drawer, plus a
  bottom tab bar (Home, Search, the user's most-used area, Profile). Tap targets are at least 44px.
- **Area hubs**: every area has a hub page at `/hub/<area>`, reached by clicking the area row. It
  opens with the area name, 1–3 `.sl-cta` primary actions and `.sl-chip` shortcuts, followed by
  tile groups linking to every screen in the area. Each screen shows only if the user holds its
  permission.
- **The navigation config is the single source of truth**: one typed file lists each area, its
  groups and its screens (title, path, permission, icon, keywords). The sidebar, the hubs, the
  command palette and the breadcrumbs all read from it. A unit test asserts that every path in the
  old `sidebar.data.ts` appears in the new config, so no screen is lost.

## Page layout

One frame for every screen, so the title and the content edge never move between screens:

- **The shell owns the frame.** `BaseLayout` sets the gutters (16 px, 20 px from `sm`, 32 px from
  `lg`) and the top offset. A page root adds no padding and no top margin of its own.
- **The page root is `.sl-page`.** It is a column with 20 px (`gap-5`) between blocks. A
  `PageHeader` inside it drops its own bottom margin (`.sl-page > .sl-page-header`), so the
  header sits 20 px above the content like every other block. `PageBody` in
  `modules/production/ui` renders `.sl-page`.
- **Width tiers move only the right edge.** They are always left-aligned, never centred:
  - no tier: full width, for lists, dashboards, reports, boards and consoles;
  - `.sl-page-form` (1120 px): create and edit forms, single-column settings and detail
    summaries;
  - `.sl-page-doc` (1440 px): document editors and views (orders, quotations, invoices, POs,
    GRNs).

  Do not add a `max-w-[…]` of your own on a page root.

- **A toolbar belongs to its table.** Filters and search (`Toolbar`, `.sl-toolbar`) sit 16 px
  above the table they filter, on every page.
- **A table inside a tile is a framed region, not a second card.** `DataTable` drops its shadow
  and uses the inner radius there (`.sl-tile .sl-table-tile`). Do not wrap a `DataTable` in
  another `Tile` just to hold it.
- **Titles wrap on phones.** The `PageHeader` title wraps below `sm` and truncates from `sm` up.
  The in-page breadcrumb shows below `lg` only, because the top bar shows the full trail from
  `lg` up.
- **Touch targets.** On touch screens every chip, tab and pill button is at least 40 px tall
  (`@media (pointer: coarse)`); mouse layouts keep their density.
- **Inside a page.** Tiles use the `Tile` padding scale (`sm`/`md`/`lg`), and sections within a
  tile are 16 px apart. Tables scroll inside their tile, never the page.

## Page patterns

- **Page header:** title (`.sl-h1`), one line of context (`.sl-muted`), the primary `.sl-cta` on
  the right, and secondary `.sl-btn`s.
- **Titles:** sentence case (capitalise the first word and proper nouns; keep acronyms and brand
  terms such as GST, HSN/SAC, TDS, EOD, OEE, UOM, WhatsApp, Tally as written). A page's title is its
  nav label from `nav.config.ts`; a screen without a nav entry drops suffixes like "Management",
  "List", "Master" and "Entry". Create and edit pages read "New <thing>" / "Edit <thing>". Titles
  never carry greetings (the profile page is "My profile"; only the dashboard's "Welcome back" is a
  deliberate greeting). Breadcrumb labels and the page's `document.title` use the same wording.
- **List screen:** header, a row of filter chips and a search `.sl-input`, then the table inside a
  `.sl-tile`. Rows are 52px with a hairline between them, the header row is `bg-card-2` with small
  slate labels, row actions sit in a trailing "…" menu or icon pills, and statuses are chips. The
  empty state is a friendly line plus the primary CTA.
- **Form screen:** sections are separate `.sl-tile`s with an `.sl-h2` heading. Labels go above
  inputs, and two columns are used from 768px up. A sticky footer holds Cancel (`.sl-btn`) and Save
  (`.sl-cta`).
- **Detail screen:** a summary tile with status chips and key figures, then tabs as a chip row,
  then content tiles.
- **Dashboards:** a welcome header, a row of stat tiles (label, big number, delta chip), then
  charts inside tiles. Charts use the `--chart-series-*` palette.
- **Modals:** 24px radius, header, body and footer follow the form rules, over a soft blurred
  backdrop.

## Rules

- Keep every route, permission check, data call, validation and test id. Change how things look
  and where they sit, not what they do.
- Accessibility: visible focus, `aria-current` on the active nav item, labelled icon buttons,
  contrast ≥4.5:1 for text, respect `prefers-reduced-motion`.
- Use Tailwind with the tokens above. No Bootstrap, and no new UI library.
- Check every screen you touch at 1440px and 390px, in the light theme and a quick pass in dark.
