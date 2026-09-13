# P2T-04 — Characterisation tests for the untested core

## Shipped

Eight new integration suites, one per module the Phase 2-T brief named as untested and about to be
touched by Phase 2:

- `apps/api/test/integration/oee.spec.ts`
- `apps/api/test/integration/machine.spec.ts`
- `apps/api/test/integration/production-order.spec.ts`
- `apps/api/test/integration/hourly-production.spec.ts`
- `apps/api/test/integration/inventory.spec.ts`
- `apps/api/test/integration/grn-invoice.spec.ts`
- `apps/api/test/integration/goods-dispatch.spec.ts`
- `apps/api/test/integration/payroll.spec.ts` (shipped with P2T-02, since it doubles as the proof
  of that package's Labour Code reconciliation)

Full suite: 78 files, 491 tests, all green — typecheck (api, web, shared, api's test project),
lint (0 errors, the same 510 pre-existing warnings as before this work), prettier and
`e2e:typecheck` all clean.

## Real bugs this surfaced (characterised, not fixed — see each spec's docstring)

This is the most important part of this note. None of these were fixed; each is exactly what the
"characterise, don't fix" brief asked for, but three of them are severe enough that they should not
wait for Phase 2 to trip over them by accident:

1. **A permission-key naming mismatch strips the Production role of almost everything it needs.**
   `ROLE_DEFS()`'s `PRODUCTION` entry in `apps/api/src/modules/platform/provisioning.service.ts`
   lists module keys `production-orders`, `weekly-programs`, `daily-plans`, `hourly-production`,
   `production-wastage` — every one of them spelled differently from the actual
   `PERMISSION_REGISTRY` module names (`production_orders`, `weekly_programs`,
   `daily-machine-planning`, `hourly_productions`, `production-wastages`, in
   `packages/shared/src/permissions.ts`). `keysFor()` does an exact string match, so **the seeded
   Production/Supervisor role is granted none of these keys today** — `demo.production` gets 403 on
   production orders, weekly programs, daily plans, hourly production and dispatch. Four
   independent characterisation agents hit this from different angles and all confirmed the same
   root cause. Fixing it is a one-line array correction per key, but it changes 403→200 for
   `demo.production` across several modules and at least 27 existing test assertions reference that
   role, so it needs its own reviewed change, not a drive-by fix here.
2. **`oeeService.recalculateAndSaveSnapshot()` throws on every call.** Its
   `machineOeeSnapshot.upsert` names the `where` key `machineId_productionDate_shiftId`; the
   schema's `@@unique([companyId, machineId, productionDate, shiftId])` generates
   `companyId_machineId_productionDate_shiftId`. Prisma rejects the mismatched key at runtime.
   `hourly-production.service.ts` already wraps the call in a try/catch that swallows the failure
   ("OEE calculation errors should not fail the main operation"), so **no `MachineOeeSnapshot` row
   has ever been written through the normal flow** — confirmed by `oee.spec.ts` inserting rows
   directly to test the read side at all.
3. **`getNextAdjustmentNumber()` loses its tenant context when called from inside another
   module's transaction, and duplicates the sequence number.** `goods-dispatch.service.ts`'s
   `storeReceive()` calls `StockAdjustmentService.getNextAdjustmentNumber()` from _inside_ its own
   `prisma.$transaction(async (tx) => ...)`, but that helper queries through the plain `prisma`
   export, not `tx`. Per CLAUDE.md's own documented rule ("inside a Prisma interactive transaction,
   read through the tx client: the outer client does not carry the tenant session settings
   there"), that query runs with no tenant context, sees no existing rows, and always proposes
   sequence one. The first store-receipt for a tenant in a year succeeds and claims that number for
   real; **every one after it 409s.** Proved directly in `goods-dispatch.spec.ts` on an isolated,
   single-use tenant (so the proof does not depend on what else the shared demo tenant has done
   that year). This is a live, load-bearing bug: `goods-dispatch` store-receipt is broken for any
   tenant that has ever raised more than one stock adjustment that year, by any means, and quality
   of coverage should treat it that way. Same root cause as #2 — a real, recurring pattern of
   calling something through the plain `prisma` export from inside someone else's transaction.
4. `apps/api/src/modules/production-order/production-order.service.ts`'s generic `update()` route
   has a real trap: its Zod schema is `.partial()`, but several fields carry `.optional().default()`,
   which Zod applies even when the key is absent from the body. A bare `PUT { status }` silently
   wipes `draftRawMaterials` to `[]`, and once an order reaches a "locked" status, the same defaults
   make the lock-check's allow-list always fail — **the generic PUT can never move a locked order
   again**, even to a transition `VALID_TRANSITIONS` explicitly permits. Both effects are pinned in
   `production-order.spec.ts`.
5. Smaller, still real: `start-production`'s idempotency guard checks for an existing
   `StockAdjustment` with `sourceDocId: null`, but the insert always sets a non-null
   `sourceDocId` — the guard can never match, so calling `start-production` twice with no daily
   plan looks like it would double-issue materials (not exercised in the suite, flagged for
   whoever touches that path next). `grn-invoice.routes.ts` has no `requirePermission` at all
   (only `requireFeature("purchase")`), so the statutory-auditor role — deliberately limited to
   `invoice.view` in the permission registry — can create and cancel GRNs over the API today.

## Half-done / known gaps

- The "no destination store anywhere" path in `goods-dispatch.storeReceive` (the `if (!storeId)
continue` branch) is real and was characterised in an earlier draft of the suite, but it cannot
  coexist with a store-backed successful receipt on the same dispatch (create()'s own guard
  requires a PO's destinationStoreId, when set, to equal the dispatch's), and — because of bug #3
  above — only one store-receipt can ever succeed per tenant per year. Documented in the spec's
  docstring rather than asserted, since proving it would need a third tenant this package chose not
  to spend on.
- `oee.spec.ts`'s characterisation of the dead snapshot-write path is necessarily indirect (rows
  inserted directly, not through the broken upsert) — see its own docstring.

## Next

P2T-03: the inspector's registers.

## Blocked on you

Nothing new for this package. Bugs #1–#3 above are worth a decision on priority independent of
Phase 2-T's own schedule — #3 in particular is silently breaking a shipped feature today.

## Changelog

No user-facing change; this package is test coverage only, ahead of the shop-floor work in the
next phase.
