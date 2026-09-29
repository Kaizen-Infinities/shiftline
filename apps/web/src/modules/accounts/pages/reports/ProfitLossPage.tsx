import React, { useState, useCallback, useMemo } from "react";
import { ArrowDown, ArrowUp, Download, Printer, RefreshCw, TrendingUp } from "lucide-react";
import apiClient from "../../../../api/apiClient";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { useDetailCache } from "../../../../hooks/useDetailCache";
import { ScheduleIIIProfitLoss, type ProfitLossScheduleIII } from "../../components/ScheduleIII";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatTile,
} from "../../../../components/ui/v2";
import {
  FilterGroup,
  ReportFilterBar,
  fmtDate,
  fmtINR,
  fmtINRCompact,
  rptGroupRowClass,
  rptTdClass,
  signTone,
  thClass,
} from "../../components/accountsUi";

interface PLAccount {
  ledgerId: number;
  code: string;
  name: string;
  group: string;
  totalDebit: number;
  totalCredit: number;
  netAmount: number;
}

interface PLData {
  startDate: string | null;
  endDate: string | null;
  incomeAccounts: PLAccount[];
  expenseAccounts: PLAccount[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  isProfit: boolean;
  scheduleIII?: ProfitLossScheduleIII;
}

interface PLPeriodAccount {
  ledgerId: number;
  code: string;
  name: string;
  group: string;
  perPeriod: number[];
  total: number;
}

interface PLPeriodData {
  groupBy: "month" | "quarter";
  startDate: string;
  endDate: string;
  periods: Array<{ key: string; label: string }>;
  incomeAccounts: PLPeriodAccount[];
  expenseAccounts: PLPeriodAccount[];
  totalIncomePerPeriod: number[];
  totalExpensePerPeriod: number[];
  netPerPeriod: number[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  isProfit: boolean;
}

type PLVariant =
  | "alpha-summary"
  | "alpha-detailed"
  | "grouped-summary"
  | "grouped-detailed"
  | "hierarchical"
  | "monthly"
  | "quarterly"
  | "schedule-iii-summary"
  | "schedule-iii-detailed";

const VARIANT_MAP: Record<
  PLVariant,
  {
    label: string;
    layout: "alpha" | "grouped" | "hierarchical" | "monthly" | "quarterly" | "schedule";
    detailed: boolean;
  }
> = {
  "alpha-summary": { label: "Alphabetical · Summary", layout: "alpha", detailed: false },
  "alpha-detailed": { label: "Alphabetical · Detailed", layout: "alpha", detailed: true },
  "grouped-summary": { label: "Grouped · Summary", layout: "grouped", detailed: false },
  "grouped-detailed": { label: "Grouped · Detailed", layout: "grouped", detailed: true },
  hierarchical: { label: "Hierarchical", layout: "hierarchical", detailed: true },
  monthly: { label: "Monthly Trend", layout: "monthly", detailed: false },
  quarterly: { label: "Quarterly Trend", layout: "quarterly", detailed: false },
  "schedule-iii-summary": { label: "Schedule III · Summary", layout: "schedule", detailed: false },
  "schedule-iii-detailed": { label: "Schedule III · Detailed", layout: "schedule", detailed: true },
};

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ProfitLossPage: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const fyStart = `${currentYear}-04-01`;
  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState<string>(fyStart);
  const [endDate, setEndDate] = useState<string>(today);
  const [showZeroBalance, setShowZeroBalance] = useState<boolean>(false);
  const [variant, setVariant] = useState<PLVariant>("grouped-summary");
  const activeConfig = VARIANT_MAP[variant];

  const isPeriodMode = activeConfig.layout === "monthly" || activeConfig.layout === "quarterly";
  const cacheKey = isPeriodMode
    ? `accounts:profit-loss:period:${startDate}:${endDate}:${activeConfig.layout}`
    : `accounts:profit-loss:${startDate}:${endDate}:${showZeroBalance}`;

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<PLData | PLPeriodData> => {
      if (isPeriodMode) {
        const params = new URLSearchParams();
        params.set("startDate", startDate);
        params.set("endDate", endDate);
        params.set("groupBy", activeConfig.layout === "monthly" ? "month" : "quarter");
        const res = await apiClient.get(`/accounts/profit-loss/by-period?${params.toString()}`, {
          signal,
        });
        return res.data.data as PLPeriodData;
      }
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("showZeroBalance", String(showZeroBalance));
      const res = await apiClient.get(`/accounts/profit-loss?${params.toString()}`, { signal });
      return res.data.data as PLData;
    },
    [isPeriodMode, startDate, endDate, showZeroBalance, activeConfig.layout]
  );

  const {
    data: cached,
    loading,
    refreshing,
    refresh,
  } = useDetailCache<PLData | PLPeriodData>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
  });

  const data = !isPeriodMode ? (cached as PLData | null) : null;
  const periodData = isPeriodMode ? (cached as PLPeriodData | null) : null;

  const handleVariantClick = (v: PLVariant) => setVariant(v);

  const filteredData = useMemo(() => {
    if (!data) return null;
    let income = showZeroBalance
      ? data.incomeAccounts
      : data.incomeAccounts.filter((a) => Math.abs(a.netAmount) > 0.01);
    let expense = showZeroBalance
      ? data.expenseAccounts
      : data.expenseAccounts.filter((a) => Math.abs(a.netAmount) > 0.01);
    if (activeConfig.layout === "alpha") {
      income = [...income].sort((a, b) => a.name.localeCompare(b.name));
      expense = [...expense].sort((a, b) => a.name.localeCompare(b.name));
    }
    return { ...data, incomeAccounts: income, expenseAccounts: expense };
  }, [data, showZeroBalance, activeConfig.layout]);

  const groupItems = (items: PLAccount[]): Array<[string, PLAccount[]]> => {
    const buckets: Record<string, PLAccount[]> = {};
    items.forEach((it) => {
      const g = it.group || "Others";
      if (!buckets[g]) buckets[g] = [];
      buckets[g].push(it);
    });
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
  };

  const handlePrint = () => window.print();

  const exportCSV = () => {
    if (!filteredData) return;
    const lines: string[][] = [];
    lines.push(["Profit & Loss Statement - " + activeConfig.label]);
    lines.push([`Period: ${startDate} to ${endDate}`]);
    lines.push([]);
    lines.push(["INCOME"]);
    lines.push(["Code", "Name", "Group", "Amount"]);
    filteredData.incomeAccounts.forEach((a) =>
      lines.push([a.code, a.name, a.group, a.netAmount.toFixed(2)])
    );
    lines.push(["", "Total Income", "", filteredData.totalIncome.toFixed(2)]);
    lines.push([]);
    lines.push(["EXPENSES"]);
    lines.push(["Code", "Name", "Group", "Amount"]);
    filteredData.expenseAccounts.forEach((a) =>
      lines.push([a.code, a.name, a.group, a.netAmount.toFixed(2)])
    );
    lines.push(["", "Total Expenses", "", filteredData.totalExpense.toFixed(2)]);
    lines.push([]);
    lines.push([
      "",
      filteredData.isProfit ? "Net Profit" : "Net Loss",
      "",
      Math.abs(filteredData.netProfit).toFixed(2),
    ]);

    const csv = lines.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-loss-${variant}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const colSpanAll = activeConfig.detailed ? 4 : 2;
  const labelSpan = activeConfig.detailed ? 3 : 1;

  const renderRow = (a: PLAccount, isIncome: boolean, indent = false) => (
    <tr
      key={`${isIncome ? "inc" : "exp"}-${a.ledgerId}`}
      className="sl-row-hover border-b border-line-soft"
    >
      {activeConfig.detailed && (
        <td className={rptTdClass("left", "tabular-nums text-ink-muted")}>{a.code}</td>
      )}
      <td className={rptTdClass("left", indent ? "pl-9" : "")}>{a.name}</td>
      {activeConfig.detailed && <td className={rptTdClass("left", "text-ink-muted")}>{a.group}</td>}
      <td className={rptTdClass("right")}>{fmt(a.netAmount)}</td>
    </tr>
  );

  const renderSection = (items: PLAccount[], isIncome: boolean) => {
    const groups =
      activeConfig.layout === "grouped" || activeConfig.layout === "hierarchical"
        ? groupItems(items)
        : null;
    if (!groups) {
      // Alphabetical / flat rendering
      return items.map((a) => renderRow(a, isIncome, false));
    }
    return groups.flatMap(([gname, gitems]) => {
      const gtotal = gitems.reduce((s, i) => s + i.netAmount, 0);
      return [
        <tr key={`grp-${isIncome ? "i" : "e"}-${gname}`} className="border-b border-line-soft">
          <td colSpan={labelSpan} className={rptTdClass("left", "font-semibold")}>
            {gname}
          </td>
          <td className={rptTdClass("right", "font-semibold")}>{fmt(gtotal)}</td>
        </tr>,
        ...gitems.map((a) => renderRow(a, isIncome, true)),
      ];
    });
  };

  const sectionHead = (label: string, icon: React.ReactNode, span: number) => (
    <tr className={rptGroupRowClass}>
      <th
        scope="rowgroup"
        colSpan={span}
        className="px-4 py-2.5 text-left text-[13px] font-semibold text-ink"
      >
        <span className="inline-flex items-center gap-2">
          <span className="text-ink-subtle" aria-hidden="true">
            {icon}
          </span>
          {label}
        </span>
      </th>
    </tr>
  );

  const summary = filteredData ?? periodData;
  const netTone = summary && summary.isProfit ? "success" : "danger";

  return (
    <div className="sl-page">
      <PageHeader
        title="Profit & Loss"
        subtitle={`${activeConfig.label} · ${fmtDate(startDate)} to ${fmtDate(endDate)}`}
        icon={<TrendingUp size={20} />}
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<Printer size={16} />}
              onClick={handlePrint}
              disabled={!cached}
            >
              Print
            </ActionPill>
            <ActionPill
              variant="secondary"
              icon={<Download size={16} />}
              onClick={exportCSV}
              disabled={!cached}
            >
              Export
            </ActionPill>
            <ActionPill
              variant="secondary"
              icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
              onClick={refresh}
              disabled={refreshing}
            >
              Refresh
            </ActionPill>
          </>
        }
      />

      <ReportFilterBar className="print:hidden">
        <FilterGroup label="From" className="lg:w-[190px]">
          <DatePickerCalendar
            name="startDate"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            placeholder="Start"
          />
        </FilterGroup>
        <FilterGroup label="To" className="lg:w-[190px]">
          <DatePickerCalendar
            name="endDate"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            placeholder="End"
          />
        </FilterGroup>
        <label className="flex h-11 items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            className="sl-check"
            checked={showZeroBalance}
            onChange={(e) => setShowZeroBalance(e.target.checked)}
          />
          Show zero balance
        </label>
        <FilterGroup label="View" className="w-full">
          <div role="group" aria-label="Report view" className="flex flex-wrap gap-2">
            {(Object.keys(VARIANT_MAP) as PLVariant[]).map((v) => (
              <Chip key={v} selected={variant === v} onClick={() => handleVariantClick(v)}>
                {VARIANT_MAP[v].label}
              </Chip>
            ))}
          </div>
        </FilterGroup>
      </ReportFilterBar>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatTile
          label="Total income"
          value={
            <span title={summary ? fmtINR(summary.totalIncome) : undefined}>
              {fmtINRCompact(summary?.totalIncome ?? 0)}
            </span>
          }
          loading={loading && !summary}
        />
        <StatTile
          label="Total expenses"
          value={
            <span title={summary ? fmtINR(summary.totalExpense) : undefined}>
              {fmtINRCompact(summary?.totalExpense ?? 0)}
            </span>
          }
          loading={loading && !summary}
        />
        <StatTile
          className="col-span-2 lg:col-span-1"
          label={summary && !summary.isProfit ? "Net loss" : "Net profit"}
          value={
            <span title={summary ? fmtINR(Math.abs(summary.netProfit)) : undefined}>
              {fmtINRCompact(Math.abs(summary?.netProfit ?? 0))}
            </span>
          }
          delta={summary ? (summary.isProfit ? "Profit" : "Loss") : undefined}
          deltaDirection={summary ? (summary.isProfit ? "up" : "down") : undefined}
          deltaTone={netTone}
          loading={loading && !summary}
        />
      </div>

      {!cached && loading && (
        <div className="sl-tile overflow-hidden">
          <SkeletonRows rows={8} columns={2} rowHeight={40} label="Loading profit and loss" />
        </div>
      )}

      {!filteredData && !periodData && !loading && (
        <div className="sl-tile">
          <EmptyState
            icon={<TrendingUp size={28} />}
            title="No data for the selected variant"
            description={`Selected: ${activeConfig.label} · ${fmtDate(startDate)} to ${fmtDate(endDate)}`}
          />
        </div>
      )}

      {(activeConfig.layout === "monthly" || activeConfig.layout === "quarterly") && periodData && (
        <section
          aria-label={`Profit and loss, ${activeConfig.label}`}
          className="sl-tile flex flex-col overflow-hidden"
          style={{ maxHeight: "calc(100vh - 160px)" }}
        >
          <div className="border-b border-line-soft px-4 py-3 text-[13px] text-ink-muted">
            {activeConfig.label} · {periodData.periods.length} periods
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className={thClass("left", "left-0 z-[2] min-w-[220px]")}>
                    Account
                  </th>
                  {periodData.periods.map((p) => (
                    <th key={p.key} scope="col" className={thClass("right", "min-w-[110px]")}>
                      {p.label}
                    </th>
                  ))}
                  <th scope="col" className={thClass("right", "min-w-[130px]")}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {sectionHead(
                  "Revenue / income",
                  <ArrowUp size={14} />,
                  periodData.periods.length + 2
                )}
                {periodData.incomeAccounts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={periodData.periods.length + 2}
                      className="p-4 text-center text-[13px] text-ink-subtle"
                    >
                      No income
                    </td>
                  </tr>
                ) : (
                  periodData.incomeAccounts.map((a) => (
                    <tr
                      key={`inc-${a.ledgerId}`}
                      className="sl-row-hover border-b border-line-soft"
                    >
                      <td className={rptTdClass("left", "sticky left-0 bg-card")}>{a.name}</td>
                      {a.perPeriod.map((v, i) => (
                        <td key={i} className={rptTdClass("right")}>
                          {Math.abs(v) < 0.01 ? "—" : fmt(v)}
                        </td>
                      ))}
                      <td className={rptTdClass("right", "font-semibold")}>{fmt(a.total)}</td>
                    </tr>
                  ))
                )}
                <tr className="border-y border-line bg-card-2 font-semibold">
                  <td className={rptTdClass("left", "sticky left-0 bg-card-2 font-semibold")}>
                    Total revenue
                  </td>
                  {periodData.totalIncomePerPeriod.map((v, i) => (
                    <td key={i} className={rptTdClass("right", "font-semibold")}>
                      {Math.abs(v) < 0.01 ? "—" : fmt(v)}
                    </td>
                  ))}
                  <td className={rptTdClass("right", "font-bold")}>
                    ₹{fmt(periodData.totalIncome)}
                  </td>
                </tr>

                {sectionHead("Expenses", <ArrowDown size={14} />, periodData.periods.length + 2)}
                {periodData.expenseAccounts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={periodData.periods.length + 2}
                      className="p-4 text-center text-[13px] text-ink-subtle"
                    >
                      No expenses
                    </td>
                  </tr>
                ) : (
                  periodData.expenseAccounts.map((a) => (
                    <tr
                      key={`exp-${a.ledgerId}`}
                      className="sl-row-hover border-b border-line-soft"
                    >
                      <td className={rptTdClass("left", "sticky left-0 bg-card")}>{a.name}</td>
                      {a.perPeriod.map((v, i) => (
                        <td key={i} className={rptTdClass("right")}>
                          {Math.abs(v) < 0.01 ? "—" : fmt(v)}
                        </td>
                      ))}
                      <td className={rptTdClass("right", "font-semibold")}>{fmt(a.total)}</td>
                    </tr>
                  ))
                )}
                <tr className="border-y border-line bg-card-2 font-semibold">
                  <td className={rptTdClass("left", "sticky left-0 bg-card-2 font-semibold")}>
                    Total expenses
                  </td>
                  {periodData.totalExpensePerPeriod.map((v, i) => (
                    <td key={i} className={rptTdClass("right", "font-semibold")}>
                      {Math.abs(v) < 0.01 ? "—" : fmt(v)}
                    </td>
                  ))}
                  <td className={rptTdClass("right", "font-bold")}>
                    ₹{fmt(periodData.totalExpense)}
                  </td>
                </tr>

                {/* Net P&L per period */}
                <tr className="border-t-2 border-line bg-card-2">
                  <td className={rptTdClass("left", "sticky left-0 bg-card-2 font-bold")}>
                    Net profit / (loss)
                  </td>
                  {periodData.netPerPeriod.map((v, i) => (
                    <td key={i} className={rptTdClass("right", `font-semibold ${signTone(v)}`)}>
                      {Math.abs(v) < 0.01 ? "—" : v >= 0 ? fmt(v) : `(${fmt(Math.abs(v))})`}
                    </td>
                  ))}
                  <td
                    className={rptTdClass(
                      "right",
                      `font-bold ${periodData.isProfit ? signTone(1) : signTone(-1)}`
                    )}
                  >
                    {periodData.isProfit
                      ? `₹${fmt(Math.abs(periodData.netProfit))}`
                      : `(₹${fmt(Math.abs(periodData.netProfit))})`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {filteredData && activeConfig.layout !== "monthly" && activeConfig.layout !== "quarterly" && (
        <>
          {activeConfig.layout === "schedule" && data?.scheduleIII ? (
            <ScheduleIIIProfitLoss
              data={data.scheduleIII}
              startDate={startDate}
              endDate={endDate}
              detailed={activeConfig.detailed}
            />
          ) : (
            <section
              aria-label="Profit and loss statement"
              className="sl-tile flex flex-col overflow-hidden"
              style={{ maxHeight: "calc(100vh - 160px)" }}
            >
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr>
                      {activeConfig.detailed && (
                        <th scope="col" className={thClass("left", "w-[110px]")}>
                          Code
                        </th>
                      )}
                      <th scope="col" className={thClass()}>
                        Account
                      </th>
                      {activeConfig.detailed && (
                        <th scope="col" className={thClass()}>
                          Group
                        </th>
                      )}
                      <th scope="col" className={thClass("right", "w-[170px]")}>
                        Amount (₹)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionHead("Revenue / income", <ArrowUp size={14} />, colSpanAll)}
                    {filteredData.incomeAccounts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={colSpanAll}
                          className="p-4 text-center text-[13px] text-ink-subtle"
                        >
                          No income entries
                        </td>
                      </tr>
                    ) : (
                      renderSection(filteredData.incomeAccounts, true)
                    )}
                    <tr className="border-y border-line bg-card-2">
                      <td colSpan={labelSpan} className={rptTdClass("left", "font-semibold")}>
                        Total revenue
                      </td>
                      <td className={rptTdClass("right", "font-bold")}>
                        ₹{fmt(filteredData.totalIncome)}
                      </td>
                    </tr>

                    {sectionHead("Expenses", <ArrowDown size={14} />, colSpanAll)}
                    {filteredData.expenseAccounts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={colSpanAll}
                          className="p-4 text-center text-[13px] text-ink-subtle"
                        >
                          No expense entries
                        </td>
                      </tr>
                    ) : (
                      renderSection(filteredData.expenseAccounts, false)
                    )}
                    <tr className="border-y border-line bg-card-2">
                      <td colSpan={labelSpan} className={rptTdClass("left", "font-semibold")}>
                        Total expenses
                      </td>
                      <td className={rptTdClass("right", "font-bold")}>
                        ₹{fmt(filteredData.totalExpense)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot className="sticky bottom-0 z-[1]">
                    <tr className="border-t-2 border-line bg-card-2">
                      <th
                        scope="row"
                        colSpan={labelSpan}
                        className="px-4 py-3 text-left text-[14px] font-bold text-ink"
                      >
                        {filteredData.isProfit ? "Net Profit" : "Net Loss"}
                        <span className="ml-2 text-[12.5px] font-normal text-ink-subtle">
                          {fmtDate(startDate)} to {fmtDate(endDate)}
                        </span>
                      </th>
                      <td
                        className={`px-4 py-3 text-right text-[15px] font-bold tabular-nums ${filteredData.isProfit ? signTone(1) : signTone(-1)}`}
                      >
                        {filteredData.isProfit
                          ? `₹${fmt(Math.abs(filteredData.netProfit))}`
                          : `(₹${fmt(Math.abs(filteredData.netProfit))})`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default ProfitLossPage;
