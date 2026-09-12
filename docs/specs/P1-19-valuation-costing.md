# P1-19 — Valuation, costing, cost centres and budgets

## Why

The company knows how many kilos of granule are in the store and what it charges for a bucket. It
does not know what the bucket costs. Without that, the gross margin in the accounts is a
plug, the closing stock on the balance sheet is a guess, and nobody can say which machine or which
department is losing money.

## Scope

- **Weighted-average valuation** per item per store, kept as a movement ledger rather than a
  single running number, so every change in the average can be explained. A receipt moves the
  average; an issue does not — it leaves at the average of the day, which is the whole point of
  the method and the thing implementations usually get wrong.
- **Landed cost feeds it**: a receipt's rate is what the goods actually cost, including the duty
  and clearing charges P1-17 works out, not the supplier's invoice line.
- **Closing stock** posted at a period close (Dr Closing Stock, Cr Change in inventories) from the
  valuation rather than a typed figure.
- **WIP and scrap**: material issued to a production order that has not finished is work in
  progress; what came out as scrap is valued and taken out of the order's cost, because scrap
  carried at full material cost overstates the finished goods.
- **Product cost sheet** for a period: material at the weighted average actually consumed, labour
  from the hours booked against the order, and overhead by an allocation rule the tenant chooses.
- **Cost centres** on journal lines and expenses, with a cost-centre profit and loss.
- **Budgets** by ledger, cost centre and period, with variance against the actuals.

## Out of scope

FIFO and standard costing (weighted average is what the Income-tax Rules and most Indian
manufacturers use, and running two methods at once invites the wrong one being reported),
activity-based costing, transfer pricing between business places, and rolling forecasts.

## Acceptance

- Two receipts at different rates give an average between them, weighted by quantity.
- An issue after those receipts leaves at the average, and **does not change it**.
- A receipt after an issue moves the average again from the remaining balance, not from zero.
- Landed cost from a bill of entry reaches the valuation.
- A cost-centre P&L adds up to the company P&L when every line is tagged.
- A budget variance is actual minus budget, with the sign the right way round for income and for
  expense.
- Every query is tenant-scoped.
