# P1-18 — Fixed assets and depreciation

## Shipped

- `AssetClass`, seeded with the six a manufacturer starts from (plant, building, furniture,
  computers, vehicles, electricals). Each class carries **both** regimes: the Schedule II life,
  method and residual for the accounts, and the income-tax block and rate for the return.
- `FixedAsset`: the register — cost, the day it was put to use, class, business place, quantity,
  serial, location, and where it was capitalised from. The life and residual are copied off the
  class at capitalisation and then fixed, so editing a class two years later cannot silently
  re-depreciate everything bought under the old one.
- `depreciation.calc.ts`, kept apart from the database because it is the part that has to be
  right: Schedule II straight-line and written-down-value, pro-rated **by days** from the date of
  use, never below residual, only what is left in the final month; and the income-tax block
  calculation with the half-rate year and proceeds taken off the pool.
- A monthly run: `DepreciationRun` is unique on the period, so preparing twice returns the first
  run rather than charging twice. Posting writes one journal with a debit and a credit per class
  (Dr depreciation, Cr accumulated depreciation) and moves the accumulated depreciation on every
  asset, in one transaction. A pg-boss job prepares last month on the 1st (03:00 IST); posting
  stays a person's act.
- Events: addition, revaluation, transfer between business places, impairment — and disposal,
  which measures the result against written-down value on the day and posts cost and accumulated
  depreciation off separately.
- Reports: the Schedule II register for a financial year (opening, additions, disposals, closing,
  and the same for depreciation, summed from what was _posted_ so it ties to the ledgers), and
  the income-tax block summary.
- Four seed ledgers (`FA-001`, `FA-ACC-001`, `DEP-001`, `ASSET-PL-001`), permissions
  `assets.{view,create,manage,depreciate,dispose}` granted to Owner and Accounts, migration
  `20260912180000_fixed_assets` with RLS and audit triggers, web `/accounts/fixed-assets` with
  five tabs, in `e2e/smoke.spec.ts`. `depreciation.spec.ts` (13 unit tests) and `assets.spec.ts`
  (8 integration tests).

## Decisions worth knowing

- **The two regimes are kept apart on purpose.** Schedule II depreciates an asset over its life;
  section 32 depreciates a pool at a fixed rate with a half-rate year and proceeds netted off.
  They are different numbers about different things, and one of the unit tests asserts that they
  _do not_ match — because the failure mode this package exists to prevent is someone making them
  agree and filing the wrong one.
- **Pro-rating is by days, not by months.** A machine bought on the 20th gets eleven days of
  June. Charging a whole month would overstate depreciation on every purchase the company makes,
  and Schedule II requires the pro-rata.
- **The WDV rate is derived, not typed.** The Act gives a life and a residual; the rate that
  takes cost to residual over that life is `1 - (residual/cost)^(1/life)`. A typed rate would
  quietly disagree with the life on the same row, and the auditor reconciles to the life.
- **A disposal credits cost and debits accumulated depreciation separately.** Crediting one net
  written-down figure is the shortcut that leaves both balances permanently wrong, and the
  integration test asserts each side.
- **The year-end register sums the posted charge rows** rather than recomputing. A report that
  recomputes will one day disagree with the ledger it is supposed to explain.

## Half-done / known gaps

- **No opening balances.** A company migrating in mid-life has assets already part-depreciated;
  today the only way in is to create the asset and set `accumulatedDepreciation` directly. An
  import that takes cost, date and depreciation-to-date is the obvious next piece, and the
  income-tax block opening value is a plain sum of cost until it exists — the report says so
  rather than pretending.
- Capitalisation from a GRN line or an expense is supported by the columns (`sourceDocType`,
  `sourceDocId`) but there is no button on those screens yet; assets are typed in.
- A depreciation run can be posted but not cancelled from the API. The voucher can be cancelled
  through the normal path, which leaves the run's `status` saying POSTED — reversing a month
  needs a proper path.
- No component accounting (Schedule II allows depreciating significant parts separately), no
  impairment testing under Ind AS 36, no capital work-in-progress staging, no lease assets.
- Revaluation adjusts cost and adds 5% of the movement to residual; the revaluation reserve and
  its treatment through other comprehensive income are left to the accountant.
- The asset class edit exists in the API but the screen shows classes read-only.

## Next

P1-17: multi-currency.

## Blocked on you

- Whether the existing machines' costs and depreciation-to-date can be exported from wherever
  they live now. Until they are in, the register is only as old as this package.

## Changelog sentence

Machines, buildings and vehicles now have a proper register: depreciation is worked out per asset
by days under Schedule II and posted monthly, disposals compute the profit or loss against
written-down value, and the income-tax block depreciation for the return sits beside it as its
own report.
