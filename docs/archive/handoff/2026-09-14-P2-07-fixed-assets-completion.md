# P2-07 — Fixed assets completion

## Shipped

- **Opening balances.** `POST /api/assets/opening` (one row) and `POST /api/assets/opening/import`
  (CSV text or JSON `rows`: class code, asset code, name, business place, put-to-use date, cost,
  accumulated depreciation to date, method, remaining life in months for SLM or a WDV rate percent
  for WDV, and the income-tax block as a cross-check against the class). Every row is validated —
  class exists and is active, code is free (on the register and within the sheet), the right
  life/rate field is present for the method — before anything is written; one bad row rejects the
  whole sheet with its row number and column in `details.errors`. Assets land with
  `openingBalance: true` and `openingItWdv` (the tax written-down value at import). One journal
  per class — Dr the asset at cost, Cr the accumulated depreciation given, Cr `EQ-001` for the
  rest — posts once per class using the same existing-voucher check `postRun` already relies on,
  so a second import into a class that already has an opening voucher creates the assets but does
  not post again. `itBlocks()` now uses `openingItWdv` instead of cost for these assets.
- **Capitalisation from a document.** `POST /api/assets/capitalise`
  (`sourceDocType: "GRN_INVOICE" | "EXPENSE"`, `sourceDocId`, `lineId?`, `classId`, …) moves the
  line's taxable amount off `PURCH-001` or `EXP-001` and onto the asset ledger with a journal.
  Refuses a source not yet posted to the books and a line already capitalised — checked up front
  for a friendly message, and enforced under a race by a partial unique index on
  `(company, source_doc_type, source_doc_id, source_line_id)`. Web: "Capitalise as asset" on a
  GRN invoice line and on an approved expense in the expenses list.
- **Depreciation run reversal.** `POST /api/assets/depreciation-runs/:id/reverse` cancels the
  run's voucher through `cancellationService` (a swapped-sides reversal, the original stays on
  file), restores every asset's accumulated depreciation, sets the run `REVERSED`, and refuses
  when a later period is still `POSTED` — reverse in order. `prepareRun` now re-prepares a
  reversed (or cancelled) period into the same row instead of hitting the period's unique
  constraint on a second insert.
- **Asset class edit.** The screen now has an edit form (and an add-a-class form) over the
  existing `POST /api/assets/classes` upsert; the classes tab was read-only before this.
- Schema: `FixedAsset.openingBalance`, `.openingItWdv`, `.sourceLineId`;
  `DepreciationRun.reversedBy/.reversedAt/.reversalVoucherId`; `DepreciationRunStatus.REVERSED`;
  a partial unique index for capitalisation dedup — migration
  `20260914070000_fixed_assets_completion`. No new permission keys: opening balances and class
  edit use `assets.manage`, capitalisation uses `assets.create`, reversal uses
  `assets.depreciate` — the roles that already hold them (Owner, Accounts) get this for free.
- `apps/api/test/integration/assets-completion.spec.ts`: opening import happy path with the
  income-tax block report reflecting the opening WDV; a bad row rejects the whole import and
  writes nothing; capitalising a GRN line posts the journal and a second attempt is refused;
  reversing a run restores accumulated depreciation and refuses out of order (and refuses a
  second reversal of the same run); permission refusal; cross-tenant. `assets.spec.ts` (P1-18)
  passes unchanged.

## Decisions worth knowing

- **The opening-balance journal is per class, not per row**, the same shape as the monthly
  depreciation run's posting: it makes "post once per class" a property of the existing-voucher
  check rather than a new kind of bookkeeping.
- **SLM's "remaining life" is turned into a synthetic `usefulLifeMonths`** so that
  `depreciation.calc.ts` — which was deliberately left untouched — charges exactly
  `(cost − residual − accumulated) / remainingMonths` a month, the same engine, without adding a
  second code path for assets that came in mid-life. WDV's rate is turned into a life the same
  way, running Schedule II's own rate formula backwards (`asset.opening.ts`,
  `usefulLifeMonthsFromWdvRate`).
- **The income-tax block report's "opening" figure is only as good as what was imported.** For
  years before any opening-balance import existed, or for assets typed in directly, it is still a
  plain sum of cost, as P1-18 left it and says so in the report's note.

## Half-done / known gaps

- Capitalising an expense requires the expense to already be `Approved` (posted); there is no
  test for the expense path specifically — the GRN path is covered and the two share the same
  code, but the expense branch is otherwise exercised only by code review, not by a test.
- No screen shows a reversed run's restored figures against the register in one place; a user has
  to check the asset row and the run separately.
- The CSV opening import has no template download beyond an in-memory example the button opens as
  a blob URL; a downloadable file would be friendlier.

## Next

Nothing scheduled from this note; P2-07 closes the P1-18 gap list.

## Blocked on you

Nothing. Existing behaviour and permissions were reused throughout.

## A note on the test run

This package's own suite (`assets.spec.ts` + `assets-completion.spec.ts`, 14 tests) and
`routes.spec.ts` (snapshot updated for the four new routes) are green when run right after a fresh
`npx prisma generate` in this worktree. The full API suite, and a plain re-run of just this
package's tests a few minutes later, intermittently show unrelated failures (GRN invoices,
accounts payable/receivable, MSME, GSTR-1/9, cancellation, ageing — none of them touched by this
package) with errors like a missing `tds_amount` column or a Prisma client that rejects
`openingBalance` as an unknown field. Both signatures point at the same cause: `node_modules` is
shared across every agent's worktree in this environment, and another agent's concurrent
`prisma generate` (from a schema with columns this branch does not have) overwrites the generated
client this process is running against, mid-suite. Re-running `npx prisma generate` immediately
before the tests reliably clears it, which is how the green runs above were obtained. This is an
environment property of the shared workspace, not a defect in this package — flagging it here
since the brief asks not to under-report a red run.

## Changelog sentence

Fixed assets can now be brought in already part-depreciated by import, capitalised straight off a
GRN line or an approved expense, and a posted month's depreciation can be reversed in order; the
asset-class screen is no longer read-only.
