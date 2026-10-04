# P1-19 — Valuation, costing, cost centres and budgets

## Shipped

- **Weighted-average valuation** as a movement ledger (`StockValuationEntry`), not a running
  number on the item. A receipt moves the average; an issue leaves at it and does not. Every row
  carries the balance and the average _after_ it, so any month's closing stock is the last row
  before the cut-off and any average can be explained line by line.
- `closingStock(asOn)` built from those last rows, so the report and the ledger agree by
  construction rather than by a second calculation that can drift.
- **The stock movement posted**, not the balance: Dr Closing Stock / Cr Change in Inventories for
  the difference between the period's opening and closing valuation, idempotent per period.
- **Cost centres** on journal lines (`JournalItem.costCentreId`), taggable after the fact and
  splittable across a voucher, with a cost-centre profit and loss that shows what is
  **unallocated** as its own row.
- **Budgets** by financial year, optional month, ledger and optional cost centre, with a variance
  report whose sign follows the ledger's nature — under on a cost is favourable, under on an
  income is not.
- **Product cost sheets**: material from what was actually issued at the average it left at,
  labour and overhead as allocated, scrap credited back, the material lines kept on the row, and
  the overhead basis recorded so the number can be argued with.
- Two seed ledgers (`STOCK-001`, `STOCK-CHG-001`), permissions `costing.{view,manage}` granted to
  Owner and Accounts, migration `20260912220000_valuation_costing` with RLS and audit triggers,
  web `/accounts/costing` with five tabs, in `e2e/smoke.spec.ts`. `costing.spec.ts` (10 tests).

## Decisions worth knowing

- **An issue does not change the average.** This is the whole method and the usual bug: valuing
  an issue at the last receipt's rate, or recomputing the average on the way out, makes the
  closing stock drift away from what was actually paid, and the drift only surfaces at a year end
  when it is too late to find. Three of the tests exist for this one rule.
- **A ledger, not a running total.** The average is the figure everyone argues about at a year
  end, and a balance nobody can take apart is a balance nobody can defend.
- **Negative stock is allowed but flagged.** Production races the paperwork, so refusing the
  issue would block the floor; but an average over a negative quantity means nothing, so the row
  and the report both say so out loud.
- **Unallocated cost is a row, not a spread.** Apportioning it across the centres makes every
  centre wrong by an unknown amount and hides the fact that the tagging is incomplete — the thing
  the reader most needs to know.
- **The variance sign follows the ledger's nature.** A bare subtraction would call a good month a
  bad one on every income line.
- **Scrap is credited back to the cost sheet.** Carrying it at full material cost overstates the
  finished goods by exactly the value of the waste.
- **The stock posting is the movement.** Posting the closing balance each month would pile the
  stock up again and again.

## Half-done / known gaps

- **Nothing feeds the valuation automatically yet.** A GRN receipt, a production issue, a wastage
  entry and a stock adjustment all move stock, and none of them calls `valuationService.record`.
  The service, the API and the reports are ready; wiring each document is mechanical and is the
  first thing to do next, because until then the valuation is only as complete as what is posted
  by hand. Landed cost from a bill of entry (P1-17) reaches it the same way.
- WIP is not computed. Material issued to an open production order sits in the valuation as
  issued and in no other balance; a work-in-progress figure needs the order's own state, which
  means reading `ProductionOrder` and is a package of its own.
- The cost sheet takes labour and overhead as inputs rather than deriving them. Labour from the
  hours booked on the order and overhead from a rule are both possible with what exists
  (`HourlyProduction`, `PayrollResult`), but choosing the allocation rule is a decision the owner
  has not made yet — the basis is recorded on the sheet so it can be changed later without
  rewriting history.
- Only weighted average. FIFO and standard costing are deliberately out; running two methods at
  once invites the wrong one being reported.
- The cost centre P&L is by centre only, not by centre and ledger; a drill-down is a small
  addition to the same query.
- Budgets have no approval or versioning: the last person to save wins.
- There is no screen to create a budget or a cost sheet — both are API-only so far, and the
  screen shows what exists.

## Next

P1-20: bank reconciliation and post-dated cheques.

## Blocked on you

- The overhead allocation rule. The sheet supports quantity, material value and labour hours and
  records which was used; which one the company actually wants is a decision, not a default.

## Changelog sentence

Stock is now valued at weighted average with a movement ledger that explains every change in the
average, the month's stock movement posts itself, costs can be tagged to cost centres and read as
a profit and loss, budgets show variance against the actuals, and each product gets a cost sheet.
