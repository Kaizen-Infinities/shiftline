import React, { useState, useMemo, useCallback } from "react";
import { toCsv } from "./trialBalanceCsv";
import { Download, Printer, RefreshCw, Scale } from "lucide-react";
import apiClient from "../../../../api/apiClient";
import { useDetailCache } from "../../../../hooks/useDetailCache";
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
  thClass,
} from "../../components/accountsUi";

interface TrialBalanceRow {
  ledgerId: number;
  code: string;
  name: string;
  type: string;
  group: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  debitBalance: number;
  creditBalance: number;
}

interface TrialBalanceData {
  rows: TrialBalanceRow[];
  totalDebitBalance: number;
  totalCreditBalance: number;
  isBalanced: boolean;
}

type ReportVariant =
  | "closing-alpha-balances"
  | "closing-alpha-detailed"
  | "closing-grouped-balances"
  | "closing-grouped-detailed"
  | "closing-hierarchical-balances"
  | "closing-hierarchical-detailed"
  | "opening-alpha"
  | "opening-grouped"
  | "opening-hierarchical";

const fmt = (n: number) =>
  n > 0 ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

const fmtSigned = (n: number) =>
  Math.abs(n) < 0.01
    ? ""
    : Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const VARIANT_MAP: Record<
  ReportVariant,
  {
    label: string;
    category: "closing" | "opening";
    layout: "alpha" | "grouped" | "hierarchical";
    detailed: boolean;
  }
> = {
  "closing-alpha-balances": {
    label: "Alphabetical · Balances",
    category: "closing",
    layout: "alpha",
    detailed: false,
  },
  "closing-alpha-detailed": {
    label: "Alphabetical · Detailed",
    category: "closing",
    layout: "alpha",
    detailed: true,
  },
  "closing-grouped-balances": {
    label: "Grouped · Balances",
    category: "closing",
    layout: "grouped",
    detailed: false,
  },
  "closing-grouped-detailed": {
    label: "Grouped · Detailed",
    category: "closing",
    layout: "grouped",
    detailed: true,
  },
  "closing-hierarchical-balances": {
    label: "Hierarchical · Balances",
    category: "closing",
    layout: "hierarchical",
    detailed: false,
  },
  "closing-hierarchical-detailed": {
    label: "Hierarchical · Detailed",
    category: "closing",
    layout: "hierarchical",
    detailed: true,
  },
  "opening-alpha": { label: "Alphabetical", category: "opening", layout: "alpha", detailed: false },
  "opening-grouped": { label: "Grouped", category: "opening", layout: "grouped", detailed: false },
  "opening-hierarchical": {
    label: "Hierarchical",
    category: "opening",
    layout: "hierarchical",
    detailed: false,
  },
};

const getFYStartDate = () => {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 3, 1).toISOString().split("T")[0];
};

export const TrialBalancePage: React.FC = () => {
  const today = new Date().toISOString().split("T")[0];
  const [asOnDate, setAsOnDate] = useState<string>(today);
  const [showZeroBalance, setShowZeroBalance] = useState<boolean>(false);
  const [variant, setVariant] = useState<ReportVariant>("closing-grouped-balances");
  const activeConfig = VARIANT_MAP[variant];

  const dateParam = activeConfig.category === "opening" ? getFYStartDate() : asOnDate;
  const groupByCategoryParam = activeConfig.layout !== "alpha";
  const cacheKey = `accounts:trial-balance:${dateParam}:${showZeroBalance}:${groupByCategoryParam}`;

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<TrialBalanceData> => {
      const params = new URLSearchParams({
        asOnDate: dateParam,
        showZeroBalance: String(showZeroBalance),
        sortBy: "name",
        groupByCategory: String(groupByCategoryParam),
      });
      const res = await apiClient.get(`/accounts/trial-balance?${params.toString()}`, { signal });
      return res.data.data as TrialBalanceData;
    },
    [dateParam, showZeroBalance, groupByCategoryParam]
  );

  const { data, loading, refreshing, refresh } = useDetailCache<TrialBalanceData>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
  });

  const handleVariantClick = (v: ReportVariant) => setVariant(v);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (!showZeroBalance)
      rows = rows.filter(
        (r) => r.debitBalance > 0 || r.creditBalance > 0 || Math.abs(r.openingBalance) > 0.01
      );
    rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [data, showZeroBalance]);

  const grouped = useMemo(() => {
    if (activeConfig.layout === "alpha") return null;
    const buckets: Record<string, TrialBalanceRow[]> = {};
    for (const r of filteredRows) {
      const g = r.group || "Others";
      if (!buckets[g]) buckets[g] = [];
      buckets[g].push(r);
    }
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows, activeConfig.layout]);

  const totals = useMemo(() => {
    const dr = filteredRows.reduce((s, r) => s + r.debitBalance, 0);
    const cr = filteredRows.reduce((s, r) => s + r.creditBalance, 0);
    return { dr, cr, isBalanced: Math.abs(dr - cr) < 0.01 };
  }, [filteredRows]);

  const handlePrint = () => window.print();

  const exportCSV = () => {
    if (!data) return;
    const cols = activeConfig.detailed
      ? [
          "Account/Group",
          "Group",
          "Opening Dr",
          "Opening Cr",
          "Debit",
          "Credit",
          "Closing Dr",
          "Closing Cr",
        ]
      : ["Account/Group", "Debit Bal.", "Credit Bal."];
    const rowsArr: (string | number)[][] = [cols];
    filteredRows.forEach((r) => {
      if (activeConfig.detailed) {
        const opDr = r.openingBalance > 0 ? r.openingBalance : 0;
        const opCr = r.openingBalance < 0 ? -r.openingBalance : 0;
        rowsArr.push([
          r.name,
          r.group,
          opDr,
          opCr,
          r.totalDebit,
          r.totalCredit,
          r.debitBalance,
          r.creditBalance,
        ]);
      } else {
        rowsArr.push([r.name, r.debitBalance, r.creditBalance]);
      }
    });
    const csv = toCsv(rowsArr);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${variant}-${asOnDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Chip pickers compose the Busy report variant: trial × layout × (balances | detailed).
  const pickVariant = (
    category: "closing" | "opening",
    layout: "alpha" | "grouped" | "hierarchical",
    detailed: boolean
  ) =>
    handleVariantClick(
      (category === "opening"
        ? `opening-${layout}`
        : `closing-${layout}-${detailed ? "detailed" : "balances"}`) as ReportVariant
    );

  const colCount = activeConfig.detailed ? 7 : 3;
  const effectiveDate = activeConfig.category === "opening" ? getFYStartDate() : asOnDate;
  const diff = Math.abs(totals.dr - totals.cr);

  const numCells = (r: {
    opDr: number;
    opCr: number;
    debit: number;
    credit: number;
    dr: number;
    cr: number;
    strong?: boolean;
  }) => (
    <>
      {activeConfig.detailed && (
        <>
          <td className={rptTdClass("right", "text-ink-muted")}>{fmtSigned(r.opDr) || "—"}</td>
          <td className={rptTdClass("right", "text-ink-muted")}>{fmtSigned(r.opCr) || "—"}</td>
          <td className={rptTdClass("right")}>{fmtSigned(r.debit) || "—"}</td>
          <td className={rptTdClass("right")}>{fmtSigned(r.credit) || "—"}</td>
        </>
      )}
      <td className={rptTdClass("right", r.strong ? "font-semibold" : "")}>{fmt(r.dr) || "—"}</td>
      <td className={rptTdClass("right", r.strong ? "font-semibold" : "")}>{fmt(r.cr) || "—"}</td>
    </>
  );

  const ledgerRow = (row: TrialBalanceRow, indent: boolean) => (
    <tr key={row.ledgerId} className="sl-row-hover border-b border-line-soft">
      <td className={rptTdClass("left", indent ? "pl-9" : "")}>{row.name}</td>
      {numCells({
        opDr: row.openingBalance > 0 ? row.openingBalance : 0,
        opCr: row.openingBalance < 0 ? -row.openingBalance : 0,
        debit: row.totalDebit,
        credit: row.totalCredit,
        dr: row.debitBalance,
        cr: row.creditBalance,
      })}
    </tr>
  );

  return (
    <div className="sl-page">
      <PageHeader
        title="Trial balance"
        subtitle={`${activeConfig.category === "opening" ? "Opening Trial" : "Closing Trial"} · ${activeConfig.label} · as on ${fmtDate(effectiveDate)}`}
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
        <FilterGroup label="Trial">
          <div role="group" aria-label="Trial" className="flex flex-wrap gap-2">
            <Chip
              size="lg"
              selected={activeConfig.category === "closing"}
              onClick={() => pickVariant("closing", activeConfig.layout, activeConfig.detailed)}
            >
              Closing
            </Chip>
            <Chip
              size="lg"
              selected={activeConfig.category === "opening"}
              onClick={() => pickVariant("opening", activeConfig.layout, false)}
            >
              Opening
            </Chip>
          </div>
        </FilterGroup>
        <FilterGroup label="Layout">
          <div role="group" aria-label="Layout" className="flex flex-wrap gap-2">
            {(
              [
                ["alpha", "Alphabetical"],
                ["grouped", "Grouped"],
                ["hierarchical", "Hierarchical"],
              ] as const
            ).map(([key, label]) => (
              <Chip
                key={key}
                size="lg"
                selected={activeConfig.layout === key}
                onClick={() => pickVariant(activeConfig.category, key, activeConfig.detailed)}
              >
                {label}
              </Chip>
            ))}
          </div>
        </FilterGroup>
        {activeConfig.category === "closing" && (
          <FilterGroup label="Columns">
            <div role="group" aria-label="Columns" className="flex flex-wrap gap-2">
              <Chip
                size="lg"
                selected={!activeConfig.detailed}
                onClick={() => pickVariant("closing", activeConfig.layout, false)}
              >
                Balances
              </Chip>
              <Chip
                size="lg"
                selected={activeConfig.detailed}
                onClick={() => pickVariant("closing", activeConfig.layout, true)}
              >
                Detailed
              </Chip>
            </div>
          </FilterGroup>
        )}
        <FilterGroup
          label={activeConfig.category === "opening" ? "Fin. year start" : "As on date"}
          htmlFor="tb-date"
        >
          <input
            id="tb-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setAsOnDate(e.target.value)}
            disabled={activeConfig.category === "opening"}
            className="sl-input h-11 w-full text-sm lg:w-[170px]"
          />
        </FilterGroup>
        <label className="flex h-11 items-center gap-2 text-sm text-ink-muted lg:ml-auto">
          <input
            type="checkbox"
            className="sl-check"
            checked={showZeroBalance}
            onChange={(e) => setShowZeroBalance(e.target.checked)}
          />
          Show zero balance
        </label>
      </ReportFilterBar>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Total debit"
          value={<span title={fmtINR(totals.dr)}>{fmtINRCompact(totals.dr)}</span>}
          loading={loading && !data}
        />
        <StatTile
          label="Total credit"
          value={<span title={fmtINR(totals.cr)}>{fmtINRCompact(totals.cr)}</span>}
          loading={loading && !data}
        />
        <StatTile
          label="Status"
          value={totals.isBalanced ? "Balanced" : fmtINRCompact(diff)}
          delta={totals.isBalanced ? "Dr = Cr" : "Difference"}
          deltaTone={totals.isBalanced ? "success" : "danger"}
          loading={loading && !data}
        />
        <StatTile label="Accounts" value={filteredRows.length} loading={loading && !data} />
      </div>

      {!data && loading && (
        <div className="sl-tile overflow-hidden">
          <SkeletonRows rows={8} columns={3} rowHeight={40} label="Loading trial balance" />
        </div>
      )}

      {!data && !loading && (
        <div className="sl-tile">
          <EmptyState
            icon={<Scale size={28} />}
            title="No data for the selected variant"
            description={`Selected: ${activeConfig.label}`}
          />
        </div>
      )}

      {data && (
        <section
          aria-label="Trial balance"
          className="sl-tile flex flex-col overflow-hidden"
          style={{ maxHeight: "calc(100vh - 160px)" }}
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className={thClass()}>
                    Account / group
                  </th>
                  {activeConfig.detailed && (
                    <>
                      <th scope="col" className={thClass("right", "w-[120px]")}>
                        Opening Dr
                      </th>
                      <th scope="col" className={thClass("right", "w-[120px]")}>
                        Opening Cr
                      </th>
                      <th scope="col" className={thClass("right", "w-[120px]")}>
                        Debit
                      </th>
                      <th scope="col" className={thClass("right", "w-[120px]")}>
                        Credit
                      </th>
                    </>
                  )}
                  <th scope="col" className={thClass("right", "w-[150px]")}>
                    Closing Dr (₹)
                  </th>
                  <th scope="col" className={thClass("right", "w-[150px]")}>
                    Closing Cr (₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount}>
                      <EmptyState compact title="No entries found." />
                    </td>
                  </tr>
                ) : activeConfig.layout !== "alpha" && grouped ? (
                  grouped.map(([gname, gitems]) => {
                    const gd = gitems.reduce((s, i) => s + i.debitBalance, 0);
                    const gc = gitems.reduce((s, i) => s + i.creditBalance, 0);
                    const gOpDr = gitems.reduce(
                      (s, i) => s + (i.openingBalance > 0 ? i.openingBalance : 0),
                      0
                    );
                    const gOpCr = gitems.reduce(
                      (s, i) => s + (i.openingBalance < 0 ? -i.openingBalance : 0),
                      0
                    );
                    const gDebit = gitems.reduce((s, i) => s + i.totalDebit, 0);
                    const gCredit = gitems.reduce((s, i) => s + i.totalCredit, 0);
                    return (
                      <React.Fragment key={gname}>
                        <tr className={rptGroupRowClass}>
                          <th
                            scope="rowgroup"
                            colSpan={colCount}
                            className="px-4 py-2 text-left text-[13px] font-semibold text-ink"
                          >
                            {gname}
                          </th>
                        </tr>
                        {gitems.map((row) => ledgerRow(row, true))}
                        <tr className="border-b border-line">
                          <td className={rptTdClass("left", "pl-9 font-semibold text-ink-muted")}>
                            Total {gname}
                          </td>
                          {numCells({
                            opDr: gOpDr,
                            opCr: gOpCr,
                            debit: gDebit,
                            credit: gCredit,
                            dr: gd,
                            cr: gc,
                            strong: true,
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })
                ) : (
                  filteredRows.map((row) => ledgerRow(row, false))
                )}
              </tbody>
              <tfoot className="sticky bottom-0 z-[1]">
                <tr className="border-t-2 border-line bg-card-2">
                  <th scope="row" className="px-4 py-3 text-left text-[14px] font-bold text-ink">
                    Grand total
                  </th>
                  {activeConfig.detailed && (
                    <>
                      <td className={rptTdClass("right", "text-ink-muted")}>
                        {fmtSigned(
                          filteredRows.reduce(
                            (s, r) => s + (r.openingBalance > 0 ? r.openingBalance : 0),
                            0
                          )
                        ) || "—"}
                      </td>
                      <td className={rptTdClass("right", "text-ink-muted")}>
                        {fmtSigned(
                          filteredRows.reduce(
                            (s, r) => s + (r.openingBalance < 0 ? -r.openingBalance : 0),
                            0
                          )
                        ) || "—"}
                      </td>
                      <td className={rptTdClass("right")}>
                        {fmtSigned(filteredRows.reduce((s, r) => s + r.totalDebit, 0)) || "—"}
                      </td>
                      <td className={rptTdClass("right")}>
                        {fmtSigned(filteredRows.reduce((s, r) => s + r.totalCredit, 0)) || "—"}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums text-ink">
                    {fmtINR(totals.dr)}
                  </td>
                  <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums text-ink">
                    {fmtINR(totals.cr)}
                  </td>
                </tr>
                <tr className="bg-card-2">
                  <td colSpan={colCount} className="px-4 pb-3">
                    {totals.isBalanced ? (
                      <Chip tone="success" dot>
                        Trial Balance is balanced (Dr = Cr)
                      </Chip>
                    ) : (
                      <Chip tone="danger" dot>
                        Not balanced · Difference: {fmtINR(diff)}
                      </Chip>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default TrialBalancePage;
