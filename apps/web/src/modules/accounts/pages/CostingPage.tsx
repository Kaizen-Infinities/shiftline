import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  costingService,
  type ClosingStock,
  type CostCentrePl,
  type CostSheetRow,
  type ValuationEntry,
  type VarianceReport,
  type WipTotal,
} from "../../../services/costingService";
import {
  Card,
  day,
  field,
  fyOptions,
  message,
  money,
  monthOptions,
  primary,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * Valuation and costing (P1-19).
 *
 * Four questions on four tabs: what the stock is worth, why the average is what it is, where the
 * money went, and whether that was the plan. The valuation ledger is on the screen rather than
 * hidden behind the total, because "why is the average 55?" is the question this package exists
 * to answer.
 */
type Tab = "stock" | "ledger" | "centres" | "budgets" | "sheets";

const CostingPage: React.FC = () => {
  const { can } = usePermission();
  const months = useMemo(() => monthOptions(12), []);
  const years = useMemo(() => fyOptions(3), []);
  const [tab, setTab] = useState<Tab>("stock");
  const [periodKey, setPeriodKey] = useState(months[1]?.value ?? months[0].value);
  const [fyCode, setFyCode] = useState(years[0].value);
  const [stock, setStock] = useState<ClosingStock | null>(null);
  const [wip, setWip] = useState<WipTotal | null>(null);
  const [ledger, setLedger] = useState<ValuationEntry[]>([]);
  const [pl, setPl] = useState<CostCentrePl | null>(null);
  const [variance, setVariance] = useState<VarianceReport | null>(null);
  const [sheets, setSheets] = useState<CostSheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "stock") {
        setStock(await costingService.closingStock());
        setWip(await costingService.wip());
      }
      if (tab === "ledger") setLedger(await costingService.ledger());
      if (tab === "centres") {
        const [y, m] = periodKey.split("-").map(Number);
        const from = `${periodKey}-01`;
        const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        setPl(await costingService.costCentrePl(from, to));
      }
      if (tab === "budgets") setVariance(await costingService.variance(fyCode));
      if (tab === "sheets") setSheets(await costingService.costSheets());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, periodKey, fyCode]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Costing</h1>
          <p className="text-sm text-ink-muted">
            What the stock is worth at weighted average, what each product cost to make, where the
            money went and whether that was the plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "centres" && (
            <select
              className={field}
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              aria-label="Month"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          {tab === "budgets" && (
            <select
              className={field}
              value={fyCode}
              onChange={(e) => setFyCode(e.target.value)}
              aria-label="Financial year"
            >
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </select>
          )}
          {tab === "stock" && can("costing.manage") && (
            <button
              className={primary}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const out = await costingService.postClosingStock(periodKey);
                  toast.success(
                    out.posted
                      ? `Posted the movement of ${out.movement}`
                      : "Nothing to post for that month"
                  );
                  await load();
                } catch (err) {
                  toast.error(message(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Post {periodKey} stock movement
            </button>
          )}
        </div>
      </header>

      <nav className="flex gap-1 border-b border-line-soft" role="tablist">
        {(
          [
            ["stock", "Closing stock"],
            ["ledger", "Valuation ledger"],
            ["centres", "Cost centres"],
            ["budgets", "Budgets"],
            ["sheets", "Cost sheets"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-semibold transition ${
              tab === key
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && <p className="text-sm text-ink-muted">Loading…</p>}

      {tab === "stock" && stock && (
        <>
          <Card title={`Stock at ${stock.asOn}`}>
            <p className="text-2xl font-semibold text-ink">{money(stock.total)}</p>
            <p className="mt-1 text-xs text-ink-muted">
              At weighted average across {stock.rows.length} item-and-store balances.
            </p>
            {stock.negatives > 0 && (
              <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
                {stock.negatives} balance(s) are negative. An average over a negative quantity means
                nothing — somebody has to go and look at the store.
              </p>
            )}
          </Card>
          {wip && (
            <Card title="Work in progress">
              <p className="text-2xl font-semibold text-ink">{money(wip.total)}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Material issued to {wip.rows.length} open production order(s), still on the floor —
                not in raw-material stock above, and not yet finished goods.
              </p>
              {wip.rows.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr>
                        <th className={th}>Production order</th>
                        <th className={th}>Status</th>
                        <th className={`${th} text-right`}>WIP value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wip.rows.map((r) => (
                        <tr key={r.productionOrderId} className="border-t border-line-soft">
                          <td className={td}>{r.productionOrderId}</td>
                          <td className={td}>{r.status}</td>
                          <td className={`${td} text-right`}>{money(r.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          <Card title="By item">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Store</th>
                    <th className={`${th} text-right`}>Quantity</th>
                    <th className={`${th} text-right`}>Average</th>
                    <th className={`${th} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.rows.map((r) => (
                    <tr
                      key={`${r.itemType}-${r.itemId}-${r.storeId ?? ""}`}
                      className="border-t border-line-soft"
                    >
                      <td className={td}>
                        {r.itemId}
                        <div className="text-xs text-ink-muted">
                          {r.itemType.replace(/_/g, " ").toLowerCase()}
                        </div>
                      </td>
                      <td className={td}>{r.storeId ?? "—"}</td>
                      <td
                        className={`${td} text-right ${r.quantity < 0 ? "font-semibold text-rose-700" : ""}`}
                      >
                        {r.quantity}
                      </td>
                      <td className={`${td} text-right`}>{r.avgRate}</td>
                      <td className={`${td} text-right font-semibold`}>{money(r.value)}</td>
                    </tr>
                  ))}
                  {stock.rows.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={5}>
                        Nothing has been valued yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "ledger" && (
        <Card title="Why the average is what it is">
          <p className="mb-3 text-xs text-ink-muted">
            A receipt moves the average; an issue leaves at it and does not. Every row carries the
            balance and the average after it, so any month&apos;s closing stock can be read straight
            off the last row before the cut-off.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Item</th>
                  <th className={th}>Movement</th>
                  <th className={`${th} text-right`}>Quantity</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Value</th>
                  <th className={`${th} text-right`}>Balance</th>
                  <th className={`${th} text-right`}>Average after</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id} className="border-t border-line-soft">
                    <td className={td}>{day(e.movedOn)}</td>
                    <td className={td}>
                      {e.itemId}
                      {e.storeId && <div className="text-xs text-ink-muted">{e.storeId}</div>}
                    </td>
                    <td className={td}>{e.kind.replace(/_/g, " ").toLowerCase()}</td>
                    <td className={`${td} text-right`}>{Number(e.quantity)}</td>
                    <td className={`${td} text-right`}>{Number(e.rate)}</td>
                    <td className={`${td} text-right`}>{money(e.value)}</td>
                    <td
                      className={`${td} text-right ${e.wentNegative ? "font-semibold text-rose-700" : ""}`}
                    >
                      {Number(e.balanceQuantity)}
                    </td>
                    <td className={`${td} text-right font-semibold`}>{Number(e.avgRate)}</td>
                  </tr>
                ))}
                {ledger.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={8}>
                      No movements recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "centres" && pl && (
        <>
          {pl.unallocatedResult !== 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {money(Math.abs(pl.unallocatedResult))} is not tagged to any cost centre. It is shown
              as its own row rather than spread across the others — spreading it would make every
              centre wrong by an unknown amount.
            </div>
          )}
          <Card title={`By cost centre · ${pl.from} to ${pl.to}`}>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Cost centre</th>
                    <th className={`${th} text-right`}>Income</th>
                    <th className={`${th} text-right`}>Expense</th>
                    <th className={`${th} text-right`}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.rows.map((r) => (
                    <tr key={r.costCentreId ?? "none"} className="border-t border-line-soft">
                      <td className={td}>
                        {r.name}
                        <div className="text-xs text-ink-muted">{r.code}</div>
                      </td>
                      <td className={`${td} text-right`}>{money(r.income)}</td>
                      <td className={`${td} text-right`}>{money(r.expense)}</td>
                      <td
                        className={`${td} text-right font-semibold ${
                          r.result >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {money(r.result)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line-soft font-semibold">
                    <td className={td}>Total</td>
                    <td className={`${td} text-right`}>{money(pl.totals.income)}</td>
                    <td className={`${td} text-right`}>{money(pl.totals.expense)}</td>
                    <td className={`${td} text-right`}>{money(pl.totals.result)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "budgets" && variance && (
        <Card title={`Budget against actual · FY ${variance.fyCode}`}>
          <p className="mb-3 text-xs text-ink-muted">
            Favourable means better than planned: under budget on a cost, over budget on an income.
            {variance.totals.adverse > 0 && ` ${variance.totals.adverse} line(s) are adverse.`}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Ledger</th>
                  <th className={th}>Period</th>
                  <th className={th}>Cost centre</th>
                  <th className={`${th} text-right`}>Budget</th>
                  <th className={`${th} text-right`}>Actual</th>
                  <th className={`${th} text-right`}>Variance</th>
                  <th className={`${th} text-right`}>Used</th>
                </tr>
              </thead>
              <tbody>
                {variance.rows.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft">
                    <td className={td}>
                      {r.ledgerName}
                      <div className="text-xs text-ink-muted">{r.ledgerType.toLowerCase()}</div>
                    </td>
                    <td className={td}>{r.periodKey ?? "Whole year"}</td>
                    <td className={td}>{r.costCentre ?? "All"}</td>
                    <td className={`${td} text-right`}>{money(r.budget)}</td>
                    <td className={`${td} text-right`}>{money(r.actual)}</td>
                    <td
                      className={`${td} text-right font-semibold ${
                        r.favourable ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {money(r.variance)}
                    </td>
                    <td className={`${td} text-right`}>
                      {r.usedPercent === null ? "—" : `${r.usedPercent}%`}
                    </td>
                  </tr>
                ))}
                {variance.rows.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={7}>
                      No budget set for this year.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "sheets" && (
        <Card title="Product cost sheets">
          <p className="mb-3 text-xs text-ink-muted">
            Material at the weighted average it actually left the store at, labour and overhead as
            allocated, and the scrap credited back — carrying scrap at full material cost would
            overstate the finished goods by the value of the waste.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>Period</th>
                  <th className={`${th} text-right`}>Made</th>
                  <th className={`${th} text-right`}>Material</th>
                  <th className={`${th} text-right`}>Labour</th>
                  <th className={`${th} text-right`}>Overhead</th>
                  <th className={`${th} text-right`}>Less scrap</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Per unit</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((s) => (
                  <tr key={s.id} className="border-t border-line-soft">
                    <td className={td}>
                      {s.product?.productName ?? s.productId}
                      {s.overheadBasis && (
                        <div className="text-xs text-ink-muted">
                          overhead by {s.overheadBasis.replace(/_/g, " ").toLowerCase()}
                        </div>
                      )}
                    </td>
                    <td className={td}>{s.periodKey}</td>
                    <td className={`${td} text-right`}>{Number(s.quantityProduced)}</td>
                    <td className={`${td} text-right`}>{money(s.materialCost)}</td>
                    <td className={`${td} text-right`}>{money(s.labourCost)}</td>
                    <td className={`${td} text-right`}>{money(s.overheadCost)}</td>
                    <td className={`${td} text-right`}>{money(s.scrapCredit)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(s.totalCost)}</td>
                    <td className={`${td} text-right`}>{Number(s.perUnitCost).toFixed(2)}</td>
                  </tr>
                ))}
                {sheets.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={9}>
                      No cost sheet has been built yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default CostingPage;
