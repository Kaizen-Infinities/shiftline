# P2-20 — Costing follow-ups

## Why

`docs/handoff/2026-09-14-P2-04-valuation-wiring.md` names two conservative stopping points: the
gap backfill skips an item/store pair entirely once it carries even one valuation entry, so any
history _before_ that first wired movement never gets valued; and wastage's recovered material is
received at `estimatedValue / quantity`, or zero when the log carries no estimate. And
`docs/handoff/2026-09-14-P2-14-wip-posting.md` names a small UI gap: the stock tab has no period
picker of its own, so its Post button and WIP card are stuck on whatever period the cost-centres
tab happens to be showing.

## Scope

- `valuationService.backfill`: per item/store pair, finds the pair's earliest existing valuation
  entry (if any) and fills every historical `RawMaterialTransaction` dated _before_ it, in date
  order, against a running balance carried locally rather than `record`'s own "latest balance"
  opening (which would be wrong for a row being inserted behind the ledger's current tip). A
  transaction on or after the cut-off is never touched. A pair with no existing entry at all still
  gets its whole history filled, as before. Each inward row is valued at the transaction's own
  rate where one exists (none do today, but the rule is in place for any that later carry one),
  else the item master's current rate, else — when the master carries none — the rate of the
  pair's first known valuation entry. The result reports, per pair, how many rows it filled and
  how many it skipped and why (on/after the cut-off, already backfilled, or zero quantity).
  Idempotent: a second run creates nothing.
- Wastage recovery (`production-wastage.service.ts` `approve`): when a log names a recovered
  material and carries no `estimatedValue`, it is received at that material's current weighted
  average (`valuationService.balanceAt`) rather than zero — or its master rate when it has never
  been valued at all. The entry's narration names which of the three rate sources was used.
- `CostingPage.tsx`: the stock tab gets its own month picker (`stockPeriodKey`), separate from the
  cost-centres tab's, driving the closing-stock figure's `asOn` date, the closing-stock-status
  card, the Post button and its label. No backend change — the existing `asOn`/`periodKey` query
  parameters already accept it.

## Out of scope

The raw-material / finished-goods ledger split (deliberately, per P2-04/P2-14 — it re-plumbs every
stock write). Backfilling `FinishedGoodsTransaction`: no code path values a `PRODUCT` item today,
so there is no "gap" to fill there yet — that is new wiring, not a follow-up. A price-history table
for "the item master rate at the time"; the master's current rate is the best available without
one, same limitation as the original backfill.

## Acceptance

`apps/api/test/integration/costing-followups.spec.ts`: a raw material with one wired (`record`ed)
valuation entry and older, never-valued `RawMaterialTransaction` rows gets the older ones filled
in date order at the item's master rate, average-consistent with each other, and the wired entry
and anything on/after its date is untouched; a second `backfill()` run creates nothing further; a
wastage approval whose log has no `estimatedValue` receives the recovered material at its running
average and says so in the narration, and at the master rate (saying so) when the material has
never been valued; a foreign tenant's backfill and ledger stay empty. Web typecheck and build
green.
