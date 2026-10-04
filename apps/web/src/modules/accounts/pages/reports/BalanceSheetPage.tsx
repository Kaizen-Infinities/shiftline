import React, { useState, useMemo, useCallback } from "react";
import { Download, Printer, RefreshCw, Scale } from "lucide-react";
import apiClient from "../../../../api/apiClient";
import { useDetailCache } from "../../../../hooks/useDetailCache";
import {
  ScheduleIIIBalanceSheet,
  type BalanceSheetScheduleIII,
} from "../../components/ScheduleIII";
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
} from "../../components/accountsUi";

interface BSItem {
  code: string;
  name: string;
  group: string;
  balance: number;
}

interface BalanceSheetData {
  assets: BSItem[];
  liabilities: BSItem[];
  equity: BSItem[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  scheduleIII?: BalanceSheetScheduleIII;
}

type BSVariant =
  | "horizontal-summary"
  | "horizontal-detailed"
  | "vertical-summary"
  | "vertical-detailed"
  | "grouped-hierarchical"
  | "flat-alphabetical"
  | "schedule-iii-summary"
  | "schedule-iii-detailed";

const VARIANT_MAP: Record<
  BSVariant,
  {
    label: string;
    layout: "horizontal" | "vertical" | "hierarchical" | "flat" | "schedule";
    detailed: boolean;
  }
> = {
  "horizontal-summary": { label: "Horizontal · Summary", layout: "horizontal", detailed: false },
  "horizontal-detailed": { label: "Horizontal · Detailed", layout: "horizontal", detailed: true },
  "vertical-summary": { label: "Vertical · Summary", layout: "vertical", detailed: false },
  "vertical-detailed": { label: "Vertical · Detailed", layout: "vertical", detailed: true },
  "grouped-hierarchical": {
    label: "Hierarchical · Grouped",
    layout: "hierarchical",
    detailed: true,
  },
  "flat-alphabetical": { label: "Flat · Alphabetical", layout: "flat", detailed: true },
  "schedule-iii-summary": { label: "Schedule III · Summary", layout: "schedule", detailed: false },
  "schedule-iii-detailed": { label: "Schedule III · Detailed", layout: "schedule", detailed: true },
};

const fmt = (n: number) =>
  Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BalanceSheetPage: React.FC = () => {
  const today = new Date().toISOString().split("T")[0];
  const [asOnDate, setAsOnDate] = useState<string>(today);
  const [showZeroBalance, setShowZeroBalance] = useState<boolean>(false);
  const [variant, setVariant] = useState<BSVariant>("horizontal-summary");
  const activeConfig = VARIANT_MAP[variant];

  const groupByCategoryParam = activeConfig.layout !== "flat";
  const cacheKey = `accounts:balance-sheet:${asOnDate}:${showZeroBalance}:${groupByCategoryParam}`;

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<BalanceSheetData> => {
      const params = new URLSearchParams({
        ...(asOnDate ? { asOnDate } : {}),
        showZeroBalance: String(showZeroBalance),
        groupByCategory: String(groupByCategoryParam),
      });
      const res = await apiClient.get(`/accounts/balance-sheet?${params.toString()}`, { signal });
      return res.data.data as BalanceSheetData;
    },
    [asOnDate, showZeroBalance, groupByCategoryParam]
  );

  const { data, loading, refreshing, refresh } = useDetailCache<BalanceSheetData>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
  });

  const handleVariantClick = (v: BSVariant) => setVariant(v);

  const filterItems = (items: BSItem[]) =>
    showZeroBalance ? items : items.filter((i) => Math.abs(i.balance) > 0.01);

  const view = useMemo(() => {
    if (!data) return null;
    const assets = filterItems(data.assets);
    const liabilities = filterItems(data.liabilities);
    const equity = filterItems(data.equity);
    const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
    const totalEquity = equity.reduce((s, e) => s + e.balance, 0);
    return {
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
  }, [data, showZeroBalance]);

  const groupItems = (items: BSItem[]): Record<string, BSItem[]> => {
    const buckets: Record<string, BSItem[]> = {};
    items.forEach((it) => {
      const g = it.group || "Others";
      if (!buckets[g]) buckets[g] = [];
      buckets[g].push(it);
    });
    return buckets;
  };

  const handlePrint = () => window.print();

  const exportCSV = () => {
    if (!view) return;
    const lines: string[][] = [];
    lines.push(["Balance Sheet - " + activeConfig.label]);
    lines.push(["As on:", asOnDate]);
    lines.push([]);
    ["Assets", "Liabilities", "Equity"].forEach((section) => {
      const items =
        section === "Assets"
          ? view.assets
          : section === "Liabilities"
            ? view.liabilities
            : view.equity;
      const total =
        section === "Assets"
          ? view.totalAssets
          : section === "Liabilities"
            ? view.totalLiabilities
            : view.totalEquity;
      lines.push([section.toUpperCase()]);
      lines.push(["Name", "Group", "Amount"]);
      items.forEach((it) => lines.push([it.name, it.group, it.balance.toFixed(2)]));
      lines.push(["", `Total ${section}`, total.toFixed(2)]);
      lines.push([]);
    });
    lines.push(["", "Total Liabilities + Equity", view.totalLiabilitiesAndEquity.toFixed(2)]);
    const csv = lines.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-sheet-${variant}-${asOnDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderSectionTable = (
    title: string,
    items: BSItem[],
    total: number,
    accentColor: string
  ) => {
    if (activeConfig.detailed) {
      const groups = groupItems(items);
      return (
        <div className="sl-tile overflow-hidden">
          <div className={`px-4 py-3 border-b border-line-soft flex items-center justify-between`}>
            <h3 className={`sl-h2 m-0 text-[15px] ${accentColor}`}>{title}</h3>
            <span className={`text-[15px] tabular-nums font-bold ${accentColor}`}>
              ₹{fmt(total)}
            </span>
          </div>
          {items.length === 0 ? (
            <div className="p-6 text-center text-[13.5px] text-ink-subtle">No entries</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-card-2">
                <tr>
                  <th className="px-4 py-2.5 text-[12px] font-semibold text-ink-muted">Account</th>
                  <th className="px-4 py-2.5 text-[12px] font-semibold text-ink-muted text-right w-[140px]">
                    Amount (₹)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {Object.entries(groups)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([gname, gitems]) => {
                    const gtotal = gitems.reduce((s, i) => s + i.balance, 0);
                    // Profit & Loss row: green if profit (positive), red if loss (negative)
                    const isPnlGroup = /profit.*loss|net profit/i.test(gname);
                    const gtotalClass = isPnlGroup
                      ? gtotal >= 0
                        ? "text-[color:var(--color-success)]"
                        : "text-[color:var(--color-danger)]"
                      : "text-ink";
                    return (
                      <React.Fragment key={gname}>
                        {activeConfig.layout === "hierarchical" && (
                          <tr className="bg-card-2">
                            <td
                              className={`px-4 py-2 text-[13px] font-semibold ${isPnlGroup ? gtotalClass : "text-ink"}`}
                            >
                              {gname}
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-[13px] tabular-nums font-bold ${gtotalClass}`}
                            >
                              {isPnlGroup && gtotal < 0 ? "-" : ""}₹{fmt(Math.abs(gtotal))}
                            </td>
                          </tr>
                        )}
                        {gitems.map((it) => {
                          const isPnlItem =
                            /net profit|profit.*loss/i.test(it.name || "") || it.code === "NET-PNL";
                          const itClass = isPnlItem
                            ? it.balance >= 0
                              ? "text-[color:var(--color-success)]"
                              : "text-[color:var(--color-danger)]"
                            : "text-ink";
                          return (
                            <tr key={it.code} className="sl-row-hover">
                              <td
                                className={`py-2 text-[13.5px] ${itClass} ${activeConfig.layout === "hierarchical" ? "pl-6 pr-3" : "px-4"}`}
                              >
                                {isPnlItem
                                  ? it.balance >= 0
                                    ? "Net Profit"
                                    : "Net Loss"
                                  : it.name}
                              </td>
                              <td
                                className={`px-4 py-2 text-right text-[13.5px] tabular-nums ${itClass}`}
                              >
                                {isPnlItem && it.balance < 0 ? "-" : ""}₹{fmt(Math.abs(it.balance))}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
              </tbody>
              <tfoot>
                <tr className="bg-card-2 border-t-2 border-line font-bold">
                  <td className="px-4 py-2.5 text-[13.5px] text-ink">Total {title}</td>
                  <td className={`px-4 py-2.5 text-right text-sm tabular-nums ${accentColor}`}>
                    ₹{fmt(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      );
    }

    // Summary mode — only show group totals (not individual accounts)
    const groups = groupItems(items);
    return (
      <div className="sl-tile overflow-hidden">
        <div className="px-4 py-3 border-b border-line-soft flex items-center justify-between">
          <h3 className={`sl-h2 m-0 text-[15px] ${accentColor}`}>{title}</h3>
          <span className={`text-[15px] tabular-nums font-bold ${accentColor}`}>₹{fmt(total)}</span>
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-center text-[13.5px] text-ink-subtle">No entries</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <tbody className="divide-y divide-line-soft">
              {Object.entries(groups)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([gname, gitems]) => {
                  const gtotal = gitems.reduce((s, i) => s + i.balance, 0);
                  // Profit & Loss row: green if profit, red if loss
                  const isPnl = /profit.*loss|net profit/i.test(gname);
                  const cls = isPnl
                    ? gtotal >= 0
                      ? "text-[color:var(--color-success)] font-bold"
                      : "text-[color:var(--color-danger)] font-bold"
                    : "text-ink";
                  const label = isPnl
                    ? gtotal >= 0
                      ? "Profit & Loss (Net Profit)"
                      : "Profit & Loss (Net Loss)"
                    : gname;
                  return (
                    <tr key={gname} className="sl-row-hover">
                      <td className={`px-4 py-2.5 text-[13.5px] font-semibold ${cls}`}>{label}</td>
                      <td className={`px-4 py-2.5 text-right text-[13.5px] tabular-nums ${cls}`}>
                        {isPnl && gtotal < 0 ? "-" : ""}₹{fmt(Math.abs(gtotal))}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            <tfoot>
              <tr className="bg-card-2 border-t-2 border-line font-bold">
                <td className="px-4 py-2.5 text-[13.5px] text-ink">Total {title}</td>
                <td className={`px-4 py-2.5 text-right text-sm tabular-nums ${accentColor}`}>
                  ₹{fmt(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    );
  };

  const renderFlatAlphabetical = (v: NonNullable<typeof view>) => {
    const all = [
      ...v.assets.map((i) => ({ ...i, section: "Asset" })),
      ...v.liabilities.map((i) => ({ ...i, section: "Liability" })),
      ...v.equity.map((i) => ({ ...i, section: "Equity" })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div
        className="sl-tile overflow-hidden flex flex-col"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        <div className="px-4 py-2.5 border-b border-line bg-card-2/50 text-[13px] shrink-0 flex items-center justify-between">
          <span className="text-ink-subtle">Flat alphabetical view · {all.length} accounts</span>
        </div>
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2.5 bg-card-2 text-[12px] font-semibold text-ink-muted border-b border-line-soft">
                  Account
                </th>
                <th className="px-4 py-2.5 bg-card-2 text-[12px] font-semibold text-ink-muted border-b border-line-soft">
                  Section
                </th>
                <th className="px-4 py-2.5 bg-card-2 text-[12px] font-semibold text-ink-muted border-b border-line-soft">
                  Group
                </th>
                <th className="px-4 py-2.5 bg-card-2 text-[12px] font-semibold text-ink-muted border-b border-line-soft text-right w-[140px]">
                  Amount (₹)
                </th>
              </tr>
            </thead>
            <tbody>
              {all.map((it) => {
                const isPnl =
                  /net profit|profit.*loss/i.test(it.name || "") || it.code === "NET-PNL";
                const cls = isPnl
                  ? it.balance >= 0
                    ? "text-[color:var(--color-success)] font-bold"
                    : "text-[color:var(--color-danger)] font-bold"
                  : "text-ink";
                return (
                  <tr
                    key={`${it.section}-${it.code}`}
                    className="sl-row-hover border-b border-line-soft"
                  >
                    <td className={`px-4 py-2 text-[13.5px] ${cls}`}>
                      {isPnl ? (it.balance >= 0 ? "Net Profit" : "Net Loss") : it.name}
                    </td>
                    <td className="px-4 py-2 text-[13px]">
                      <span className="sl-chip sl-chip-sm">{it.section}</span>
                    </td>
                    <td className="px-4 py-2 text-[13px] text-ink-muted">{it.group}</td>
                    <td className={`px-4 py-2 text-right text-[13.5px] tabular-nums ${cls}`}>
                      {isPnl && it.balance < 0 ? "-" : ""}₹{fmt(Math.abs(it.balance))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const diff = view ? Math.abs(view.totalAssets - view.totalLiabilitiesAndEquity) : 0;
  const totalLE = view ? (
    <div className="sl-tile flex items-center justify-between px-4 py-3">
      <span className="text-[14px] font-bold text-ink">Total Liabilities + Equity</span>
      <span className="text-[15px] font-bold tabular-nums text-ink">
        ₹{fmt(view.totalLiabilitiesAndEquity)}
      </span>
    </div>
  ) : null;

  return (
    <div className="sl-page">
      <PageHeader
        title="Balance sheet"
        subtitle={`${activeConfig.label} · as on ${fmtDate(asOnDate)}`}
        icon={<Scale size={20} />}
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<Printer size={16} />}
              onClick={handlePrint}
              disabled={!data}
            >
              Print
            </ActionPill>
            <ActionPill
              variant="secondary"
              icon={<Download size={16} />}
              onClick={exportCSV}
              disabled={!data}
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
        <FilterGroup label="As on date" htmlFor="bs-date">
          <input
            id="bs-date"
            type="date"
            value={asOnDate}
            onChange={(e) => setAsOnDate(e.target.value)}
            className="sl-input h-11 w-full text-sm lg:w-[170px]"
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
            {(Object.keys(VARIANT_MAP) as BSVariant[]).map((v) => (
              <Chip key={v} selected={variant === v} onClick={() => handleVariantClick(v)}>
                {VARIANT_MAP[v].label}
              </Chip>
            ))}
          </div>
        </FilterGroup>
      </ReportFilterBar>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Total assets"
          value={
            <span title={view ? fmtINR(view.totalAssets) : undefined}>
              {fmtINRCompact(view?.totalAssets ?? 0)}
            </span>
          }
          loading={loading && !view}
        />
        <StatTile
          label="Total liabilities"
          value={
            <span title={view ? fmtINR(view.totalLiabilities) : undefined}>
              {fmtINRCompact(view?.totalLiabilities ?? 0)}
            </span>
          }
          loading={loading && !view}
        />
        <StatTile
          label="Total equity"
          value={
            <span title={view ? fmtINR(view.totalEquity) : undefined}>
              {fmtINRCompact(view?.totalEquity ?? 0)}
            </span>
          }
          loading={loading && !view}
        />
        <StatTile
          label="Balance check"
          value={view && !view.isBalanced ? fmtINRCompact(diff) : "Balanced"}
          delta={view ? (view.isBalanced ? "A = L + E" : "Difference") : undefined}
          deltaTone={view && !view.isBalanced ? "danger" : "success"}
          loading={loading && !view}
        />
      </div>

      {!view && loading && (
        <div className="sl-tile overflow-hidden">
          <SkeletonRows rows={8} columns={2} rowHeight={40} label="Loading balance sheet" />
        </div>
      )}

      {!view && !loading && (
        <div className="sl-tile">
          <EmptyState
            icon={<Scale size={28} />}
            title="No data for the selected variant"
            description={`Selected: ${activeConfig.label}`}
          />
        </div>
      )}

      {view && (
        <div className="flex flex-col gap-4">
          {activeConfig.layout === "schedule" && data?.scheduleIII ? (
            <ScheduleIIIBalanceSheet
              data={data.scheduleIII}
              asOnDate={asOnDate}
              detailed={activeConfig.detailed}
            />
          ) : activeConfig.layout === "flat" ? (
            renderFlatAlphabetical(view)
          ) : activeConfig.layout === "vertical" ? (
            <div className="flex flex-col gap-4">
              {renderSectionTable("Assets", view.assets, view.totalAssets, "text-ink")}
              {renderSectionTable(
                "Liabilities",
                view.liabilities,
                view.totalLiabilities,
                "text-ink"
              )}
              {renderSectionTable("Equity", view.equity, view.totalEquity, "text-ink")}
              {totalLE}
            </div>
          ) : (
            // horizontal or hierarchical
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                {renderSectionTable("Assets", view.assets, view.totalAssets, "text-ink")}
              </div>
              <div className="flex flex-col gap-4">
                {renderSectionTable(
                  "Liabilities",
                  view.liabilities,
                  view.totalLiabilities,
                  "text-ink"
                )}
                {renderSectionTable("Equity", view.equity, view.totalEquity, "text-ink")}
                {totalLE}
              </div>
            </div>
          )}

          <div className="sl-tile flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-[14px] font-semibold text-ink">Balance check</span>
            {view.isBalanced ? (
              <Chip tone="success" dot>
                Balanced — Assets = Liabilities + Equity (₹{fmt(view.totalAssets)})
              </Chip>
            ) : (
              <Chip tone="danger" dot>
                Not balanced · Diff: ₹{fmt(diff)}
              </Chip>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BalanceSheetPage;
