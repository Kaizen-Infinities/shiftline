# Phase 2-T is finished — what was built, and what it is waiting on

Every package in `docs/handoff/2026-09-13-commission-phase-2-transition.md` is built, committed
and pushed to `chatgpt`, except the frontend remake (item 5), which the owner's task for this run
explicitly excluded ("ignoring UI remake"). This is the map.

## The packages, in the order they were built

| #   | Package                                                                  | Commit    |
| --- | ------------------------------------------------------------------------ | --------- |
| 1   | P2T-01 Scheduling: subscription invoicing, leave accrual, SMS send queue | `ebecc53` |
| 2   | P2T-02 Wire the Labour Code overtime rate into the payroll run           | `431724a` |
| 4   | P2T-04 Characterisation tests for the eight untested modules             | `697f2d7` |
| 3   | P2T-03 The inspector's registers                                         | `27ef65e` |

Package 4 was moved ahead of package 2 on purpose: package 2 changes `payroll.service.ts`'s
overtime calculation, and the brief's own rule for Phase 2 ("characterise the current behaviour
first, prove it green, and only then change the code") applies just as much to a change made
inside Phase 2-T itself. `payroll.spec.ts` was written first, characterising the old
otRatePerHour-based figure; P2T-02 then updated exactly the assertions the change was meant to
falsify and left every other characterised figure untouched.

## Where the work stands

- 79 API test files, 498 tests, all passing. Typecheck green across all four workspaces (api, api's
  test project, web, shared), lint clean of errors (510 pre-existing warnings, unchanged), prettier
  and `e2e:typecheck` clean.
- No schema migration in this phase: P2T-01 and P2T-02 changed only job/service code, P2T-04 added
  only tests, and P2T-03's registers derive entirely from data that already exists.
- The new statutory-registers screen was verified against the actual running stack (migrated and
  seeded dev database, both dev servers, a headless browser as `demo.owner`), not just typechecked.

## Real bugs found and characterised, not fixed

P2T-04's characterisation work surfaced several genuine, pre-existing defects. None were fixed —
that was explicitly out of scope for a characterisation package — but they are real and, in one
case, actively breaking a shipped feature today. Full detail in
`docs/handoff/2026-09-13-P2T-04-characterisation.md`; the short version:

1. **A permission-key naming mismatch strips the seeded Production role of almost everything it
   needs.** `ROLE_DEFS()`'s `PRODUCTION` entry in `provisioning.service.ts` spells five module keys
   differently from `PERMISSION_REGISTRY` (`production-orders` vs `production_orders`,
   `hourly-production` vs `hourly_productions`, and three more). `demo.production` gets 403 on
   production orders, weekly programs, daily plans, hourly production and goods dispatch. Four
   independent characterisation agents hit this from different modules and all converged on the
   same root cause. A one-line-per-key fix, but it flips 403→200 for that role across several
   modules and at least 27 existing test assertions reference it — worth its own reviewed change.
2. **`oeeService.recalculateAndSaveSnapshot()` throws on every call** (a compound-unique key
   name that doesn't match the schema's generated one), silently swallowed by a try/catch in
   `hourly-production.service.ts`. No `MachineOeeSnapshot` row has ever been written through the
   normal flow.
3. **`goods-dispatch`'s `storeReceive()` loses its tenant context calling
   `getNextAdjustmentNumber()` from inside its own `prisma.$transaction`**, because that helper
   reads through the plain `prisma` export instead of `tx` — exactly the mistake CLAUDE.md warns
   about by name. It always proposes sequence one, so only the first store-receipt per (tenant,
   year) ever succeeds; every one after it 409s. This is live today, not theoretical.
4. `production-order`'s generic `update()` silently wipes `draftRawMaterials` on a bare
   status-only PUT (a Zod `.optional().default()` firing on an absent key), and once an order is
   locked, the same defaults mean **the generic PUT can never move it again** — even to a
   transition the status machine explicitly allows.

Bugs #2 and #3 share a root cause: calling something that reads tenant-scoped data through the
plain `prisma` export from inside somebody else's interactive transaction. Worth checking whether
the same pattern exists anywhere else before Phase 2 adds more transactional code next to it.

## What Phase 2-T is waiting on from the owner

Nothing here blocks a line of code that has been written.

- A decision on priority for bugs #1–#3 above, independent of Phase 2's own schedule.
- The branch this phase should have used — the commission brief left it as
  `<BRANCH — the owner fills this in before commissioning>`; this run was told to use `chatgpt`
  directly, which is where everything above landed.
- Everything Phase 1 was already waiting on (GSP, Razorpay, MSG91 accounts, the named human
  approver) still applies unchanged.

## What was intentionally left out

- **The frontend remake** (Phase 2-T item 5, slices 2–7) — excluded from this run's instructions.
  Slice 1 (foundation) and part of slice 2 (shell) already exist on `chatgpt` from earlier work;
  they were not touched here.
- Fixing any of the four bugs above.
- Payout reconciliation for the payment gateway and SMS delivery receipts (both need a live
  account — repeats the Phase 1 note).

Phase 2 (the shop floor: telemetry, energy, maintenance, quality, traceability, change control,
CAPA) begins from `docs/handoff/2026-09-13-commission-phase-2.md`.
