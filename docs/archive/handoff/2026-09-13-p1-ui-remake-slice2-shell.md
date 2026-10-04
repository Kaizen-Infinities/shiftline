# P1-UI slice 2 (partial): shell in the new direction, "The Passbook Ledger"

## Why this note exists

The frontend remake's slice 2 (shell and public experience) was picked up after a `shape`
session replaced the visual direction entirely (the old teal/slate system, which was itself
only slice 1/foundation, not a finished migration — `docs/specs/P1-UI-remake.md`'s route
inventory previously claimed every group was done; it was not, and is corrected in this
commit). The new direction was chosen through three direction-scope concept-seed rolls
(seed key `a65936b8`, two re-rolls), each producing a whole-app metaphor that was strong for
part of the product and did not generalize to the rest (Bank Passbook, Railway Reservation
Chart, Graded Answer Sheet). Rather than force one metaphor over content it doesn't fit, the
owner pinned a **shared foundation plus five purpose-built registers** — Ledger, Allocation,
Document, Monitoring, Plain — described in full in `docs/specs/P1-UI-remake.md`'s "Visual
language" bullet and in the direction contract at
`apps/web/.impeccable/surfaces/apps-web-src-components-layout-baselayout-tsx.md`.

This note covers only the shell + Plain register, the scope agreed for this pass. The other
four registers are not yet built anywhere.

## Shipped

- **Tokens** (`apps/web/src/assets/css/style.css`): replaced the slate/teal palette with the
  new paper-neutral + registry-ink accent tokens, in both themes. `--color-primary` is now an
  alias of the one accent (no second brand color). Radius scale reduced (3/5/8px). Persistent
  chrome (nav, resting cards, tables) no longer carries a shadow; shadows are reserved for
  genuinely transient overlays (modals, dropdowns). Cleaned up several stray hardcoded colors
  left over from the origin app (an orange pagination hover, a green table-row hover, a dark
  green not-found shadow) that predated even the old teal system.
- **`TailwindPrimitives.tsx`**: `Card` and `Modal` primitives updated to the flat/hairline
  language.
- **`Button.tsx`** (the other shared button primitive, used app-wide): removed a
  gradient + second accent color (`from-accent to-emerald-500`) and a colored shadow — this
  was rendering on the login page and is a shared component, so the fix reaches every module
  that uses it, not just the shell.
- **`HorizontalNav.tsx`**: was hardcoded to `slate-900`/`teal-600` regardless of theme (a
  concrete instance of "renders with the new tokens but never got the domain-slice
  treatment" from `docs/handoff/2026-09-13-commission-phase-2-transition.md`). Rewritten to
  semantic tokens, changed the root element from `<div>` to `<nav aria-label="Primary">` for
  landmark correctness, removed the backdrop-blur, and changed the active-item treatment from
  a filled color pill to a hairline underline in the accent ink.
- **`Sidebar.tsx`** (mobile drawer), **`Navbar.tsx`** (mobile top bar): retoned to match,
  added `aria-label="Primary"` to the drawer's `<aside>`.
- **`CommonLoader.tsx`**: removed the colored bouncing-dots animation for a plain,
  undecorated loading state (the Plain register's own rule: no illustration, no extra color).
- **`LoginPage.tsx`**: full rewrite off the hardcoded blue-gradient/glass look (was not using
  the token system at all) into the new direction — ledger-ruled branding panel, bordered
  sheet form panel, accent-only button.
- **`ShortcutPanel.tsx`**: found and fixed a real, pre-existing bug while verifying this
  slice — the panel used `dark:` Tailwind variants that do not track this app's actual
  `[data-theme]` mechanism, so it silently ignored the light/dark toggle and always rendered
  dark. Rewritten onto the same semantic tokens as everything else, which fixes the bug as a
  side effect.
- **`BaseLayout.tsx`**: added a skip-to-main-content link and a `main` landmark target
  (`P1-UI-remake.md` slice 2 explicitly commits to "skip link and landmarks"; neither existed
  anywhere in the app before). Also found and fixed a second real bug while verifying at
  400px: the Shortcut Panel — a desktop power-user reference — rendered unconditionally and
  ate roughly half of a 390px viewport, squeezing the actual page content. It's now
  `hidden lg:flex`, matching how the rest of the shell already treats that breakpoint.
- Removed an unused, contradictory Google Fonts import (`Plus Jakarta Sans`) from
  `apps/web/index.html` that didn't match the actual font system (`Inter`, self-hosted) and
  wasn't referenced anywhere.

## Verification

Typecheck, lint (0 errors, pre-existing warning count unaffected by these files) and build
all green (`npm run typecheck -w @shiftline/web`, `npm run lint -w @shiftline/web`,
`npm run build -w @shiftline/web`). Verified on the actual running stack, not just
statically: started local Postgres, ran migrations and the demo seed, ran the API and web
dev servers, and screenshotted the real login screen and the authenticated shell (both
themes, desktop 1440px and mobile 390px, including the mobile nav drawer) via Playwright —
this is how the two bugs above (ShortcutPanel ignoring theme, ShortcutPanel breaking mobile
width) were actually found; neither would have shown up in typecheck/lint/build.

## Half-done / known gaps

- **This is not all of slice 2.** Explicitly out of this pass: invitation acceptance, reset
  password, onboarding wizard, unauthorised and not-found pages, and the floating calculator
  — all still on old/mixed styling. Slice 2 isn't done until these are too.
- **No `e2e/smoke.spec.ts` changes.** No screen's marker text or URL changed, so the existing
  smoke entries should still pass as-is, but `npm run e2e` was not run in this environment
  (no reason to expect a UI-only, non-structural change to break it, but it should still be
  run before merge per the project's own definition of done).
- **The other four registers (Ledger, Allocation, Document, Monitoring) do not exist yet.**
  The dashboard screenshot in this note still shows the old saturated multi-color KPI cards —
  that's slice 4/5 territory (Operations/Monitoring register), not touched here.
- **DESIGN.md was not generated.** Per the impeccable skill's own process, DESIGN.md is
  written from the finished, shipped system once more of it exists, not mid-slice.
- I did not attempt to retint the existing status-color system (success/warning/danger/info)
  toward the new "ink" character beyond adjusting their raw values in the token file; actual
  status _badges_ (`.status-pill`, `Badge` in `TailwindPrimitives.tsx`) still render as plain
  colored pills, not the stamp-shaped marks the direction calls for. That's real,
  cross-cutting work belonging to whichever slice actually builds out status displays, not a
  shell-only change.

## Next

Continue slice 2 on the remaining Foundation-and-public screens (reset password, invitation
acceptance, onboarding, unauthorised/not-found, calculator), then proceed to slice 3 in
order per `docs/specs/P1-UI-remake.md`, applying whichever register fits each domain.

## Blocked on you

Nothing blocks continuing — this was UI-only, no schema/permission/API change. Worth a
decision at some point, not urgently: whether the universal ink-stamp status vocabulary
(circular/rectangular/diagonal-strike marks) replaces the existing colored status-pill system
outright, or layers on top of it — that's a real design call for whichever slice tackles
status displays broadly.

## Changelog

Reworked the web app's shell (navigation, login, loading states) onto a new warm
paper-and-ink visual direction, and fixed two bugs found while verifying it: the shortcut
panel ignoring the light/dark theme, and it overlapping page content on narrow screens.
