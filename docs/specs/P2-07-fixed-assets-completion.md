# P2-07 — Fixed assets completion

## Why

`2026-09-12-P1-18-fixed-assets.md` shipped the register and the monthly charge but left four
gaps: no way in for a company migrating mid-life (assets already part-depreciated), a
capitalisation path with the columns but no button, a depreciation run that posts but cannot be
undone, and an asset-class screen that reads what its own API can edit.

## Scope

- `POST /api/assets/opening` (one row) and `POST /api/assets/opening/import` (CSV text or JSON
  rows: class code, asset code, name, business place, put-to-use date, cost, accumulated
  depreciation to date, method, remaining life in months (SLM) or a WDV rate percent, and the
  income-tax block as a cross-check against the class). Every row is validated before anything is
  written — a bad row anywhere rejects the whole sheet with its row number. Assets land with
  `openingBalance: true` and `openingItWdv` (the tax written-down value at import, since section
  32 depreciates a pool, not an asset). One journal per class — Dr the asset at cost, Cr the
  accumulated depreciation given, Cr `EQ-001` for the rest — posts once per class, never twice,
  using the same existing-voucher check the monthly run relies on. The income-tax block report
  uses `openingItWdv` instead of cost for these assets.
- `POST /api/assets/capitalise` (`sourceDocType: "GRN_INVOICE" | "EXPENSE"`, `sourceDocId`,
  `lineId?`, `classId`, …): moves the line's taxable amount off `PURCH-001` or `EXP-001` and onto
  the asset ledger with a journal, refusing a source document not yet posted and a line already
  capitalised (a partial unique index on `(company, source doc, source line)` makes the refusal
  hold under a race, not only in the read-then-write). Web: "Capitalise as asset" on the GRN
  invoice line and the expense detail.
- `POST /api/assets/depreciation-runs/:id/reverse`: cancels the run's voucher through
  `cancellationService` (a swapped-sides reversal, never a delete), restores every asset's
  accumulated depreciation, sets the run `REVERSED`, and refuses a run while a later period is
  still `POSTED` — reverse in order, the same way a later month's charge would have been measured
  from a written-down value this run is about to move.
- Asset-class edit screen using the existing `POST /api/assets/classes` upsert.

## Out of scope

Component accounting, impairment, CWIP, leases, revaluation reserve treatment (unchanged from
P1-18). Per-asset income-tax figures — the block stays a pool.

## Acceptance

`apps/api/test/integration/assets-completion.spec.ts`: opening import happy path with the block
report reflecting opening WDV; a row error rejects the whole import and writes nothing;
capitalise from a GRN line posts the journal and a second capitalisation is refused; reversing a
run restores accumulated depreciation and refuses out of order; permission refusal; cross-tenant.
`assets.spec.ts` (P1-18) still passes unchanged.
