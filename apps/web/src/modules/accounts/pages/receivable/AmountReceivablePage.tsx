import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FaSync, FaChevronRight } from "react-icons/fa";
import { HandCoins, Plus, RefreshCw } from "lucide-react";
import {
  ActionPill,
  LoadError,
  PageHeader,
  StaleNotice,
  StatTile,
} from "../../../../components/ui/v2";
import { fmtDrCr, fmtINR, fmtINRCompact } from "../../components/accountsUi";
import { toast } from "react-toastify";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import ExportCSVButton from "../../../../components/ui/ExportCSVButton/ExportCSVButton";
import { DATE_RANGE_OPTIONS } from "../../../../constants/selectOption";
import {
  receivableService,
  type CustomerReceivableSummary,
} from "../../../../services/receivableService";
import { customerService } from "../../../../services/customerService";
import { useListCache, prefetchCache } from "../../../../hooks/useListCache";
import { usePermission } from "../../../../hooks/usePermission";
import AgeingTable from "../../components/AgeingTable";

type ColumnKey =
  | "index"
  | "code"
  | "customer"
  | "invoiced"
  | "paid"
  | "debit"
  | "credit"
  | "netBalance"
  | "action";

const ALL_COLUMNS: { id: ColumnKey; label: string; alwaysOn?: boolean }[] = [
  { id: "index", label: "#", alwaysOn: true },
  { id: "code", label: "Code" },
  { id: "customer", label: "Customer", alwaysOn: true },
  { id: "invoiced", label: "Invoiced" },
  { id: "paid", label: "Paid" },
  { id: "debit", label: "Debit" },
  { id: "credit", label: "Credit" },
  { id: "netBalance", label: "Net Balance", alwaysOn: true },
  { id: "action", label: "Action", alwaysOn: true },
];

export const AmountReceivablePage: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();

  // Applied filter state
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [asOnDate, setAsOnDate] = useState<string>(new Date().toISOString().split("T")[0]);
  // P1-10: balances (ledger view) or ageing (unpaid documents by days past due)
  const [view, setView] = useState<"balances" | "ageing">("balances");
  const [customerId, setCustomerId] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Draft filter state for Apply / Clear All
  const [draftStartDate, setDraftStartDate] = useState<string>(startDate);
  const [draftEndDate, setDraftEndDate] = useState<string>(endDate);
  const [dateRangePreset, setDateRangePreset] = useState<string>("custom");
  const [draftCustomerId, setDraftCustomerId] = useState<string>(customerId);
  const [draftSearch, setDraftSearch] = useState<string>(search);

  const [customersList, setCustomersList] = useState<any[]>([]);

  // Row selection for status bar
  const [selectedRow, setSelectedRow] = useState<string | number | null>(null);

  // Column visibility (persisted)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem("amountReceivableVisibleColumns_v2");
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
    localStorage.setItem("amountReceivableVisibleColumns_v2", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const isVisible = (id: ColumnKey) => visibleColumns.includes(id);

  // Load customers list for filter dropdown
  useEffect(() => {
    const loadCustomers = async () => {
      try {
        const res = await customerService.fetchAll({ limit: 200 });
        const list = Array.isArray(res) ? res : res?.customers || [];
        setCustomersList(list);
      } catch (err) {
        console.error("Failed to load customers dropdown", err);
      }
    };
    loadCustomers();
  }, []);

  const cacheKey = `accounts:amount-receivable:${asOnDate}:${startDate}:${endDate}:${customerId}:${search}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      try {
        const data = await receivableService.getReceivables({
          asOnDate,
          startDate,
          endDate,
          customerId,
          search,
          page: 1,
          limit: 10000,
        });
        const list = Array.isArray(data) ? data : [];
        return { data: list, total: list.length };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load customer receivables");
        throw err;
      }
    },
    [asOnDate, startDate, endDate, customerId, search]
  );

  // Prefetch each customer's breakdown in the background when the list loads.
  const onListSuccess = useCallback((list: CustomerReceivableSummary[]) => {
    for (const c of list) {
      const detailKey = `accounts:customer-breakdown-${c.customerId}::`;
      prefetchCache(detailKey, async () => {
        const data = await receivableService.getCustomerDetail(c.customerId, {
          startDate: "",
          endDate: "",
        });
        return { data: data ? [data] : [], total: data ? 1 : 0 };
      });
    }
  }, []);

  const {
    data: receivables,
    loading,
    refreshing,
    refresh,
    error: listError,
  } = useListCache<CustomerReceivableSummary>({
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
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setCustomerId(draftCustomerId);
    setSearch(draftSearch);
  };

  const handleClearFilters = () => {
    setDraftStartDate("");
    setDraftEndDate("");
    setDateRangePreset("custom");
    setDraftCustomerId("");
    setDraftSearch("");

    setStartDate("");
    setEndDate("");
    setCustomerId("");
    setSearch("");
  };

  const [sortBy, setSortBy] = useState<string>("activity");

  const filteredCustomers = useMemo(() => {
    // Only customers with a POSITIVE Dr balance actually owe us. A customer
    // sitting on a Cr balance (they paid advance / credit note pending) is
    // NOT a receivable — they've already paid. Hide them so this page only
    // shows real dues. If the user needs to see credit-balance customers,
    // that's a separate "Customer Advances" report.
    const list = (Array.isArray(receivables) ? receivables : []).filter(
      (c) => Number(c.balanceAsOnDate || 0) > 0.005
    );
    if (sortBy === "activity") {
      list.sort((a, b) => {
        const aAct = (a.totalBilled || 0) + (a.totalPaid || 0);
        const bAct = (b.totalBilled || 0) + (b.totalPaid || 0);
        if (aAct !== bAct) return bAct - aAct;
        return (b.balanceAsOnDate || 0) - (a.balanceAsOnDate || 0);
      });
    } else if (sortBy === "balance") {
      list.sort((a, b) => (b.balanceAsOnDate || 0) - (a.balanceAsOnDate || 0));
    } else if (sortBy === "overdue") {
      list.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        return (b.overdueAmount || 0) - (a.overdueAmount || 0);
      });
    } else if (sortBy === "name") {
      list.sort((a, b) => (a.firmName || "").localeCompare(b.firmName || ""));
    }
    return list;
  }, [receivables, sortBy]);

  // Dashboard Totals
  const totals = useMemo(() => {
    return filteredCustomers.reduce(
      (acc, curr) => {
        const d =
          curr.debit !== undefined
            ? curr.debit
            : (curr.openingBalance || 0) + (curr.totalBilled || 0);
        const c =
          curr.credit !== undefined
            ? curr.credit
            : (curr.totalPaid || 0) + (curr.totalReturned || 0);
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
  }, [filteredCustomers]);

  // CSV Export dataset configuration
  const { csvData, csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Customer Code", accessor: (item: any) => item.customerCode },
      { header: "Customer / Firm Name", accessor: (item: any) => item.firmName },
      { header: "Customer Type", accessor: (item: any) => item.customerType || "CUSTOMER" },
      { header: "GSTIN", accessor: (item: any) => item.gstin || "-" },
      { header: "Phone", accessor: (item: any) => item.phone || "-" },
      { header: "Opening Balance", accessor: (item: any) => item.openingBalance || 0 },
      { header: "Invoiced Amount", accessor: (item: any) => item.totalBilled || 0 },
      { header: "Paid / Received Amount", accessor: (item: any) => item.totalPaid || 0 },
      { header: "Returned Amount", accessor: (item: any) => item.totalReturned || 0 },
      { header: "Debit Amount", accessor: (item: any) => item.debit || 0 },
      { header: "Credit Amount", accessor: (item: any) => item.credit || 0 },
      { header: "Net Balance", accessor: (item: any) => item.balanceAsOnDate || 0 },
      { header: "Overdue Amount", accessor: (item: any) => item.overdueAmount || 0 },
      { header: "Is Overdue", accessor: (item: any) => (item.isOverdue ? "Yes" : "No") },
    ];

    return {
      csvData: filteredCustomers,
      csvColumns: columns,
      csvFilename: `Amount_Receivable_Report_${asOnDate}.csv`,
    };
  }, [filteredCustomers, asOnDate]);

  const netBal = Number(totals.totalNetBalance || 0);
  return (
    <div className="w-full text-ink">
      <PageHeader
        title="Receivables"
        subtitle="What customers owe you, with ageing and overdue bills"
        icon={<HandCoins size={20} />}
        primaryAction={
          <ActionPill
            icon={<Plus size={18} />}
            onClick={() => navigate("/accounts/receipt-voucher/add")}
          >
            Record Receipt
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
            {(can("receivable.export") || can("accounts.export")) && (
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
          label="Total receivable"
          value={
            Math.abs(netBal) < 0.005 ? (
              "₹0"
            ) : (
              <span title={fmtDrCr(netBal)}>
                {fmtINRCompact(Math.abs(netBal))}{" "}
                <span className="text-base font-semibold text-ink-subtle">
                  {netBal >= 0 ? "Dr" : "Cr"}
                </span>
              </span>
            )
          }
        />
        <StatTile label="Customers" value={filteredCustomers.length} />
        <StatTile
          label="Overdue"
          value={totals.overdueCount}
          delta={totals.overdueCount > 0 ? "Needs follow-up" : undefined}
          deltaTone="warning"
        />
        <StatTile
          label="Total debit"
          value={<span title={fmtINR(totals.totalDebit)}>{fmtINRCompact(totals.totalDebit)}</span>}
        />
      </div>
      <div className="w-full space-y-4">
        {/* Filter bar */}
        <div className="sl-tile flex flex-wrap items-end gap-3 p-4 sm:p-5">
          <div className="w-full sm:w-[160px]">
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

          <div className="w-full sm:w-[220px]">
            <label htmlFor="ar-search" className="sl-label">
              Search
            </label>
            <input
              id="ar-search"
              type="text"
              className="sl-input h-11 w-full text-sm"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Code / Name..."
            />
          </div>

          <div className="w-full sm:w-[190px]">
            <label className="sl-label">Customer</label>
            <SelectInput
              name="draftCustomerId"
              value={draftCustomerId}
              options={customersList.map((c) => ({
                label: c.firmName || c.displayName || c.customerCode,
                value: c.id,
              }))}
              defaultOptionLabel="All Customers"
              hideLabel
              ariaLabel="Customer"
              searchable
              onChange={(e) => setDraftCustomerId(e.target.value)}
            />
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
            kind="receivable"
            asOnDate={asOnDate}
            partyId={customerId || undefined}
            search={search || undefined}
            onOpenParty={(id) => navigate(`/accounts/receivable/${id}`)}
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
            <h2 className="sl-h2 m-0 text-[15px] flex items-center gap-2">Customer Receivables</h2>
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
                Total: {filteredCustomers.length}
              </span>
            </div>
          </div>

          {listError && !loading && filteredCustomers.length > 0 && (
            <StaleNotice onRetry={refresh} className="m-3" />
          )}
          {listError && !loading && receivables.length === 0 ? (
            <LoadError compact title="Couldn't load customer receivables" onRetry={refresh} />
          ) : filteredCustomers.length === 0 ? (
            <div className="p-10 text-center text-sm text-ink-muted flex-1">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <FaSync className="animate-spin text-accent text-[11.5px]" />
                  Loading customer receivables…
                </span>
              ) : (
                "No customer receivables matching the selected filter criteria."
              )}
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-[12.5px] text-ink-muted border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-card-2 text-ink-muted font-semibold text-[12px] border-b border-line-soft">
                    {isVisible("index") && <th className="px-3 py-2.5 w-10 text-center">#</th>}
                    {isVisible("code") && <th className="px-3 py-2.5 w-24">Code</th>}
                    {isVisible("customer") && <th className="px-3 py-2.5">Customer</th>}
                    {isVisible("invoiced") && (
                      <th className="px-3 py-2.5 w-28 text-right">Invoiced</th>
                    )}
                    {isVisible("paid") && <th className="px-3 py-2.5 w-28 text-right">Paid</th>}
                    {isVisible("debit") && <th className="px-3 py-2.5 w-28 text-right">Debit</th>}
                    {isVisible("credit") && <th className="px-3 py-2.5 w-28 text-right">Credit</th>}
                    {isVisible("netBalance") && (
                      <th className="px-3 py-2.5 w-32 text-right">Net Balance</th>
                    )}
                    {isVisible("action") && (
                      <th className="px-2 py-1.5 w-20 text-center">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((item: any, rowIdx: number) => {
                    const isSelected = selectedRow === item.customerId;
                    const bal = Number(item.balanceAsOnDate || 0);
                    const balAbs = Math.abs(bal).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    });
                    return (
                      <tr
                        key={item.customerId}
                        onClick={() => setSelectedRow(item.customerId)}
                        className={`border-b border-line-soft cursor-pointer ${
                          isSelected
                            ? "bg-nav-active text-ink"
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
                          <td className="px-3 py-2 tabular-nums font-semibold text-accent">
                            {item.customerCode || "-"}
                          </td>
                        )}
                        {isVisible("customer") && (
                          <td className="px-3 py-2">
                            <div className="font-bold text-ink uppercase truncate">
                              {item.firmName}
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
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-accent">
                            ₹
                            {(item.debit || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        )}
                        {isVisible("credit") && (
                          <td className="px-3 py-2 text-right tabular-nums">
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
                                ₹{balAbs} <span className="text-[11.5px] text-ink-subtle">Dr</span>
                              </span>
                            ) : (
                              <span className="text-[color:var(--color-success)]">
                                ₹{balAbs}{" "}
                                <span className="text-[11.5px] text-[color:var(--color-success)]">
                                  Cr
                                </span>
                              </span>
                            )}
                          </td>
                        )}
                        {isVisible("action") && (
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/accounts/receivable/${item.customerId}`);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-nav-active hover:bg-nav-active text-accent font-semibold rounded text-[12.5px] border border-accent"
                            >
                              View <FaChevronRight size={8} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Busy-style empty filler rows */}
                  {Array.from({ length: Math.max(0, 25 - filteredCustomers.length) }).map(
                    (_, i) => (
                      <tr key={`empty-${i}`} className="border-b border-line-soft">
                        {isVisible("index") && <td className="px-3 py-2">&nbsp;</td>}
                        {isVisible("code") && <td className="px-3 py-2"></td>}
                        {isVisible("customer") && <td className="px-3 py-2"></td>}
                        {isVisible("invoiced") && <td className="px-3 py-2"></td>}
                        {isVisible("paid") && <td className="px-3 py-2"></td>}
                        {isVisible("debit") && <td className="px-3 py-2"></td>}
                        {isVisible("credit") && <td className="px-3 py-2"></td>}
                        {isVisible("netBalance") && <td className="px-3 py-2"></td>}
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
                        (isVisible("customer") ? 1 : 0)
                      }
                      className="px-2 py-1.5 text-right text-[11.5px] font-bold text-ink uppercase tracking-wide border-r border-line"
                    >
                      Grand Total ({filteredCustomers.length})
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
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-accent border-r border-line">
                        ₹
                        {totals.totalDebit.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    )}
                    {isVisible("credit") && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink border-r border-line">
                        ₹
                        {totals.totalCredit.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    )}
                    {isVisible("netBalance") && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-accent border-r border-line">
                        ₹
                        {Math.abs(totals.totalNetBalance).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        <span className="text-[11.5px] ml-1">
                          {totals.totalNetBalance >= 0 ? "Dr" : "Cr"}
                        </span>
                      </td>
                    )}
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
                  {filteredCustomers.length > 0 ? 1 : 0} / {filteredCustomers.length}
                </b>
              </span>
              <span>
                Row No:{" "}
                <b className="text-ink">
                  {selectedRow
                    ? filteredCustomers.findIndex((v: any) => v.customerId === selectedRow) + 1
                    : filteredCustomers.length > 0
                      ? 1
                      : 0}
                  {" / "}
                  {filteredCustomers.length}
                </b>
              </span>
            </div>
            <div className="flex gap-3 uppercase tracking-wide">
              <span>
                Customers: <b className="text-ink">{filteredCustomers.length}</b>
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

export default AmountReceivablePage;
