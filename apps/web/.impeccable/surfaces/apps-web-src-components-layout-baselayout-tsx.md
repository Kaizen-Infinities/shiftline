---
version: 1
slug: "apps-web-src-components-layout-baselayout-tsx"
primary_target: "apps/web/src/components/layout/BaseLayout.tsx"
related_targets:
  ["apps/web/src/components/common/sidebar/Sidebar.tsx", "apps/web/src/assets/css/style.css"]
---

> **Superseded (2026-09-27).** The owner's UI v2 brief replaced this direction; the live look and
> its colour roles are in `docs/specs/UI-v2.md` (see `DESIGN.md`). Kept for history only.

## Direction contract

THESIS: The app shell reads as a bordered ledger-paper sheet, not a floating SaaS dashboard — hairline rules divide regions, one reserved ink-stamp accent marks state and the primary action, and nothing else competes for color. Refuses both the default sidebar-cards-shadows arrangement (including the current slate/teal system) and its predictable opposite, a dense Tally-style terminal.

OWN-WORLD: Warm paper-neutral surfaces (off-white in light, graphite-charcoal in dark), one reserved registry-ink accent (a deep vermillion/cinnabar) used only for the primary action, focus rings, and the universal stamp-shaped status marks — never as decoration. A plain workhorse grotesk for chrome and labels; tabular figures reserved for numerals wherever they occur. Hairline-rule dividers, small-to-no radius, bordered "sheet" panels rather than shadowed floating cards. This slice ships only the shared foundation and the Plain register (customers/settings-style quiet screens); the Ledger, Allocation, Document, and Monitoring registers are out of scope here.

STORY: A user opens the app and immediately reads it as a serious, document-grade business tool rather than a generic dashboard template, while every nav item, notification, and profile control stays exactly where dense-app convention already puts it — the wayfinding does not change, only its material does.

FIRST VIEWPORT: Top region is a thin bordered header strip (not a floating navbar): the Shiftline wordmark at left in the workhorse grotesk; primary horizontal nav items as plain text links, the active item marked by a hairline underline in the accent ink; at right, notification bell / theme switch / profile as plain icon-plus-label controls, with unread count shown as a small accent-ink stamp mark, never a colored dot alone. Below the `lg` breakpoint the primary nav collapses into a hairline-bordered drawer sliding from the left, opened by a plain hamburger control, with a visible focus ring, focus trap, and Escape-to-close. The content region is a bordered "sheet" (hairline border, no drop shadow) holding the page; a breadcrumb renders as small plain caps above a page title, the one place body type takes a size jump. Empty, loading, and error states render inside that same bordered sheet as plain, undecorated text — no illustration, no extra color — a deliberate refusal of the generic "empty-state illustration," consistent with an empty ledger page simply being an empty ruled page.

FORM: The pinned per-domain-register system from the shape session (three direction-scope rolls: Bank Passbook assigned/seed a65936b8; Railway Reservation Chart assigned on reroll 1; Graded Answer Sheet assigned on reroll 2, with Rubber Stamp/Ink-Pad plus File-Noting as that round's raised pick card), overridden by the user's explicit decision to use one shared foundation across purpose-built registers rather than a single whole-app metaphor. This build covers only the shared foundation and the Plain register; seed key a65936b8.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
