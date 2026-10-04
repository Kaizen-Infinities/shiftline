# P1-UI slice 2 (complete): the rest of Foundation and public

## Why this note exists

`docs/handoff/2026-09-13-p1-ui-remake-slice2-shell.md` shipped the shell (nav, login, loading
states) in the new "Passbook Ledger" direction but explicitly left five screens and the floating
calculator on old/mixed styling: reset password, invitation acceptance, the onboarding wizard,
unauthorised/not-found, and the calculator. This pass finishes them, which closes out the
Foundation and public group of `docs/specs/P1-UI-remake.md`'s route inventory — slice 2 is now
done in full, and slice 3 (masters and settings) is next.

No schema, endpoint, permission or route change; this is the same visual-layer-only migration as
the rest of the remake, working from the direction contract at
`apps/web/.impeccable/surfaces/apps-web-src-components-layout-baselayout-tsx.md` and the tokens in
`apps/web/src/assets/css/style.css`.

## Shipped

- **`ResetPassword.tsx`**: was a dead stub on the old slate/gradient look (no token, no field
  wired to state, "Reset & sign in" just navigated to `/login`). Reskinned onto the bordered-sheet
  card used by `LoginPage.tsx` (`TextInput`, `Button`, `bg-card`/`border-line`/`text-accent`); left
  the actual wiring exactly as it was — still a stub, since wiring a real reset flow is a backend
  change and out of this slice's scope.
- **`AcceptInvitationPage.tsx`**: fully wired flow (token preview, accept, sign-in) kept intact;
  only the hardcoded `blue-600`/`red-500`/`shadow-xl`/`rounded-2xl` classes moved onto tokens,
  matching the error-box and button treatment already established in `LoginPage.tsx`.
- **`NotFoundPage.tsx`, `UnauthorizedPage.tsx`**: replaced the generic colored-circle-icon pattern
  (amber/red filled circles on `bg-gray-50`) with a bordered accent-ink stamp square on a
  bordered sheet — the Plain register's "no illustration, no extra color" rule, applied the same
  way the shell's empty/error states already do.
- **Onboarding wizard, all six steps** (`OnboardingWizard.tsx` and `steps/*.tsx`): the shared
  primitives in `steps/fields.tsx` (`PrimaryButton`, `SecondaryButton`, `ErrorBox`) and
  `steps/utils.ts` (`inputClass`) moved onto tokens once, which carried through to every step that
  consumes them without further changes. Remaining per-file hardcoded colors — the GST
  registration-type radio cards, GSTIN validity border, the DEFAULT bank badge, the "Edit" links
  and "Remove" buttons, invitation status text — moved onto `accent`/`success`/`danger`/`warning`
  via the arbitrary-value convention `LoginPage.tsx` already established
  (`text-[color:var(--color-success)]`, etc.). `OnboardingWizard.tsx`'s own shell (header,
  vertical stepper, main panel) moved off the filled-blue-pill stepper and `shadow-xl` card onto a
  hairline-bordered stepper (bordered-square step markers, `border-accent` for the active step)
  and a flat `bg-card`/`border-line` main panel, matching `BaseLayout`'s chrome. Radius
  normalized from `rounded-xl`/`rounded-2xl` to the app's 3/5/8px scale throughout.
- **`Calculator.tsx`** (630 lines): full visual rewrite. This was the last screen still entirely
  hardcoded to a dark slate/teal/amber/emerald glassmorphism panel regardless of theme — the same
  bug class as the `ShortcutPanel` fix in the prior note, just never caught because the calculator
  is opened on demand (Alt+C) rather than always visible. Now a bordered sheet matching the rest
  of the shell: flat digit/function keys, the equals button as the one accent-filled primary
  action, GST presets and the active-operator state as bordered accent-outline rather than filled
  saturated colors, tabular-nums on the display and history figures. Every handler, calculation,
  keyboard shortcut and the drag behavior are untouched — only `className`s changed.

## Verification

`npm run typecheck -w @shiftline/web`, `npm run lint -w @shiftline/web` (0 errors; the pre-existing
509 warnings are all in files this pass didn't touch), `npm run build -w @shiftline/web`, and
`npm run e2e:typecheck` are all green. Verified on the real running stack, not just statically:
local Postgres 16, migrations, the demo seed, the API and web dev servers. Screenshotted every
screen in this pass in both themes: reset password and not-found at 1440px and 390px, unauthorised
and accept-invitation (invalid-token state) at 1440px, the onboarding wizard's Company step at
1440px and 390px, and the calculator open over the dashboard at 1440px. To see the onboarding
wizard itself (the seeded demo tenant is already onboarded) the demo company's `isOnboarded` flag
was flipped to `false` directly in the dev database for the verification pass and flipped back to
`true` immediately after — no seed, migration or application code changed to do this.

## Half-done / known gaps

- Only the **Company** step of the onboarding wizard was reachable to screenshot: once
  `isOnboarded` is unset the wizard's `step` pointer restarts at `company` regardless of how much
  data already exists, so the GST/Financial-year/Bank/Users/Review steps weren't visually
  re-verified this pass (they only changed via the shared-primitive edits in `fields.tsx`, which
  the Company-step screenshot does exercise — same `Field`, `PrimaryButton`, `ErrorBox`,
  `inputClass`). Worth a follow-up pass that actually submits each step to reach Review and see
  the summary `Section` cards and the terms-of-service block rendered.
- `ResetPassword.tsx` is still functionally a stub (no token param, no API call, the button just
  navigates to `/login`) — restyled faithfully in place, not wired up, since a real reset flow is
  a backend change outside this slice's scope. Flagging again in case it reads as an oversight.
- Status badges (`.status-pill`, `Badge` in `TailwindPrimitives.tsx`) and the other four registers
  (Ledger, Allocation, Document, Monitoring) remain out of scope, as noted in the prior slice-2
  note — untouched here too.

## Next

Slice 2 (Foundation and public) is now fully done — `docs/specs/P1-UI-remake.md`'s route
inventory checkbox is updated. Slice 3 is masters and settings: standard list toolbar, responsive
filters, forms, destructive confirmations and detail summaries, per the migration-slices section
of that spec.

## Blocked on you

Nothing blocks continuing — UI-only, no schema/permission/API change.

## Changelog

Finished restyling the sign-up and setup screens (password reset, invitation acceptance, the
onboarding wizard, the 404/403 error pages) and the floating calculator onto the new warm
paper-and-ink look, including a theme bug in the calculator that made it render dark regardless of
your light/dark setting.
