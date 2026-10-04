# P2-20 — Costing follow-ups

## Shipped

- **Gap backfill** (`apps/api/src/modules/costing/valuation.service.ts` `backfill`): rewritten
  per item/store pair. It now finds the pair's earliest existing valuation entry (if any) and
  fills every `RawMaterialTransaction` dated _before_ it, in date order, against a running balance
  it carries locally — `record`'s own opening balance is always the ledger's _latest_ entry, which
  would have been wrong for a row being inserted behind the ledger's current tip, so the average
  math (`computeMovement`, factored out of `record` so both share it) is applied against that
  local running balance instead. Nothing on or after the cut-off is ever touched. A pair with no
  existing entry at all still gets its whole history filled, exactly as before this package. Each
  inward row is valued at, in order: the transaction's own rate (none of today's raw-material
  transactions carry one, so this never fires yet, but the rule is in place), else the item
  master's current rate, else — when the master carries none — the rate of the pair's first known
  valuation entry, so a real known rate is preferred over a guessed zero. The result now reports,
  per pair, how many rows it filled and how many it skipped and why (`on or after the first
existing entry`, `already backfilled`, `zero quantity`) — `pairs` on the response, alongside the
  unchanged `scanned`/`created`/`skipped` totals. Still idempotent: a second run creates nothing.
- **Wastage recovery rate** (`apps/api/src/modules/production-wastage/production-wastage.service.ts`
  `approve`): when a wastage log names a recovered material and carries no `estimatedValue`, it is
  now received at that material's current weighted average (`valuationService.balanceAt`) instead
  of zero — or at its master rate when it has never been valued at all. The entry's narration
  names which of the three rate sources (the log's own estimate, the running average, or the
  master rate) was used, so "why is this rate what it is" never needs a trip back to the wastage
  log.
- **Stock tab period picker** (`apps/web/src/modules/accounts/pages/CostingPage.tsx`): a new
  `stockPeriodKey` month selector, separate from the cost-centres tab's `periodKey`, now drives the
  closing-stock figure's `asOn` date, the closing-stock-status card, and the Post button (and its
  label). No backend change — the existing `asOn` and `:periodKey` query/path parameters already
  accepted whatever month the caller asked for; only the screen was pinned to the wrong selector.
- Spec `docs/specs/P2-20-costing-followups.md`; tests
  `apps/api/test/integration/costing-followups.spec.ts` (4 tests: gap backfill fills the older rows
  in date order and leaves the wired entry and anything after it alone, and is idempotent on a
  second run; the master-rate-missing fallback to the first known valuation rate; wastage recovery
  uses the running average when one exists and the master rate when it does not, each saying so in
  its narration; a foreign tenant's backfill sees none of another tenant's history). All of
  `valuation-wiring.spec.ts`, `wip-posting.spec.ts` and the costing/leak/route suites still pass.

## Decisions worth knowing

- **The backfilled rows do not change the ledger's live balance.** A wired entry (say, a GRN
  receipt posted before this package ran) was created with `record`'s opening balance of whatever
  the ledger's latest entry was _at that time_ — nothing, if it was the first movement ever
  recorded for that item/store. Backfilling history _before_ that entry fills in the ledger's
  record of what actually happened, but it does not retroactively rewrite the wired entry's own
  `balanceQuantity`/`avgRate`, which were fixed the moment it was created. This matches the P2-04
  handoff's framing exactly: the gap was that history _before the first wired movement was never
  valued_, not that the wired movement's own math was wrong. Reconciling the two — folding the
  newly-known earlier quantity into what is currently "the latest balance" — would mean rewriting
  a real entry, which nothing in this ledger ever does (P2-04's own rule, carried forward).
- **No `FinishedGoodsTransaction` backfill.** No code path values a `PRODUCT` item today —
  `finished-goods-transaction.service.ts` never calls `valuationService.record` at all, unlike its
  raw-material counterpart. That is new wiring, not a follow-up to an existing gap, and is out of
  this package's scope the same way the raw-material/finished-goods ledger split is (P2-04/P2-14):
  it would mean deciding where finished-goods valuation should be wired in the first place.
- **"The item master rate at the time" is still just the item master's current rate.** There is no
  price-history table to read a rate as of a past date from — the same limitation the original
  backfill had. The fallback chain (own rate, then master rate, then first known valuation rate)
  is the most this ledger can do without one.

## Half-done / known gaps

- Same WIP-has-no-GL-posting-before-P2-14 note does not apply here (P2-14 shipped that); nothing
  new left half-done by this package's own scope.
- The backfill's `pairs` detail in the response is not surfaced anywhere in the web UI — the
  existing `costingService.backfillValuation()` call was never wired to a button before this
  package either (checked; it still isn't), so there was no screen to extend.

## Next

Nothing named by the owner follows directly. If finished-goods valuation is ever wired (a bigger
package — deciding what rate a dispatch or a sales return leaves at, same shape of question P2-04
answered for raw material), its own backfill would read `FinishedGoodsTransaction` the same way
this one reads `RawMaterialTransaction`; the per-pair cut-off logic here generalises directly.

## Blocked on the owner

Nothing.

## Changelog sentence

Backfilling stock valuation now fills the history that existed before an item's first real
movement instead of skipping it, wastage that recovers material without an estimated value is now
received at a real rate instead of zero, and the costing screen's stock tab has its own month
picker instead of borrowing the cost-centres tab's.
