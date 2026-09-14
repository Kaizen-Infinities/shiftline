# P2-14 — Post work in progress to the books

## Why

P2-04 gave WIP a real figure — material issued to an open production order, from the valuation
ledger — and reported it alongside the closing-stock posting without ever booking it
(`docs/handoff/2026-09-14-P2-04-valuation-wiring.md`, "WIP is reported, not posted"). Until the
owner names a ledger, the product ships with a sensible default and a setting to change it.

## Scope

- A `Work in Progress` current-asset ledger (code `WIP`) added to `DEFAULT_SEED_LEDGERS`
  (`accounts.service.ts`) and so to `provisionTenant()` (which already calls
  `ensureSystemLedgersExist()`); the same idempotent ensure step covers an existing tenant on its
  first use, with no migration needed to backfill it.
- `CostingSetting` (per-tenant, one row): `wipLedgerCode`, default `WIP`. `GET/PUT
/api/costing/settings` behind `costing.view`/`costing.manage`. A tenant that never visits the
  setting reads the default without a row ever existing.
- `costingService.postClosingStock` now also posts WIP, in the same voucher as the stock
  movement: the change in `wipService.total()` since whatever the WIP ledger already books (its
  balance as of the day before the period, from POSTED vouchers) moves Dr WIP / Cr Closing Stock
  when WIP rose, or the reverse when it fell. Two identities hold after every posting: the WIP
  ledger's balance equals `wipService.total()` at the period date, and the closing-stock ledger's
  balance equals the valuation total minus WIP. Because the movement is a delta from what is
  already booked, re-posting the same period is a no-op (the existing "already posted" guard,
  now checked against either leg) and the next period only ever adjusts for what changed since.
  Cancelling the closing-stock voucher (the existing reversal path) reverses the WIP leg with it,
  since it is a line in the same voucher.
- An unknown `wipLedgerCode` refuses the setting with `UNKNOWN_LEDGER`, checked against the
  ledger table so a typo cannot silently post nowhere.
- Reports: the balance sheet splits the blended "Closing Stock" ledger into raw material and
  finished goods (computed from the valuation ledger's own item types, in the same ratio, adding
  back to exactly what the ledger books) so the inventory line reads as three figures — raw
  material, WIP, finished goods — not one; WIP already has its own ledger and needs no splitting.
  `GET /api/costing/valuation/:periodKey/closing-stock-status` (read-only) tells the costing
  screen whether a period's WIP is posted, and whether it still matches the live figure.
- Web: the costing screen's WIP card shows the posted/not-posted state for the selected period,
  and a ledger picker (behind `costing.manage`) to change `wipLedgerCode`.

## Out of scope

Labour and overhead in WIP — `wipService` is material only, unchanged. FIFO and standard costing.
Splitting the raw-material/finished-goods ledgers for real in the general ledger (the balance
sheet split here is computed for display, not booked as separate ledgers) — a bigger change than
this package's brief covers.

## Acceptance

`apps/api/test/integration/wip-posting.spec.ts`: a new tenant from `provisionTenant()` has the
WIP ledger; posting closing stock with an open production order moves the issued material into
WIP, and the WIP ledger / closing-stock ledger identities hold; re-posting the same period is a
no-op; completing the order and posting the next period moves the value back out and the WIP
ledger returns to zero; a changed `wipLedgerCode` is honoured (a second order posts against the
new ledger, the original is untouched) and an unknown code is refused; posting into a closed
period is refused; a user without the costing permission is refused; a foreign tenant sees
neither the ledger nor the setting. Existing `costing.spec.ts`, `valuation-wiring.spec.ts`,
`accounts.spec.ts`, `ledger-groups.spec.ts`, `year-end.spec.ts` and provisioning still pass.
