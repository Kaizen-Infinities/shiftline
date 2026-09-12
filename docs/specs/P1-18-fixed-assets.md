# P1-18 — Fixed assets and depreciation

## Why

A manufacturer's balance sheet is mostly machines. Until now they are a number someone types into
the chart of accounts once a year, which means the depreciation charge is a guess, the register
the auditor asks for does not exist, and the two depreciation regimes an Indian company has to
keep — Schedule II of the Companies Act for the accounts, and the block system of the Income-tax
Act for the return — are reconciled by hand or not at all.

## Two regimes, deliberately kept apart

They are not variations of one calculation and cannot share a number:

- **Companies Act, Schedule II** depreciates _each asset_ over its useful life, pro-rated by days
  from the date it was put to use, straight-line or written-down-value, down to a residual of
  (usually) 5%. This is what the books say and what gets posted.
- **Income-tax Act, section 32** depreciates a _block_ — every asset of the same class pooled —
  at a fixed rate on the block's written-down value, with a half-rate year for anything used less
  than 180 days, and no per-asset figure at all. This is a report; it is never posted.

Posting the tax number into the books, or reporting the book number on the return, is the
classic error this package exists to prevent.

## Scope

- **Asset classes**: useful life, method, residual percentage, the Schedule II head, the
  income-tax block and its rate, and the three ledgers each class posts to (asset, accumulated
  depreciation, depreciation expense).
- **The register**: assets with cost, the date put to use, quantity, serial, location and
  business place, capitalised by hand or from a GRN line or an expense.
- **Events**: additions to an existing asset, revaluation, transfer between business places, and
  disposal with the profit or loss worked out against written-down value.
- **A monthly depreciation run**: prepared, reviewed, then posted as one journal per class
  (Dr depreciation, Cr accumulated depreciation), on pg-boss on the first of the month, idempotent
  per period, and reversible through the normal cancellation path.
- **Reports**: the fixed-asset register (Schedule II movement — opening, additions, disposals,
  closing, and the same for depreciation), and the income-tax block summary for a financial year.

## Out of scope

Component accounting (Schedule II allows depreciating significant parts separately), impairment
testing under Ind AS 36, capital work-in-progress as a staging area, lease assets under Ind AS
116, and revaluation surplus through other comprehensive income — the revaluation here adjusts
cost and leaves the reserve to the accountant.

## Acceptance

- A straight-line asset put to use mid-month depreciates for the days it was in use, not the
  whole month.
- Depreciation stops once the asset is down to its residual value, and never runs below it.
- A written-down-value asset uses the Schedule II rate derived from its life and residual, not a
  typed rate.
- A disposal computes profit or loss against written-down value on the disposal date and posts
  it.
- A month can be run twice without depreciating twice.
- The income-tax block report halves the rate for an asset used less than 180 days and never
  matches the book charge by accident.
- Every query is tenant-scoped.
