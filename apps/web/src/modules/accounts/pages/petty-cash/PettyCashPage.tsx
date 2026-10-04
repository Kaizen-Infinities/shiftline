import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { FaCoins, FaSync, FaTimes } from "react-icons/fa";
import {
  ActionPill,
  LoadError,
  PageHeader,
  SearchField,
  StaleNotice,
  StatTile,
} from "../../../../components/ui/v2";
import {
  OptionRow,
  RegisterOptionsCard,
  YesNo,
  fmtDate,
  fmtINR,
  fmtINRCompact,
} from "../../components/accountsUi";
import { toast } from "react-toastify";
import {
  pettyCashService,
  type PettyCashEntry,
  type PettyCashSummary,
} from "../../../../services/pettyCashService";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { useListCache, prependToListCacheByPrefix } from "../../../../hooks/useListCache";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";

// Busy-style filter options shown BEFORE the list opens.
interface FilterOptions {
  startDate: string;
  endDate: string;
  entryType: "ALL" | "IN" | "OUT";
  showCategory: boolean;
  showDescription: boolean;
  showReceiptNo: boolean;
  showBalance: boolean;
}

const todayIso = () => new Date().toISOString().split("T")[0];

const defaultFilters = (): FilterOptions => ({
  startDate: todayIso(),
  endDate: todayIso(),
  entryType: "ALL",
  showCategory: true,
  showDescription: true,
  showReceiptNo: true,
  showBalance: true,
});

export const PettyCashPage: React.FC = () => {
  const [summary, setSummary] = useState<PettyCashSummary>({
    totalIn: 0,
    totalOut: 0,
    currentBalance: 0,
  });
  const [showModal, setShowModal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [selectedRow, setSelectedRow] = useState<string | number | null>(null);

  const { data: company } = useAppSelector((state) => state.company);

  // Applied filters drive the fetch; pending lives inside the panel until OK.
  const [applied, setApplied] = useState<FilterOptions>(() => defaultFilters());
  const [pending, setPending] = useState<FilterOptions>(() => defaultFilters());
  const [panelOpen, setPanelOpen] = useState<boolean>(true);

  // In-list search (kept inline, not part of the pre-list dialog).
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Form State (New Entry modal)
  const [type, setType] = useState<"IN" | "OUT">("OUT");
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [paidTo, setPaidTo] = useState<string>("");
  const [receiptNo, setReceiptNo] = useState<string>("");
  const [entryDate, setEntryDate] = useState<string>(todayIso());

  // F2 = OK, Esc = close panel (matches Busy shortcut on the other list pages).
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        setApplied(pending);
        setPanelOpen(false);
      } else if (e.key === "Escape") {
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, pending]);

  const cacheKey = `accounts:petty-cash-entries:${company?.id ?? ""}:${applied.entryType}:${applied.startDate}:${applied.endDate}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      try {
        const res = await pettyCashService.fetchEntries({
          companyId: company?.id,
          type: applied.entryType === "ALL" ? undefined : applied.entryType,
          startDate: applied.startDate || undefined,
          endDate: applied.endDate || undefined,
        });
        const list = res.entries || [];
        setSummary(res.summary || { totalIn: 0, totalOut: 0, currentBalance: 0 });
        return { data: list, total: list.length };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load petty cash entries");
        throw err;
      }
    },
    [company?.id, applied.entryType, applied.startDate, applied.endDate]
  );

  const {
    data: entries,
    total,
    loading,
    refreshing,
    refresh,
    error: listError,
  } = useListCache<PettyCashEntry>({
    cacheKey,
    socketModule: "pettyCashEntry",
    fetcher,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0 || !description || !company?.id) {
      toast.error("Please fill in all required fields and ensure company context is active");
      return;
    }

    setSubmitting(true);
    try {
      const created = await pettyCashService.createEntry({
        companyId: company.id,
        type,
        category,
        amount: parseFloat(amount),
        description,
        paidTo: paidTo || undefined,
        receiptNo: receiptNo || undefined,
        entryDate,
      });
      // Optimistic list update — row appears in the table instantly. The
      // subsequent refresh() below still runs so `summary` (totalIn / totalOut
      // / currentBalance) recalculates from the server.
      if (created?.id) {
        prependToListCacheByPrefix<PettyCashEntry>("accounts:petty-cash-entries:", created);
      }
      toast.success("Petty Cash entry recorded successfully!");
      setShowModal(false);
      resetForm();
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create entry");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setType("OUT");
    setCategory("");
    setAmount("");
    setDescription("");
    setPaidTo("");
    setReceiptNo("");
    setEntryDate(new Date().toISOString().split("T")[0]);
  };

  const filteredEntries = useMemo(() => {
    if (!searchTerm) return entries;
    const term = searchTerm.toLowerCase();
    return entries.filter(
      (e) =>
        e.entryNo?.toLowerCase().includes(term) ||
        e.category?.toLowerCase().includes(term) ||
        e.description?.toLowerCase().includes(term) ||
        e.paidTo?.toLowerCase().includes(term) ||
        e.receiptNo?.toLowerCase().includes(term)
    );
  }, [entries, searchTerm]);

  // Running balance: chronological IN − OUT
  const runningBalances = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
    );
    const map = new Map<string | number, number>();
    let bal = 0;
    sorted.forEach((e) => {
      bal += e.type === "IN" ? Number(e.amount) : -Number(e.amount);
      map.set(e.id, bal);
    });
    return map;
  }, [entries]);

  // Column totals for the sticky footer
  const { totalInPage, totalOutPage } = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    for (const e of filteredEntries) {
      if (e.type === "IN") inSum += Number(e.amount);
      else outSum += Number(e.amount);
    }
    return { totalInPage: inSum, totalOutPage: outSum };
  }, [filteredEntries]);

  const recordButton = (
    <ActionPill
      icon={<Plus size={18} />}
      onClick={() => {
        resetForm();
        setShowModal(true);
      }}
    >
      Record Cash Entry
    </ActionPill>
  );

  const summaryTiles = (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      <StatTile
        label="Total cash in"
        icon={<ArrowDownLeft size={18} />}
        value={<span title={fmtINR(summary.totalIn)}>{fmtINRCompact(summary.totalIn)}</span>}
      />
      <StatTile
        label="Total cash out"
        icon={<ArrowUpRight size={18} />}
        value={<span title={fmtINR(summary.totalOut)}>{fmtINRCompact(summary.totalOut)}</span>}
      />
      <StatTile
        className="col-span-2 lg:col-span-1"
        label="Cash balance on hand"
        icon={<Wallet size={18} />}
        value={
          <span title={fmtINR(summary.currentBalance)}>
            {fmtINRCompact(summary.currentBalance)}
          </span>
        }
      />
    </div>
  );

  // ────── Busy-style pre-list options (F2 = show, Esc = close) ──────
  if (panelOpen) {
    return (
      <div className="w-full">
        <PageHeader
          title="Petty cash"
          subtitle="Small cash spends and top-ups, with a running balance"
          icon={<Coins size={20} />}
          primaryAction={recordButton}
        />
        <RegisterOptionsCard
          okLabel="Show entries"
          onOk={() => {
            setApplied(pending);
            setPanelOpen(false);
          }}
        >
          <OptionRow label="Starting date">
            <DatePickerCalendar
              name="startDate"
              value={pending.startDate}
              onChange={(e) => setPending({ ...pending, startDate: e.target.value })}
            />
          </OptionRow>
          <OptionRow label="Ending date">
            <DatePickerCalendar
              name="endDate"
              value={pending.endDate}
              onChange={(e) => setPending({ ...pending, endDate: e.target.value })}
            />
          </OptionRow>
          <OptionRow label="Entry type">
            <SelectInput
              label="Entry Type"
              hideLabel
              noMargin
              searchable={false}
              value={pending.entryType}
              onChange={(e) =>
                setPending({ ...pending, entryType: e.target.value as "ALL" | "IN" | "OUT" })
              }
              options={[
                { value: "ALL", label: "All Entry Types" },
                { value: "IN", label: "Cash IN (Receipts)" },
                { value: "OUT", label: "Cash OUT (Expenses)" },
              ]}
            />
          </OptionRow>
          <YesNo
            label="Show category?"
            value={pending.showCategory}
            onChange={(v) => setPending({ ...pending, showCategory: v })}
          />
          <YesNo
            label="Show description?"
            value={pending.showDescription}
            onChange={(v) => setPending({ ...pending, showDescription: v })}
          />
          <YesNo
            label="Show receipt no?"
            value={pending.showReceiptNo}
            onChange={(v) => setPending({ ...pending, showReceiptNo: v })}
          />
          <YesNo
            label="Show balance?"
            value={pending.showBalance}
            onChange={(v) => setPending({ ...pending, showBalance: v })}
          />
        </RegisterOptionsCard>
      </div>
    );
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Petty cash"
        subtitle={`${fmtDate(applied.startDate)} to ${fmtDate(applied.endDate)} · ${
          applied.entryType === "ALL"
            ? "All entries"
            : applied.entryType === "IN"
              ? "Cash in"
              : "Cash out"
        }`}
        icon={<Coins size={20} />}
        primaryAction={recordButton}
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<SlidersHorizontal size={16} />}
              onClick={() => {
                setPending(applied);
                setPanelOpen(true);
              }}
              title="Change filters"
            >
              Change filters
            </ActionPill>
            <ActionPill
              variant="secondary"
              icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
              onClick={refresh}
            >
              Refresh
            </ActionPill>
          </>
        }
      />
      {summaryTiles}
      <div className="mb-4">
        <SearchField
          value={searchTerm}
          onValueChange={setSearchTerm}
          placeholder="Search entry no, category, description..."
          className="sm:w-96"
        />
      </div>
      <div className="w-full">
        {/* Spreadsheet-style table (Busy density) */}
        <div
          className="sl-tile overflow-hidden flex flex-col"
          style={{ maxHeight: "calc(100vh - 240px)" }}
        >
          {listError && !loading && filteredEntries.length > 0 && (
            <StaleNotice onRetry={refresh} className="m-3" />
          )}
          {listError && !loading && entries.length === 0 ? (
            <LoadError compact title="Couldn't load petty cash entries" onRetry={refresh} />
          ) : filteredEntries.length === 0 ? (
            <div className="p-10 text-center text-sm text-ink-muted flex-1">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <FaSync className="animate-spin text-[color:var(--color-warning)] text-[11.5px]" />
                  Loading petty cash entries…
                </span>
              ) : (
                "No petty cash transactions found."
              )}
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-[12.5px] text-ink-muted border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-card-2 text-ink-muted font-semibold text-[12px] border-b border-line-soft">
                    <th className="px-3 py-2.5 w-28">Date</th>
                    <th className="px-3 py-2.5 w-24 text-center">Entry No</th>
                    <th className="px-3 py-2.5 w-20 text-center">Type</th>
                    {applied.showCategory && <th className="px-3 py-2.5 w-40">Category</th>}
                    {applied.showDescription && <th className="px-3 py-2.5">Description</th>}
                    <th className="px-3 py-2.5 w-40">Paid To / From</th>
                    {applied.showReceiptNo && (
                      <th className="px-3 py-2.5 w-24 text-center">Receipt No</th>
                    )}
                    <th className="px-3 py-2.5 w-28 text-right">Amount (₹)</th>
                    {applied.showBalance && (
                      <th className="px-2 py-1.5 w-28 text-right">Balance (₹)</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((item, rowIdx) => {
                    const isSelected = selectedRow === item.id;
                    const isIn = item.type === "IN";
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedRow(item.id)}
                        className={`border-b border-line-soft cursor-pointer ${
                          isSelected
                            ? "bg-[color:var(--color-warning)]/10 text-ink"
                            : rowIdx % 2 === 0
                              ? "hover:bg-card-2/70"
                              : "bg-card-2/20 hover:bg-card-2/70"
                        }`}
                      >
                        <td className="px-3 py-2 tabular-nums text-[12.5px]">
                          {new Date(item.entryDate).toLocaleDateString("en-GB")}
                        </td>
                        <td className="px-3 py-2 tabular-nums font-semibold text-[color:var(--color-warning)] text-center">
                          {item.entryNo || "-"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[11.5px] font-bold ${
                              isIn
                                ? "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)] border border-[color:var(--color-success)]/40"
                                : "bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)] border border-[color:var(--color-danger)]/40"
                            }`}
                          >
                            {isIn ? "IN" : "OUT"}
                          </span>
                        </td>
                        {applied.showCategory && (
                          <td className="px-3 py-2 font-semibold text-ink uppercase">
                            {item.category || "-"}
                          </td>
                        )}
                        {applied.showDescription && (
                          <td className="px-3 py-2 text-ink-muted max-w-xs truncate">
                            {item.description || "-"}
                          </td>
                        )}
                        <td className="px-3 py-2 text-ink-subtle uppercase">
                          {item.paidTo || "-"}
                        </td>
                        {applied.showReceiptNo && (
                          <td className="px-3 py-2 tabular-nums text-[12.5px] text-ink-subtle text-center">
                            {item.receiptNo || "-"}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">
                          <span
                            className={
                              isIn
                                ? "text-[color:var(--color-success)]"
                                : "text-[color:var(--color-danger)]"
                            }
                          >
                            {isIn ? "+" : "−"}
                            {Number(item.amount).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </td>
                        {applied.showBalance && (
                          <td className="px-2 py-1 text-right tabular-nums font-semibold text-ink whitespace-nowrap">
                            {(runningBalances.get(item.id) || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Busy-style empty filler rows */}
                  {Array.from({ length: Math.max(0, 25 - filteredEntries.length) }).map((_, i) => (
                    <tr key={`empty-${i}`} className="border-b border-line-soft">
                      <td className="px-3 py-2">&nbsp;</td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2"></td>
                      {applied.showCategory && <td className="px-3 py-2"></td>}
                      {applied.showDescription && <td className="px-3 py-2"></td>}
                      <td className="px-3 py-2"></td>
                      {applied.showReceiptNo && <td className="px-3 py-2"></td>}
                      <td className="px-3 py-2"></td>
                      {applied.showBalance && <td className="px-2 py-1"></td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card-2 border-t-2 border-line">
                  <tr>
                    <td
                      colSpan={
                        3 /* Date + Entry No + Type */ +
                        (applied.showCategory ? 1 : 0) +
                        (applied.showDescription ? 1 : 0) +
                        1 /* Paid To/From */ +
                        (applied.showReceiptNo ? 1 : 0)
                      }
                      className="px-2 py-1.5 text-right text-[11.5px] font-bold text-ink uppercase tracking-wide border-r border-line"
                    >
                      Page Total ({filteredEntries.length})
                      <span className="ml-3 normal-case text-ink-subtle">
                        IN{" "}
                        <b className="text-[color:var(--color-success)]">
                          ₹
                          {totalInPage.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </b>
                        <span className="mx-2">·</span>
                        OUT{" "}
                        <b className="text-[color:var(--color-danger)]">
                          ₹
                          {totalOutPage.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </b>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold text-sm text-ink tabular-nums border-r border-line">
                      {(totalInPage - totalOutPage).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    {applied.showBalance && (
                      <td className="px-2 py-1.5 text-right font-bold text-sm text-[color:var(--color-warning)] tabular-nums">
                        {summary.currentBalance.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    )}
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
                  {filteredEntries.length > 0 ? 1 : 0} / {filteredEntries.length}
                </b>
              </span>
              <span>
                Row No:{" "}
                <b className="text-ink">
                  {selectedRow
                    ? filteredEntries.findIndex((v) => v.id === selectedRow) + 1
                    : filteredEntries.length > 0
                      ? 1
                      : 0}
                  {" / "}
                  {filteredEntries.length}
                </b>
              </span>
            </div>
            <div className="flex gap-3 uppercase tracking-wide">
              <span>
                Total: <b className="text-ink">{total}</b>
              </span>
              <span>
                Balance:{" "}
                <b className="text-[color:var(--color-warning)]">
                  ₹
                  {summary.currentBalance.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </b>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Record Cash Entry Modal — Busy-compact */}
      {showModal && (
        <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="sl-dialog w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-line-soft flex items-center justify-between gap-3">
              <h2 className="sl-dialog-title flex items-center gap-2">
                <FaCoins className="text-xs" /> New Petty Cash Entry
              </h2>
              <button onClick={() => setShowModal(false)} className="sl-icon-btn sl-icon-btn-ghost">
                <FaTimes className="text-xs" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="sl-label">
                    Transaction Type <span className="text-[color:var(--color-danger)]">*</span>
                  </label>
                  <SelectInput
                    label="Transaction Type"
                    hideLabel
                    noMargin
                    required
                    searchable={false}
                    value={type}
                    onChange={(e) => setType(e.target.value as "IN" | "OUT")}
                    options={[
                      { value: "OUT", label: "CASH OUT (Expense)" },
                      { value: "IN", label: "CASH IN (Cash Replenishment)" },
                    ]}
                  />
                </div>

                <div>
                  <label className="sl-label">
                    Entry Date <span className="text-[color:var(--color-danger)]">*</span>
                  </label>
                  <DatePickerCalendar
                    name="entryDate"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="sl-label">
                  Category <span className="text-[color:var(--color-danger)]">*</span>
                </label>
                <input
                  list="petty-cash-categories"
                  value={category}
                  required
                  placeholder="Type or select a category..."
                  onChange={(e) => setCategory(e.target.value)}
                  className="sl-input h-11 w-full text-sm"
                />
                <datalist id="petty-cash-categories">
                  {Array.from(new Set(entries.map((e) => e.category).filter(Boolean)))
                    .sort()
                    .map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                </datalist>
              </div>

              <div>
                <label className="sl-label">
                  Amount (₹) <span className="text-[color:var(--color-danger)]">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  required
                  placeholder="0.00"
                  onChange={(e) => setAmount(e.target.value)}
                  className="sl-input h-11 w-full text-sm tabular-nums"
                />
              </div>

              <div>
                <label className="sl-label">
                  Description <span className="text-[color:var(--color-danger)]">*</span>
                </label>
                <input
                  type="text"
                  value={description}
                  required
                  placeholder="e.g. Purchased office stationery"
                  onChange={(e) => setDescription(e.target.value)}
                  className="sl-input h-11 w-full text-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="sl-label">Paid To / From</label>
                  <input
                    type="text"
                    value={paidTo}
                    placeholder="e.g. Local Vendor / John"
                    onChange={(e) => setPaidTo(e.target.value)}
                    className="sl-input h-11 w-full text-sm"
                  />
                </div>

                <div>
                  <label className="sl-label">Receipt No</label>
                  <input
                    type="text"
                    value={receiptNo}
                    placeholder="e.g. REC-102"
                    onChange={(e) => setReceiptNo(e.target.value)}
                    className="sl-input h-11 w-full text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={submitting}
                  className="sl-btn sl-pill-sm cursor-pointer disabled:opacity-50"
                >
                  Clear
                </button>
                <button type="submit" disabled={submitting} className="sl-cta sl-pill-sm">
                  {submitting ? "Saving..." : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PettyCashPage;
