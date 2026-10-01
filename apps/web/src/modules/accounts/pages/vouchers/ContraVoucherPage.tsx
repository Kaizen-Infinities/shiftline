import React, { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, SlidersHorizontal, ArrowLeftRight, Ban } from "lucide-react";
import { toast } from "react-toastify";
import {
  voucherService,
  displayVoucherNo,
  type Voucher,
} from "../../../../services/voucherService";
import { useListCache, invalidateCache } from "../../../../hooks/useListCache";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import CancelReasonModal from "../../../../components/ui/CancelReasonModal/CancelReasonModal";
import {
  ActionPill,
  PageHeader,
  StatTile,
  EmptyState,
  SkeletonRows,
  LoadError,
  StaleNotice,
} from "../../../../components/ui/v2";
import {
  VoucherTypeNav,
  RegisterOptionsCard,
  OptionRow,
  YesNo,
  optionInputClass,
  thClass,
  tdClass,
  fmtAmt,
  fmtINR,
  fmtINRCompact,
  fmtDate,
} from "../../components/accountsUi";

// Contra filter — same defaults as Journal per Busy's convention:
// Voucher Series = <<-ALL->>, all display toggles = N.
interface FilterOptions {
  voucherSeries: string;
  startDate: string;
  endDate: string;
  accountShownBy: "Name" | "Alias" | "Code";
  showNarration: boolean;
}

const todayIso = () => new Date().toISOString().split("T")[0];

const defaultFilters = (): FilterOptions => ({
  voucherSeries: "<<-ALL->>",
  startDate: todayIso(),
  endDate: todayIso(),
  accountShownBy: "Name",
  showNarration: false,
});

const ContraVoucherPage: React.FC = () => {
  const navigate = useNavigate();

  const [applied, setApplied] = useState<FilterOptions>(() => defaultFilters());
  const [pending, setPending] = useState<FilterOptions>(() => defaultFilters());
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

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

  const cacheKey = `accounts:contra-vouchers:${applied.startDate}:${applied.endDate}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      try {
        const res = await voucherService.fetchVouchers({
          type: "CONTRA",
          startDate: applied.startDate || undefined,
          endDate: applied.endDate || undefined,
          page: 1,
          limit: 10000,
        });
        return { data: res.vouchers || [], total: res.total || res.vouchers?.length || 0 };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load contra entries");
        throw err;
      }
    },
    [applied.startDate, applied.endDate]
  );

  const {
    data: vouchers,
    total,
    loading,
    refreshing,
    refresh,
    error: listError,
  } = useListCache<Voucher>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
  });

  const allVoucherIds = useMemo(() => vouchers.map((v) => v.id), [vouchers]);
  const allSelected = allVoucherIds.length > 0 && allVoucherIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleVoucher = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allVoucherIds));
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setShowCancel(true);
  };

  // P1-10d: vouchers are cancelled with a reason and reversed, never deleted.
  const handleCancelConfirm = async (reason: string) => {
    setDeleting(true);
    let failed = 0;
    for (const id of Array.from(selectedIds)) {
      try {
        await voucherService.cancelVoucher(id, reason);
      } catch {
        failed++;
      }
    }
    setDeleting(false);
    setShowCancel(false);
    const count = selectedIds.size;
    setSelectedIds(new Set());
    invalidateCache(cacheKey);
    refresh();
    if (failed === 0) {
      toast.success(`Cancelled ${count} voucher(s); their entries were reversed`);
    } else {
      toast.warning(`Cancelled with ${failed} error(s)`);
    }
  };

  // Contra list — one row per journal item (matches Busy's flat register).
  const flatRows = useMemo(() => {
    const out: Array<{
      voucher: Voucher;
      item: Voucher["items"][number];
      itemIdx: number;
      isFirst: boolean;
    }> = [];
    for (const v of vouchers) {
      v.items.forEach((it, idx) => {
        out.push({ voucher: v, item: it, itemIdx: idx, isFirst: idx === 0 });
      });
    }
    return out;
  }, [vouchers]);

  const { totalDebit, totalCredit } = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const v of vouchers) {
      for (const it of v.items) {
        d += Number(it.debitAmount || 0);
        c += Number(it.creditAmount || 0);
      }
    }
    return { totalDebit: d, totalCredit: c };
  }, [vouchers]);

  const openFilters = () => {
    setPending(applied);
    setPanelOpen(true);
  };

  const newButton = (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/accounts/contra-entry/add")}>
      New Contra
    </ActionPill>
  );

  // ────── Busy-style pre-list options (F2 = show, Esc = close) ──────
  if (panelOpen) {
    return (
      <div className="w-full">
        <PageHeader
          title="Contra entries"
          subtitle="Transfers between your own bank and cash accounts"
          icon={<ArrowLeftRight size={20} />}
          primaryAction={newButton}
        >
          <VoucherTypeNav current="CONTRA" />
        </PageHeader>
        <RegisterOptionsCard
          onOk={() => {
            setApplied(pending);
            setPanelOpen(false);
          }}
        >
          <OptionRow label="Voucher series" htmlFor="cv-series">
            <select
              id="cv-series"
              value={pending.voucherSeries}
              onChange={(e) => setPending({ ...pending, voucherSeries: e.target.value })}
              className={optionInputClass}
            >
              <option value="<<-ALL->>">{"<<-ALL->>"}</option>
              <option value="Main">Main</option>
            </select>
          </OptionRow>
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
          <OptionRow label="Account shown by" htmlFor="cv-shown-by">
            <select
              id="cv-shown-by"
              value={pending.accountShownBy}
              onChange={(e) =>
                setPending({
                  ...pending,
                  accountShownBy: e.target.value as "Name" | "Alias" | "Code",
                })
              }
              className={optionInputClass}
            >
              <option value="Name">Name</option>
              <option value="Alias">Alias</option>
              <option value="Code">Code</option>
            </select>
          </OptionRow>
          <YesNo
            label="Show short narration?"
            value={pending.showNarration}
            onChange={(v) => setPending({ ...pending, showNarration: v })}
          />
        </RegisterOptionsCard>
      </div>
    );
  }

  // ────── Contra Register (list) — one row per item ──────
  const rowNo = selectedRow
    ? flatRows.findIndex((r) => r.voucher.id === selectedRow) + 1
    : flatRows.length > 0
      ? 1
      : 0;
  const firstLoad = loading && vouchers.length === 0;

  return (
    <div className="w-full">
      <PageHeader
        title="Contra entries"
        subtitle={
          <>
            Series {applied.voucherSeries} · {fmtDate(applied.startDate)} to{" "}
            {fmtDate(applied.endDate)}
          </>
        }
        icon={<ArrowLeftRight size={20} />}
        primaryAction={newButton}
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<SlidersHorizontal size={16} />}
              onClick={openFilters}
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
      >
        <VoucherTypeNav current="CONTRA" />
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Vouchers" value={total} loading={firstLoad} />
        <StatTile label="Entries" value={flatRows.length} loading={firstLoad} />
        <StatTile
          label="Total moved"
          value={<span title={fmtINR(totalDebit)}>{fmtINRCompact(totalDebit)}</span>}
          loading={firstLoad}
        />
      </div>

      {someSelected && (
        <div
          role="region"
          aria-label="Selection"
          className="sl-tile mb-3 flex flex-wrap items-center justify-between gap-3 bg-nav-active px-4 py-2.5"
        >
          <span className="text-sm font-semibold text-ink">
            {selectedIds.size} selected
            <span className="sl-muted ml-2 font-normal">
              Cancelling reverses the entries; vouchers are never deleted.
            </span>
          </span>
          <div className="flex gap-2">
            <ActionPill variant="secondary" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </ActionPill>
            <ActionPill
              variant="danger"
              size="sm"
              icon={<Ban size={15} />}
              onClick={handleDeleteSelected}
              loading={deleting}
              loadingText="Cancelling..."
            >
              {`Cancel (${selectedIds.size})`}
            </ActionPill>
          </div>
        </div>
      )}

      <section className="sl-tile overflow-hidden" aria-label="Contra vouchers">
        {listError && !loading && flatRows.length > 0 && (
          <StaleNotice onRetry={refresh} className="m-3" />
        )}
        {flatRows.length === 0 ? (
          listError && !loading ? (
            <LoadError compact title="Couldn't load contra vouchers" onRetry={refresh} />
          ) : loading ? (
            <SkeletonRows rows={6} columns={5} label="Loading contra vouchers" />
          ) : (
            <EmptyState
              title="No contra vouchers in this period"
              description="Widen the dates with Change filters, or record a new transfer."
              action={
                <ActionPill
                  variant="secondary"
                  icon={<SlidersHorizontal size={16} />}
                  onClick={openFilters}
                >
                  Change filters
                </ActionPill>
              }
            />
          )
        ) : (
          <div className="max-h-[calc(100vh-320px)] min-h-[240px] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className={thClass("center", "w-12")}>
                    <input
                      type="checkbox"
                      className="sl-check"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all vouchers"
                    />
                  </th>
                  <th scope="col" className={thClass("left", "w-32")}>
                    Date
                  </th>
                  <th scope="col" className={thClass("left", "w-28")}>
                    Vch / bill no
                  </th>
                  <th scope="col" className={thClass()}>
                    Account
                  </th>
                  <th scope="col" className={thClass("right", "w-36")}>
                    Debit (₹)
                  </th>
                  <th scope="col" className={thClass("right", "w-36")}>
                    Credit (₹)
                  </th>
                  {applied.showNarration && (
                    <th scope="col" className={thClass()}>
                      Narration
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {flatRows.map(({ voucher, item, itemIdx, isFirst }) => {
                  const ledger = item.debitLedger || item.creditLedger;
                  const accountLabel =
                    applied.accountShownBy === "Code" ? ledger?.code : ledger?.name;
                  const dr = Number(item.debitAmount || 0);
                  const cr = Number(item.creditAmount || 0);
                  const isChecked = selectedIds.has(voucher.id);
                  return (
                    <tr
                      key={`${voucher.id}-${itemIdx}`}
                      onClick={() => toggleVoucher(voucher.id)}
                      aria-selected={isChecked}
                      className={`cursor-pointer ${
                        isFirst ? "border-t border-line-soft first:border-t-0" : ""
                      } ${isChecked ? "bg-nav-active" : "sl-row-hover"}`}
                    >
                      <td className={tdClass("center")} onClick={(e) => e.stopPropagation()}>
                        {isFirst && (
                          <input
                            type="checkbox"
                            className="sl-check"
                            checked={isChecked}
                            onChange={() => toggleVoucher(voucher.id)}
                            aria-label={`Select voucher ${displayVoucherNo(voucher.voucherNo)}`}
                          />
                        )}
                      </td>
                      <td
                        className={tdClass("left", "whitespace-nowrap tabular-nums text-ink-muted")}
                      >
                        {isFirst ? fmtDate(voucher.date) : ""}
                      </td>
                      <td className={tdClass("left", "font-semibold tabular-nums text-accent")}>
                        {isFirst ? displayVoucherNo(voucher.voucherNo) : ""}
                      </td>
                      <td className={tdClass("left", "font-medium")}>{accountLabel || "—"}</td>
                      <td className={tdClass("right", "font-semibold")}>
                        {dr > 0 ? fmtAmt(dr) : ""}
                      </td>
                      <td className={tdClass("right", "font-semibold")}>
                        {cr > 0 ? fmtAmt(cr) : ""}
                      </td>
                      {applied.showNarration && (
                        <td className={tdClass("left", "max-w-xs truncate text-ink-muted")}>
                          {item.narration || "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-[1]">
                <tr className="border-t border-line bg-card-2">
                  <td
                    colSpan={4}
                    className="px-4 py-3 text-right text-[13px] font-semibold text-ink-muted"
                  >
                    <span className="float-left font-medium text-ink-subtle">
                      Row {rowNo} of {flatRows.length}
                    </span>
                    Total ({vouchers.length} vouchers · {flatRows.length} entries)
                  </td>
                  <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums text-ink">
                    {fmtAmt(totalDebit)}
                  </td>
                  <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums text-ink">
                    {fmtAmt(totalCredit)}
                  </td>
                  {applied.showNarration && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <CancelReasonModal
        show={showCancel}
        onHide={() => setShowCancel(false)}
        onConfirm={handleCancelConfirm}
        isLoading={deleting}
        title={`Cancel ${selectedIds.size} contra voucher(s)?`}
        confirmText="Cancel vouchers"
      />
    </div>
  );
};

export default ContraVoucherPage;
