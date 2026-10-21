import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FaSync, FaChevronRight } from "react-icons/fa";
import { Landmark, Plus, RefreshCw } from "lucide-react";
import {
  ActionPill,
  LoadError,
  PageHeader,
  StaleNotice,
  StatTile,
} from "../../../../components/ui/v2";
import { fmtINR, fmtINRCompact } from "../../components/accountsUi";
import { toast } from "react-toastify";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import ExportCSVButton from "../../../../components/ui/ExportCSVButton/ExportCSVButton";
import { DATE_RANGE_OPTIONS } from "../../../../constants/selectOption";
import { payableService, type SupplierPayableSummary } from "../../../../services/payableService";
import { supplierService } from "../../../../services/supplierService";
import { useListCache, prefetchCache } from "../../../../hooks/useListCache";
import { usePermission } from "../../../../hooks/usePermission";
import AgeingTable from "../../components/AgeingTable";

type ColumnKey =
  | "index"
  | "code"
  | "supplier"
  | "invoiced"
  | "paid"
  | "debit"
  | "credit"
  | "netBalance"
  | "dueDays"
  | "action";

const ALL_COLUMNS: { id: ColumnKey; label: string; alwaysOn?: boolean }[] = [
  { id: "index", label: "#", alwaysOn: true },
  { id: "code", label: "Code" },
  { id: "supplier", label: "Supplier", alwaysOn: true },
  { id: "invoiced", label: "Invoiced" },
  { id: "paid", label: "Paid" },
  { id: "debit", label: "Debit" },
  { id: "credit", label: "Credit" },
  { id: "netBalance", label: "Net Balance", alwaysOn: true },
  { id: "dueDays", label: "Due Days" },
  { id: "action", label: "Action", alwaysOn: true },
];

export const AmountPayablePage: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();

  // Applied filter state
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [asOnDate, setAsOnDate] = useState<string>(new Date().toISOString().split("T")[0]);
  // P1-10: balances (ledger view) or ageing (unpaid documents by days past due)
  const [view, setView] = useState<"balances" | "ageing">("balances");
  const [supplierId, setSupplierId] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Draft filter state for Apply / Clear All
  const [draftAsOnDate, setDraftAsOnDate] = useState<string>(asOnDate);
  const [draftStartDate, setDraftStartDate] = useState<string>(startDate);
  const [draftEndDate, setDraftEndDate] = useState<string>(endDate);
  const [dateRangePreset, setDateRangePreset] = useState<string>("custom");
  const [draftSupplierId, setDraftSupplierId] = useState<string>(supplierId);
  const [draftSearch, setDraftSearch] = useState<string>(search);

  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  const [suppliersError, setSuppliersError] = useState<string | null>(null);
  const [supplierReloadKey, setSupplierReloadKey] = useState(0);

  // Row selection for status bar
  const [selectedRow, setSelectedRow] = useState<string | number | null>(null);

  // Column visibility (persisted)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem("amountPayableVisibleColumns_v2");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((id: string): id is ColumnKey =>
            ALL_COLUMNS.some((c) => c.id === id)
          );
          if (valid.length > 0) return valid;
        }
      } catch {
        return ALL_COLUMNS.map((c) => c.id);
      }
    }
    return ALL_COLUMNS.map((c) => c.id);
  });
  const [colsMenuOpen, setColsMenuOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("amountPayableVisibleColumns_v2", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const isVisible = (id: ColumnKey) => visibleColumns.includes(id);

  // Load suppliers list for filter dropdown (every page, at the API cap)
  useEffect(() => {
    let cancelled = false;
    const loadSuppliers = async () => {
      try {
        const list = await supplierService.fetchAllSuppliers();
        if (!cancelled) {
          setSuppliersList(list);
          setSuppliersError(null);
        }
      } catch (err) {
        console.error("Failed to load suppliers dropdown", err);
        if (!cancelled) setSuppliersError("Could not load the supplier filter.");
      }
    };
    loadSuppliers();
    return () => {
      cancelled = true;
    };
  }, [supplierReloadKey]);

  const cacheKey = `accounts:amount-payable:${asOnDate}:${startDate}:${endDate}:${supplierId}:${search}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      try {
        const res = await payableService.getPayableSummaries({
          asOnDate,
          startDate,
          endDate,
          supplierId,
          search,
          page: 1,
          limit: 10000,
        });
        const list = Array.isArray(res) ? res : res.data || [];
        return { data: list, total: list.length };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load supplier payables");
        throw err;
      }
    },
    [asOnDate, startDate, endDate, supplierId, search]
  );

  // Prefetch each supplier's breakdown in the background when the list loads.
  const onListSuccess = useCallback((list: SupplierPayableSummary[]) => {
    for (const s of list) {
      const detailKey = `accounts:supplier-breakdown-${s.supplierId}::`;
      prefetchCache(detailKey, async () => {
        const data = await payableService.getSupplierPayableDetail(
          typeof s.supplierId === "string" ? parseInt(s.supplierId, 10) : s.supplierId,
          { startDate: "", endDate: "" }
        );
        return { data: data ? [data] : [], total: data ? 1 : 0 };
      });
    }
  }, []);

  const {
    data: payables,
    loading,
    refreshing,
    refresh,
    error: listError,
  } = useListCache<SupplierPayableSummary>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
    onSuccess: onListSuccess,
  });

  // Date range preset handler
  const handleDateRangeChange = (val: string) => {
    setDateRangePreset(val);
    if (val === "custom") return;

    const today = new Date();
    const start = new Date();
    const end = new Date();

    if (val === "today") {
      // both today
    } else if (val === "yesterday") {
      start.setDate(today.getDate() - 1);
      end.setDate(today.getDate() - 1);
    } else if (val === "last_week") {
      start.setDate(today.getDate() - 7);
    } else if (val === "last_month") {
      start.setMonth(today.getMonth() - 1);
    } else if (val === "last_6_months") {
      start.setMonth(today.getMonth() - 6);
    } else if (val === "last_year") {
      start.setFullYear(today.getFullYear() - 1);
    }

    setDraftStartDate(start.toISOString().split("T")[0]);
    setDraftEndDate(end.toISOString().split("T")[0]);
  };

  const handleApplyFilters = () => {
    setAsOnDate(draftAsOnDate);
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setSupplierId(draftSupplierId);
    setSearch(draftSearch);
  };

  const handleClearFilters = () => {
    const todayStr = new Date().toISOString().split("T")[0];
    setDraftAsOnDate(todayStr);
    setDraftStartDate("");
    setDraftEndDate("");
    setDateRangePreset("custom");
    setDraftSupplierId("");
    setDraftSearch("");

    setAsOnDate(todayStr);
    setStartDate("");
    setEndDate("");
    setSupplierId("");
    setSearch("");
  };

  const [sortBy, setSortBy] = useState<string>("activity");

  const filteredSuppliers = useMemo(() => {
    // Only suppliers with a POSITIVE Cr balance (we owe them) actually count
    // as payable. A supplier with a Dr balance (we paid advance / debit note
    // pending from them) is NOT a payable — it's an asset. Hide them so this
    // page only shows real dues. Supplier `balanceAsOnDate` uses the same
    // sign convention as customer: positive = we owe them (Cr from our side).
    const list = (Array.isArray(payables) ? payables : []).filter(
      (s: any) => Number(s.balanceAsOnDate || 0) > 0.005
    );
    if (sortBy === "activity") {
      list.sort((a: any, b: any) => {
        const aAct = (a.totalBilled || 0) + (a.totalPaid || 0);
        const bAct = (b.totalBilled || 0) + (b.totalPaid || 0);
        if (aAct !== bAct) return bAct - aAct;
        return (b.balanceAsOnDate || 0) - (a.balanceAsOnDate || 0);
      });
    } else if (sortBy === "balance") {
      list.sort((a: any, b: any) => (b.balanceAsOnDate || 0) - (a.balanceAsOnDate || 0));
    } else if (sortBy === "overdue") {
      list.sort((a: any, b: any) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        return (b.overdueAmount || 0) - (a.overdueAmount || 0);
      });
    } else if (sortBy === "name") {
      list.sort((a: any, b: any) => (a.legalName || "").localeCompare(b.legalName || ""));
    }
    return list;
  }, [payables, sortBy]);

  // Dashboard Totals
  const totals = useMemo(() => {
    return filteredSuppliers.reduce(
      (acc, curr) => {
        const d =
          curr.debit !== undefined ? curr.debit : (curr.totalPaid || 0) + (curr.totalReturned || 0);
        const c = curr.credit !== undefined ? curr.credit : curr.totalBilled || 0;
        acc.totalOpening += curr.openingBalance || 0;
        acc.totalBilled += curr.totalBilled || 0;
        acc.totalPaid += curr.totalPaid || 0;
        acc.totalDebit += d;
        acc.totalCredit += c;
        acc.totalNetBalance += curr.balanceAsOnDate || 0;
        if (curr.isOverdue) acc.overdueCount += 1;
        return acc;
      },
      {
        totalOpening: 0,
        totalBilled: 0,
        totalPaid: 0,
        totalDebit: 0,
        totalCredit: 0,
        totalNetBalance: 0,
        overdueCount: 0,
      }
    );
  }, [filteredSuppliers]);

  // CSV Export dataset configuration
  const { csvData, csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Supplier Code", accessor: (item: any) => item.supplierCode },
      { header: "Supplier Name", accessor: (item: any) => item.legalName },
      { header: "GSTIN", accessor: (item: any) => item.gstin || "-" },
      { header: "Phone", accessor: (item: any) => item.phone || "-" },
      { header: "Opening Balance", accessor: (item: any) => item.openingBalance || 0 },
      { header: "Invoiced Amount", accessor: (item: any) => item.totalBilled || 0 },
      { header: "Paid Amount", accessor: (item: any) => item.totalPaid || 0 },
      { header: "Returned Amount", accessor: (item: any) => item.totalReturned || 0 },
      { header: "Debit Amount", accessor: (item: any) => item.debit || 0 },
      { header: "Credit Amount", accessor: (item: any) => item.credit || 0 },
      { header: "Net Balance", accessor: (item: any) => item.balanceAsOnDate || 0 },
      { header: "Overdue Amount", accessor: (item: any) => item.overdueAmount || 0 },
      { header: "Is Overdue", accessor: (item: any) => (item.isOverdue ? "Yes" : "No") },
    ];

    return {
      csvData: filteredSuppliers,
      csvColumns: columns,
      csvFilename: `Amount_Payable_Report_${asOnDate}.csv`,
    };
  }, [filteredSuppliers, asOnDate]);

  const netBal = Number(totals.totalNetBalance || 0);
  return (
    <div className="w-full text-ink">
      <PageHeader
        title="Payables"
        subtitle="What you owe suppliers, with ageing and the MSME clock"
        icon={<Landmark size={20} />}
        primaryAction={
          <ActionPill
            icon={<Plus size={18} />}
            onClick={() => navigate("/accounts/payment-voucher/add")}
          >
            Record Payment
          </ActionPill>
        }
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
              onClick={refresh}
              title="Refresh"
            >
              Refresh
            </ActionPill>
            {(can("payable.export") || can("accounts.export")) && (
              <ExportCSVButton
                data={csvData}
                columns={csvColumns}
                filename={csvFilename}
                text="Export"
              />
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Outstanding payable"
          value={
            Math.abs(netBal) < 0.005 ? (
              "₹0"
            ) : (
              <span title={fmtINR(Math.abs(netBal))}>
                {fmtINRCompact(Math.abs(netBal))}{" "}
                <span className="text-base font-semibold text-ink-subtle">
                  {netBal >= 0 ? "Cr" : "Dr"}
                </span>
              </span>
            )
          }
        />
        <StatTile label="Suppliers" value={filteredSuppliers.length} />
        <StatTile
          label="Overdue"
          value={totals.overdueCount}
          delta={totals.overdueCount > 0 ? "Needs follow-up" : undefined}
          deltaTone="warning"
        />
        <StatTile
          label="Total invoiced"
          value={
            <span title={fmtINR(totals.totalCredit)}>{fmtINRCompact(totals.totalCredit)}</span>
          }
        />
      </div>
      <div className="w-full space-y-4">
        {/* Filter bar */}
        <div className="sl-tile flex flex-wrap items-end gap-3 p-4 sm:p-5">
          <div className="w-full sm:w-[170px]">
            <label className="sl-label">As On</label>
            <DatePickerCalendar
              name="draftAsOnDate"
              value={draftAsOnDate}
              onChange={(e) => setDraftAsOnDate(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[170px]">
            <label className="sl-label">Range</label>
            <SelectInput
              name="dateRangePreset"
              value={dateRangePreset}
              options={DATE_RANGE_OPTIONS}
              hideLabel
              searchable={false}
              onChange={(e) => handleDateRangeChange(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[170px]">
            <label className="sl-label">From</label>
            <DatePickerCalendar
              name="draftStartDate"
              value={draftStartDate}
              onChange={(e) => {
                setDraftStartDate(e.target.value);
                setDateRangePreset("custom");
              }}
            />
          </div>

          <div className="w-full sm:w-[170px]">
            <label className="sl-label">To</label>
            <DatePickerCalendar
              name="draftEndDate"
              value={draftEndDate}
              onChange={(e) => {
                setDraftEndDate(e.target.value);
                setDateRangePreset("custom");
              }}
            />
          </div>

          <div className="w-[180px]">
            <label htmlFor="ap-search" className="sl-label">
              Search
            </label>
            <input
              id="ap-search"
              type="text"
              className="sl-input h-11 w-full text-sm"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Code / Name..."
            />
          </div>

          <div className="w-[150px]">
            <label className="sl-label">Supplier</label>
            <SelectInput
              name="draftSupplierId"
              value={draftSupplierId}
              options={suppliersList.map((s) => ({
                label: s.legalName || s.displayName || s.supplierCode,
                value: s.id,
              }))}
              defaultOptionLabel="All Suppliers"
              hideLabel
              ariaLabel="Supplier"
              searchable
              onChange={(e) => setDraftSupplierId(e.target.value)}
            />
            {suppliersError && (
              <p role="alert" className="mt-1 text-xs text-[color:var(--color-danger)]">
                {suppliersError}{" "}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => setSupplierReloadKey((k) => k + 1)}
                >
                  Retry
                </button>
              </p>
            )}
          </div>

          <button onClick={handleClearFilters} className="sl-btn sl-pill-sm">
            Clear
          </button>
          <button onClick={handleApplyFilters} className="sl-btn-blue sl-pill-sm">
            Apply
          </button>

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={() => setView(view === "ageing" ? "balances" : "ageing")}
              className="sl-chip sl-chip-lg"
              aria-pressed={view === "ageing"}
              title="Unpaid documents by days past due"
            >
              Ageing
            </button>
          </div>
        </div>

        {view === "ageing" && (
          <AgeingTable
            kind="payable"
            asOnDate={asOnDate}
            partyId={supplierId || undefined}
            search={search || undefined}
            onOpenParty={(id) => navigate(`/accounts/payable/${id}`)}
          />
        )}
        {/* Table card — Busy density */}
        <div
          className="sl-tile overflow-hidden flex flex-col"
          style={{ maxHeight: "calc(100vh - 240px)" }}
          hidden={view === "ageing"}
        >
          {/* Table toolbar row */}
          <div className="px-4 py-3 border-b border-line-soft flex items-center justify-between gap-2 shrink-0">
            <h2 className="sl-h2 m-0 text-[15px] flex items-center gap-2">Supplier Payables</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <label className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Sort:
                </label>
                <select
                  aria-label="Sort by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="sl-input h-9 !w-auto text-[13px] cursor-pointer"
                >
                  <option value="activity">Recent Activity</option>
                  <option value="balance">Highest Balance</option>
                  <option value="overdue">Overdue First</option>
                  <option value="name">Name (A-Z)</option>
                </select>
              </div>
              <div className="relative">
                <button onClick={() => setColsMenuOpen((o) => !o)} className="sl-btn sl-pill-sm">
                  Columns ▾
                </button>
                {colsMenuOpen && (
                  <div className="absolute right-0 mt-1 z-20 w-52 sl-tile shadow-lg p-2 space-y-1">
                    {ALL_COLUMNS.map((c) => (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2 px-1.5 py-1 rounded text-[12.5px] ${c.alwaysOn ? "opacity-60 cursor-not-allowed" : "hover:bg-card-2 cursor-pointer"}`}
                      >
                        <input
                          type="checkbox"
                          disabled={c.alwaysOn}
                          checked={isVisible(c.id)}
                          onChange={(e) => {
                            if (c.alwaysOn) return;
                            setVisibleColumns((prev) =>
                              e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                            );
                          }}
                        />
                        <span className="text-ink">{c.label}</span>
                      </label>
                    ))}
                    <div className="pt-1 mt-1 border-t border-line-soft flex justify-end">
                      <button
                        onClick={() => setColsMenuOpen(false)}
                        className="text-[11.5px] text-ink-subtle hover:text-ink px-2 py-0.5"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <span className="text-[12.5px] text-ink-subtle tabular-nums">
                Total: {filteredSuppliers.length}
              </span>
            </div>
          </div>

          {listError && !loading && filteredSuppliers.length > 0 && (
            <StaleNotice onRetry={refresh} className="m-3" />
          )}
          {listError && !loading && payables.length === 0 ? (
            <LoadError compact title="Couldn't load supplier payables" onRetry={refresh} />
          ) : filteredSuppliers.length === 0 ? (
            <div className="p-10 text-center text-sm text-ink-muted flex-1">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <FaSync className="animate-spin text-[color:var(--color-warning)] text-[11.5px]" />
                  Loading supplier payables…
                </span>
              ) : (
                "No supplier payables matching the selected filter criteria."
              )}
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-[12.5px] text-ink-muted border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-card-2 text-ink-muted font-semibold text-[12px] border-b border-line-soft">
                    {isVisible("index") && <th className="px-3 py-2.5 w-10 text-center">#</th>}
                    {isVisible("code") && <th className="px-3 py-2.5 w-24">Code</th>}
                    {isVisible("supplier") && <th className="px-3 py-2.5">Supplier</th>}
                    {isVisible("invoiced") && (
                      <th className="px-3 py-2.5 w-28 text-right">Invoiced</th>
                    )}
                    {isVisible("paid") && <th className="px-3 py-2.5 w-28 text-right">Paid</th>}
                    {isVisible("debit") && <th className="px-3 py-2.5 w-28 text-right">Debit</th>}
                    {isVisible("credit") && <th className="px-3 py-2.5 w-28 text-right">Credit</th>}
                    {isVisible("netBalance") && (
                      <th className="px-3 py-2.5 w-32 text-right">Net Balance</th>
                    )}
                    {isVisible("dueDays") && (
                      <th className="px-3 py-2.5 w-20 text-center">Due Days</th>
                    )}
                    {isVisible("action") && (
                      <th className="px-2 py-1.5 w-20 text-center">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((item: any, rowIdx: number) => {
                    const isSelected = selectedRow === item.supplierId;
                    const bal = Number(item.balanceAsOnDate || 0);
                    const balAbs = Math.abs(bal).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    });
                    return (
                      <tr
                        key={item.supplierId}
                        onClick={() => setSelectedRow(item.supplierId)}
                        className={`border-b border-line-soft cursor-pointer ${
                          isSelected
                            ? "bg-[color:var(--color-warning)]/10 text-ink"
                            : rowIdx % 2 === 0
                              ? "hover:bg-card-2/70"
                              : "bg-card-2/20 hover:bg-card-2/70"
                        }`}
                      >
                        {isVisible("index") && (
                          <td className="px-3 py-2 text-center tabular-nums text-[12.5px] text-ink-subtle">
                            {rowIdx + 1}
                          </td>
                        )}
                        {isVisible("code") && (
                          <td className="px-3 py-2 tabular-nums font-semibold text-[color:var(--color-warning)]">
                            {item.supplierCode || "-"}
                          </td>
                        )}
                        {isVisible("supplier") && (
                          <td className="px-3 py-2">
                            <div className="font-bold text-ink uppercase truncate">
                              {item.legalName}
                            </div>
                            {item.gstin && (
                              <div className="text-[11.5px] text-ink-subtle tabular-nums">
                                GST: {item.gstin}
                              </div>
                            )}
                          </td>
                        )}
                        {isVisible("invoiced") && (
                          <td className="px-3 py-2 text-right tabular-nums">
                            ₹
                            {(item.totalBilled || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        )}
                        {isVisible("paid") && (
                          <td className="px-3 py-2 text-right tabular-nums">
                            ₹
                            {(item.totalPaid || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        )}
                        {isVisible("debit") && (
                          <td className="px-3 py-2 text-right tabular-nums">
                            ₹
                            {(item.debit || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        )}
                        {isVisible("credit") && (
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-[color:var(--color-warning)]">
                            ₹
                            {(item.credit || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        )}
                        {isVisible("netBalance") && (
                          <td className="px-3 py-2 text-right tabular-nums font-bold whitespace-nowrap">
                            {Math.abs(bal) < 0.005 ? (
                              <span className="text-ink">₹0.00</span>
                            ) : bal > 0 ? (
                              <span className="text-ink">
                                ₹{balAbs} <span className="text-[11.5px] text-ink-subtle">Cr</span>
                              </span>
                            ) : (
                              <span className="text-[color:var(--color-success)]">
                                ₹{balAbs}{" "}
                                <span className="text-[11.5px] text-[color:var(--color-success)]">
                                  Dr
                                </span>
                              </span>
                            )}
                          </td>
                        )}
                        {isVisible("dueDays") && (
                          <td className="px-3 py-2 text-center tabular-nums text-[12.5px] text-ink-muted">
                            {item.dueDays !== null && item.dueDays !== undefined
                              ? `${item.dueDays} d`
                              : "—"}
                          </td>
                        )}
                        {isVisible("action") && (
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/accounts/payable/${item.supplierId}`);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-[color:var(--color-warning)]/10 hover:bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)] font-semibold rounded text-[12.5px] border border-[color:var(--color-warning)]/40"
                            >
                              View <FaChevronRight size={8} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Busy-style empty filler rows */}
                  {Array.from({ length: Math.max(0, 25 - filteredSuppliers.length) }).map(
                    (_, i) => (
                      <tr key={`empty-${i}`} className="border-b border-line-soft">
                        {isVisible("index") && <td className="px-3 py-2">&nbsp;</td>}
                        {isVisible("code") && <td className="px-3 py-2"></td>}
                        {isVisible("supplier") && <td className="px-3 py-2"></td>}
                        {isVisible("invoiced") && <td className="px-3 py-2"></td>}
                        {isVisible("paid") && <td className="px-3 py-2"></td>}
                        {isVisible("debit") && <td className="px-3 py-2"></td>}
                        {isVisible("credit") && <td className="px-3 py-2"></td>}
                        {isVisible("netBalance") && <td className="px-3 py-2"></td>}
                        {isVisible("dueDays") && <td className="px-3 py-2"></td>}
                        {isVisible("action") && <td className="px-2 py-1"></td>}
                      </tr>
                    )
                  )}
                </tbody>
                {/* Sticky footer with grand totals */}
                <tfoot className="sticky bottom-0 z-10 bg-card-2 border-t-2 border-line">
                  <tr>
                    <td
                      colSpan={
                        (isVisible("index") ? 1 : 0) +
                        (isVisible("code") ? 1 : 0) +
                        (isVisible("supplier") ? 1 : 0)
                      }
                      className="px-2 py-1.5 text-right text-[11.5px] font-bold text-ink uppercase tracking-wide border-r border-line"
                    >
                      Grand Total ({filteredSuppliers.length})
                    </td>
                    {isVisible("invoiced") && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink border-r border-line">
                        ₹
                        {totals.totalBilled.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    )}
                    {isVisible("paid") && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink border-r border-line">
                        ₹
                        {totals.totalPaid.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    )}
                    {isVisible("debit") && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink border-r border-line">
                        ₹
                        {totals.totalDebit.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    )}
                    {isVisible("credit") && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-[color:var(--color-warning)] border-r border-line">
                        ₹
                        {totals.totalCredit.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    )}
                    {isVisible("netBalance") && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-[color:var(--color-warning)] border-r border-line">
                        ₹
                        {Math.abs(totals.totalNetBalance).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        <span className="text-[11.5px] ml-1">
                          {totals.totalNetBalance >= 0 ? "Cr" : "Dr"}
                        </span>
                      </td>
                    )}
                    {isVisible("dueDays") && <td className="border-r border-line"></td>}
                    {isVisible("action") && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Busy-style status bar */}
          <div className="border-t border-line bg-card-2/60 px-3 py-1 flex items-center justify-between text-[11.5px] tabular-nums text-ink-subtle shrink-0">
            <div className="flex gap-4">
              <span>
                Entry No:{" "}
                <b className="text-ink">
                  {filteredSuppliers.length > 0 ? 1 : 0} / {filteredSuppliers.length}
                </b>
              </span>
              <span>
                Row No:{" "}
                <b className="text-ink">
                  {selectedRow
                    ? filteredSuppliers.findIndex((v: any) => v.supplierId === selectedRow) + 1
                    : filteredSuppliers.length > 0
                      ? 1
                      : 0}
                  {" / "}
                  {filteredSuppliers.length}
                </b>
              </span>
            </div>
            <div className="flex gap-3 uppercase tracking-wide">
              <span>
                Suppliers: <b className="text-ink">{filteredSuppliers.length}</b>
              </span>
              <span>
                Overdue: <b className="text-[color:var(--color-warning)]">{totals.overdueCount}</b>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AmountPayablePage;
