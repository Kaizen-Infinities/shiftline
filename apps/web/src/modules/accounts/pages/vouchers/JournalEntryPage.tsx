import React, { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, SlidersHorizontal, BookOpen } from "lucide-react";
import { toast } from "react-toastify";
import {
  voucherService,
  displayVoucherNo,
  type Voucher,
} from "../../../../services/voucherService";
import { useListCache } from "../../../../hooks/useListCache";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
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

// Busy-style filter — Journal defaults: Voucher Series = <<-ALL->>, all
// display toggles = N (matches Busy's "List of Journal Vouchers" screen).
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

const JournalEntryPage: React.FC = () => {
  const navigate = useNavigate();

  const [applied, setApplied] = useState<FilterOptions>(() => defaultFilters());
  const [pending, setPending] = useState<FilterOptions>(() => defaultFilters());
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

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

  const cacheKey = `accounts:journal-vouchers:${applied.startDate}:${applied.endDate}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      try {
        const res = await voucherService.fetchVouchers({
          type: "JOURNAL",
          startDate: applied.startDate || undefined,
          endDate: applied.endDate || undefined,
          page: 1,
          limit: 10000,
        });
        return { data: res.vouchers || [], total: res.total || res.vouchers?.length || 0 };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load journal entries");
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

  // Journal list shows ONE ROW PER JOURNAL ITEM (Busy convention), not one
  // row per voucher. So flatten items with a reference back to the voucher
  // and mark first item so Date + Vch No only render once per voucher.
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
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/accounts/journal-entry/add")}>
      New Journal
    </ActionPill>
  );

  // ────── Busy-style pre-list options (F2 = show, Esc = close) ──────
  if (panelOpen) {
    return (
      <div className="w-full">
        <PageHeader
          title="Journal Register"
          subtitle="Adjustments between ledgers; every journal balances debit against credit"
          icon={<BookOpen size={20} />}
          primaryAction={newButton}
        >
          <VoucherTypeNav current="JOURNAL" />
        </PageHeader>
        <RegisterOptionsCard
          onOk={() => {
            setApplied(pending);
            setPanelOpen(false);
          }}
        >
          <OptionRow label="Voucher series" htmlFor="jv-series">
            <select
              id="jv-series"
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
          <OptionRow label="Account shown by" htmlFor="jv-shown-by">
            <select
              id="jv-shown-by"
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

  // ────── Journal Register (list) — one row per item, Busy convention ──────
  const selectedIndex = selectedRow
    ? flatRows.findIndex((r) => r.voucher.id === selectedRow) + 1
    : 0;
  const firstLoad = loading && vouchers.length === 0;

  return (
    <div className="w-full">
      <PageHeader
        title="Journal Register"
        subtitle={
          <>
            Series {applied.voucherSeries} · {fmtDate(applied.startDate)} to{" "}
            {fmtDate(applied.endDate)}
          </>
        }
        icon={<BookOpen size={20} />}
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
        <VoucherTypeNav current="JOURNAL" />
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Vouchers" value={total} loading={firstLoad} />
        <StatTile label="Entries" value={flatRows.length} loading={firstLoad} />
        <StatTile
          label="Total debit"
          value={<span title={fmtINR(totalDebit)}>{fmtINRCompact(totalDebit)}</span>}
          loading={firstLoad}
        />
        <StatTile
          label="Total credit"
          value={<span title={fmtINR(totalCredit)}>{fmtINRCompact(totalCredit)}</span>}
          loading={firstLoad}
        />
      </div>

      <section className="sl-tile overflow-hidden" aria-label="Journal vouchers">
        {listError && !loading && flatRows.length > 0 && (
          <StaleNotice onRetry={refresh} className="m-3" />
        )}
        {flatRows.length === 0 ? (
          listError && !loading ? (
            <LoadError compact title="Couldn't load journal vouchers" onRetry={refresh} />
          ) : loading ? (
            <SkeletonRows rows={6} columns={5} label="Loading journal vouchers" />
          ) : (
            <EmptyState
              title="No journal vouchers in this period"
              description="Widen the dates with Change filters, or post a new journal."
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
                  const isSelected = selectedRow === voucher.id;
                  return (
                    <tr
                      key={`${voucher.id}-${itemIdx}`}
                      onClick={() => setSelectedRow(voucher.id)}
                      aria-selected={isSelected}
                      className={`cursor-pointer ${
                        isFirst ? "border-t border-line-soft first:border-t-0" : ""
                      } ${isSelected ? "bg-nav-active" : "sl-row-hover"}`}
                    >
                      {/* Date + Vch No only appear on the first item of each voucher */}
                      <td
                        className={tdClass("left", "whitespace-nowrap tabular-nums text-ink-muted")}
                      >
                        {isFirst ? fmtDate(voucher.date) : ""}
                      </td>
                      <td className={tdClass("left", "font-semibold tabular-nums text-accent")}>
                        {isFirst ? displayVoucherNo(voucher.voucherNo) : ""}
                      </td>
                      <td className={tdClass("left", `font-medium ${cr > 0 ? "pl-10" : ""}`)}>
                        {cr > 0 && <span className="mr-1 text-ink-subtle">To</span>}
                        {accountLabel || "—"}
                      </td>
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
                    colSpan={3}
                    className="px-4 py-3 text-right text-[13px] font-semibold text-ink-muted"
                  >
                    <span className="float-left font-medium text-ink-subtle">
                      Row {selectedIndex} of {flatRows.length}
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
    </div>
  );
};

export default JournalEntryPage;
