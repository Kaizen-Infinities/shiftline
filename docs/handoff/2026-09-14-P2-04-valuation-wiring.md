# P2-04 — Valuation wiring and WIP

## Shipped

- **Every stock movement now calls `valuationService.record`** in the same transaction as the
  document write: a GRN receipt (at the line's unit cost), the automatic and the manual
  production-material-issue paths (at the running average), a wastage approval (`SCRAP` for the
  material wasted, `RECEIPT` for anything recovered), and a stock adjustment's approval (its
  positive line at the entered cost or the item's own rate, its negative line at the average — the
  same rule as any other issue).
- **`valuationService.reverseDocument`**: undoes every not-yet-reversed entry a document raised —
  a reversal row each, dated the same as what it undoes so it sorts correctly in a ledger ordered
  by business date rather than wall time. Wired into the GRN cancel path. `StockValuationEntry`
  gained a nullable `reversedEntryId` column so a reversal names what it undoes and a second
  cancellation attempt (should one ever reach this code twice) cannot double-reverse it.
- **Landed cost**: a bill of entry linked to a GRN apportions its landed cost across the GRN's
  lines by value (reusing `apportion` from P1-17) and raises each line's average through a new
  `valuationService.recordCostAdjustment` — a value-only movement, quantity zero, so it reads as
  "this stock got more expensive" rather than a second receipt that never arrived.
- **Job work moves stock**: a new `JOB_WORK` `StoreCategory` and one shared system store
  (`JOB-WORK`, created lazily) stand in for "goods out with a job worker" — reusing the existing
  store model rather than inventing a second one. A `JOB_WORK_OUT` challan transfers the sent
  quantity from the source store to that location at the average it leaves at; `receive()`
  transfers the returned share back at the job-work location's own average, and whatever was
  consumed by the process or scrapped there leaves the job-work location for good.
- **WIP** (`apps/api/src/modules/costing/wip.service.ts`): material issued to a production order
  is WIP — the sum of `ISSUE` entries against it, net of anything reversed — for as long as the
  order's status is not `DISPATCHED` or `CANCELLED`. `wipService.total()` sums it across every
  order that has ever had material issued. `costingService.postClosingStock` now reports the WIP
  total alongside the period's stock movement (informational; not posted — see Half-done).
- **Backfill**: `valuationService.backfill` values historical `RawMaterialTransaction` rows for
  any item/store pair that carries no valuation entry at all, tagging what it writes
  `RM_TXN_BACKFILL`; a pair that already has any entry (backfilled or wired) is left alone on a
  later run, so it is idempotent. `POST /api/costing/valuation/backfill`, behind `costing.manage`.
- **Fixed in passing**: `StockAdjustmentService.createStockAdjustment` /
  `updateStockAdjustment` dropped the `unitCost` a caller sent on a line — the column existed,
  nothing wrote it. Valuing a positive adjustment "at the entered cost" needed it, so both now
  persist it.
- Migration `20260914040000_valuation_wiring`: `StoreCategory` gains `JOB_WORK`,
  `stock_valuation_entries` gains `reversed_entry_id`. No new tables, so no new RLS or audit
  trigger blocks — `StockValuationEntry` was already audited and already carries `companyId`.
- Spec `docs/specs/P2-04-valuation-wiring.md`; tests
  `apps/api/test/integration/valuation-wiring.spec.ts` (7 tests: GRN receipt + cancel reversal,
  production issue at average + wastage at average + WIP open/closed, stock adjustment
  entered-cost/average, bill-of-entry landed cost, job-work out/in round trip, backfill
  idempotency, cross-tenant isolation).

## Decisions worth knowing

- **A reversal is dated like what it undoes, not "today".** The ledger orders by business date
  (`movedOn`), not by when the row was written. A reversal stamped with the real clock date would
  sort ahead of — or behind — the movement it is meant to cancel whenever the document's own date
  is not today, silently leaving the wrong entry as "last". This cost real debugging time while
  building this package (the test fixtures use fictional dates); it would just as easily bite a
  GRN cancelled a week after it was dated.
- **Job work gets one shared location, not one per job worker.** The brief allowed either; a
  single `JOB-WORK` store keeps the wiring simple and still answers "how much is out with job
  workers in total" directly off the valuation ledger. A per-worker breakdown would need a real
  register (P2-08 territory) rather than a valuation `storeId`.
- **Consumed and scrapped material at a job worker leaves the ledger for good.** There is nowhere
  in this company's own stock for it to land — it was never a supply, so it does not become one
  here either. It only ever shows up as the difference between what a `JOB_WORK_OUT` challan sent
  and what its returns account for.
- **WIP is reported, not posted.** Folding it into the closing-stock voucher would need a WIP
  ledger account, and which one is a books decision the owner has not made (see Blocked). Showing
  it alongside the movement, unposted, was the honest stopping point.

## Half-done / known gaps

- **WIP has no GL posting.** `postClosingStock` names the WIP total in its response; it does not
  debit a WIP ledger. Until the owner names one, WIP lives only in the valuation ledger and the
  `/api/costing/wip` reports.
- **Wastage's cost recovery is approximate.** When a wastage log names a `targetWastageProductId`
  (recyclable material recovered), it is received in at `estimatedValue / quantity` if the log
  carries an estimate, else zero — there is no other rate on the wastage record to draw on.
- **Backfill is conservative by item/store pair, not by individual transaction.** An item/store
  that already carries even one valuation entry (from this wiring, from a manual movement, from an
  earlier partial backfill) is skipped entirely rather than partially backfilled, to avoid ever
  guessing a rate into a ledger a real document has already started. A tenant that wants its full
  pre-wiring history valued for an item that has _also_ had one wired movement since needs that
  handled by hand, or a follow-up script that fills the gap between two known points.
- **Job-work challan cancellation is not built here** — the brief for P2-08 (job work completion)
  owns it, and this package's job-work wiring is create/receive only, deliberately.
- No new web screen. The existing stock valuation screen
  (`apps/web/src/modules/accounts/pages/CostingPage.tsx`, `/accounts/costing`) now shows a Work in
  progress card on its Closing stock tab, backed by a new `costingService.wip()` call — the
  existing route and sidebar entry cover it, so nothing needed adding to `e2e/smoke.spec.ts`.

## Next

P2-08: job work completion (return-in-one-step, challan cancellation, ITC-04). Its cancellation
path should call `valuationService.reverseDocument("JOB_WORK_CHALLAN", challanId, ...)` to undo
the transfer this package wires in — the entries are already tagged and ready for it.

## Blocked on the owner

Which ledger WIP posts to, and whether it should post at all versus stay a report — the same kind
of allocation-rule decision P1-19 left open for overhead.

## Changelog sentence

A GRN receipt, a production issue, a wastage entry, a stock adjustment and a job-work challan now
value stock automatically as they happen, cancelling one reverses the valuation it raised, a bill
of entry's landed cost raises the average it belongs to, and work in progress is now a real figure
per production order and in total.
