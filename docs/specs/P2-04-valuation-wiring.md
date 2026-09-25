# P2-04 — Valuation wiring and WIP

## Why

`valuationService.record` (P1-19) was built and nothing called it. A GRN receipt, a production
issue, a wastage entry, a stock adjustment and a job-work challan all move stock and none of them
valued it, so the weighted-average ledger was only ever as complete as what someone posted by
hand. A bill of entry's landed cost never reached the average it should have raised. Work in
progress — material issued to an order still on the floor — was not computed at all.

## Scope

- Every stock-moving write calls `valuationService.record` inside the same transaction as the
  document: a GRN receipt at the line's unit cost, a production issue (both the automatic
  start-of-production issue and the manual `issueMaterials` path) at the current weighted average,
  a wastage approval as a `SCRAP` issue at the average (and a `RECEIPT` for recovered material,
  when the wastage log names one), a stock adjustment's positive line at the entered cost (or the
  item's own rate) and its negative line at the average.
- `valuationService.reverseDocument(refDocType, refDocId, actor, db)` undoes every not-yet-reversed
  entry raised against a document — a reversal row each, never a delete or an edit — and is wired
  into the GRN cancel path. A reversal is dated the same as the entry it undoes, so it sorts
  correctly in a ledger ordered by business date rather than wall time.
- `valuationService.recordCostAdjustment` adds value without moving quantity: a bill of entry
  linked to a GRN apportions its landed cost across the GRN's lines (by value, reusing
  `apportion` from P1-17) and raises each line's average by its share, in the same transaction as
  the bill of entry.
- Job work: a `JOB_WORK` store category and one shared store (`JOB-WORK`) stand in for "goods out
  with a job worker" — a location, not a second inventory system. A `JOB_WORK_OUT` challan
  transfers stock from the source store to that location at the average it leaves at; `receive()`
  transfers returned quantity back at the job-work location's average, and consumed or scrapped
  quantity leaves the job-work location for good (nowhere else in this company's stock to land).
- `wipService` (`modules/costing/wip.service.ts`): WIP for one production order is the sum of
  `ISSUE` entries against it, less anything reversed, while the order's status is not `DISPATCHED`
  or `CANCELLED`; `wipService.total()` sums it across every order that has ever had material
  issued. `costingService.postClosingStock` now reports the WIP total alongside the closing-stock
  movement — informational, not posted, so raw-material stock and WIP are never folded into one
  number that hides which is which. (Raw-material closing stock already excludes issued material,
  since an issue is an outward entry at that store; WIP is the other half of where it went.)
- `valuationService.backfill(actor, db)`: values historical `RawMaterialTransaction` rows for an
  item/store that carries no valuation entry at all. Idempotent by construction — an item/store
  pair with any entry, backfilled or not, is left alone on a later run — and tags every row it
  writes `RM_TXN_BACKFILL` against the transaction it came from. `POST
/api/costing/valuation/backfill` runs it, behind the existing `costing.manage` permission.

## Out of scope

FIFO or standard costing, labour/overhead derivation, budgets (all P1-19 decisions, unchanged).
Job-work challan cancellation (P2-08). A GL posting for WIP — it is reported, not booked, until
the owner decides which ledger it belongs on.

## Acceptance

`apps/api/test/integration/valuation-wiring.spec.ts`: a GRN receipt values stock at the line cost
and raises the average, and cancelling it reverses the entry; a production issue leaves at the
average (not the last receipt's rate); a wastage approval issues at the average; a stock
adjustment values a positive line at the entered cost and a negative one at the average; a bill of
entry raises the average by its apportioned landed cost; a job-work challan out then in leaves the
store quantity unchanged and the job-work location at zero; backfill is idempotent; a foreign
tenant sees none of it. All existing costing, GRN-adjacent, production, wastage, stock-adjustment,
imports/fx and job-work specs still pass.
