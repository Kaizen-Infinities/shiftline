import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { accountService, type AccountLedger } from "../../../services/accountService";
import {
  costingService,
  type BackfillResult,
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
} from "../components/reportUi";

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
  // The stock tab's own period, independent of the cost-centres tab's selector above — the two
  // answer different questions ("what was stock worth in July" vs "how did July's spend compare
  // to plan") and sharing one control meant changing one always changed the other by accident.
  const [stockPeriodKey, setStockPeriodKey] = useState(months[1]?.value ?? months[0].value);
  const [fyCode, setFyCode] = useState(years[0].value);
  const [stock, setStock] = useState<ClosingStock | null>(null);
  const [wip, setWip] = useState<WipTotal | null>(null);
  const [wipStatus, setWipStatus] = useState<{
    posted: boolean;
    wip: number;
    wipPosted: number | null;
    upToDate: boolean;
  } | null>(null);
  const [wipLedgerCode, setWipLedgerCode] = useState("WIP");
  const [assetLedgers, setAssetLedgers] = useState<AccountLedger[]>([]);
  const [savingWipLedger, setSavingWipLedger] = useState(false);
  const [ledger, setLedger] = useState<ValuationEntry[]>([]);
  const [pl, setPl] = useState<CostCentrePl | null>(null);
  const [variance, setVariance] = useState<VarianceReport | null>(null);
  const [sheets, setSheets] = useState<CostSheetRow[]>([]);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "stock") {
        const [sy, sm] = stockPeriodKey.split("-").map(Number);
        const stockAsOn = new Date(Date.UTC(sy, sm, 0)).toISOString().slice(0, 10);
        setStock(await costingService.closingStock(stockAsOn));
        setWip(await costingService.wip());
        setWipStatus(await costingService.closingStockStatus(stockPeriodKey));
        if (can("costing.manage")) {
          const [settings, ledgers] = await Promise.all([
            costingService.settings(),
            accountService.fetchLedgers({ type: "ASSET", limit: 500 }),
          ]);
          setWipLedgerCode(settings.wipLedgerCode);
          setAssetLedgers(ledgers.ledgers);
        }
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
  }, [tab, periodKey, stockPeriodKey, fyCode, can]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="sl-page">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="sl-h1 m-0 leading-tight">Costing</h1>
          <p className="sl-muted m-0 mt-1 max-w-3xl text-sm leading-snug">
            What the stock is worth at weighted average, what each product cost to make, where the
            money went and whether that was the plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "stock" && (
            <select
              className={field}
              value={stockPeriodKey}
              onChange={(e) => setStockPeriodKey(e.target.value)}
              aria-label="Stock period"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
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
            <>
              <button
                className={primary}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const out = await costingService.postClosingStock(stockPeriodKey);
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
                Post {stockPeriodKey} stock movement
              </button>
              <button
                className={primary}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await costingService.backfillValuation();
                    setBackfillResult(result);
                    toast.success(
                      `Backfilled ${result.created} valuation entries (${result.skipped} skipped)`
                    );
                  } catch (err) {
                    toast.error(message(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Backfill valuation
              </button>
            </>
          )}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" role="tablist">
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
            className="sl-chip sl-chip-lg"
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && (
        <div className="sl-tile space-y-3 p-5" role="status" aria-label="Loading">
          <div className="sl-skeleton h-4 w-2/5" />
          <div className="sl-skeleton h-3 w-3/4" />
          <div className="sl-skeleton h-3 w-1/2" />
        </div>
      )}

      {tab === "stock" && stock && (
        <>
          <Card title={`Stock at ${stock.asOn}`}>
            <p className="text-2xl font-semibold text-ink">{money(stock.total)}</p>
            <p className="mt-1 text-xs text-ink-muted">
              At weighted average across {stock.rows.length} item-and-store balances.
            </p>
            {stock.negatives > 0 && (
              <p className="mt-2 rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 p-2 text-sm text-[color:var(--color-danger)]">
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
              {wipStatus && (
                <p
                  className={`mt-2 rounded-lg border p-2 text-sm ${
                    wipStatus.upToDate
                      ? "border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]"
                      : "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]"
                  }`}
                >
                  {wipStatus.posted
                    ? wipStatus.upToDate
                      ? `Posted for ${stockPeriodKey}, and matches the current figure.`
                      : `Posted for ${stockPeriodKey} at ${money(wipStatus.wipPosted ?? 0)} — WIP has moved since; post again to bring it current.`
                    : `Not posted for ${stockPeriodKey} yet.`}
                </p>
              )}
              {can("costing.manage") && (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-soft pt-3">
                  <label className="text-xs text-ink-muted">
                    WIP ledger
                    <select
                      className={`${field} mt-1 block`}
                      value={wipLedgerCode}
                      onChange={(e) => setWipLedgerCode(e.target.value)}
                    >
                      {!assetLedgers.some((l) => l.code === wipLedgerCode) && (
                        <option value={wipLedgerCode}>{wipLedgerCode}</option>
                      )}
                      {assetLedgers.map((l) => (
                        <option key={l.id} value={l.code}>
                          {l.name} ({l.code})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className={primary}
                    disabled={savingWipLedger}
                    onClick={async () => {
                      setSavingWipLedger(true);
                      try {
                        await costingService.saveSettings(wipLedgerCode);
                        toast.success(`WIP now posts to ${wipLedgerCode}`);
                        await load();
                      } catch (err) {
                        toast.error(message(err));
                      } finally {
                        setSavingWipLedger(false);
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              )}
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
                        className={`${td} text-right ${r.quantity < 0 ? "font-semibold text-[color:var(--color-danger)]" : ""}`}
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
          {backfillResult && (
            <Card title="Backfill valuation report">
              <p className="mb-3 text-sm text-ink-muted">
                Scanned {backfillResult.scanned} rows, filled {backfillResult.created}, skipped{" "}
                {backfillResult.skipped}.
              </p>
              {backfillResult.pairs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr>
                        <th className={th}>Item</th>
                        <th className={th}>Store</th>
                        <th className={`${th} text-right`}>Filled</th>
                        <th className={`${th} text-right`}>Skipped</th>
                        <th className={th}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backfillResult.pairs.map((p) => (
                        <tr
                          key={`${p.itemCode}-${p.storeCode}`}
                          className="border-t border-line-soft"
                        >
                          <td className={td}>{p.itemCode}</td>
                          <td className={td}>{p.storeCode}</td>
                          <td className={`${td} text-right`}>{p.filled}</td>
                          <td className={`${td} text-right`}>{p.skipped}</td>
                          <td className={td}>{p.skipReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
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
                      className={`${td} text-right ${e.wentNegative ? "font-semibold text-[color:var(--color-danger)]" : ""}`}
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
            <div className="rounded-lg border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 p-3 text-sm text-[color:var(--color-warning)]">
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
                          r.result >= 0
                            ? "text-[color:var(--color-success)]"
                            : "text-[color:var(--color-danger)]"
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
                        r.favourable
                          ? "text-[color:var(--color-success)]"
                          : "text-[color:var(--color-danger)]"
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
