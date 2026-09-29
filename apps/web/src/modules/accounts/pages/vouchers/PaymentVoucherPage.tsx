import React, { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, SlidersHorizontal, ArrowUpRight } from "lucide-react";
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
  Chip,
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

// Busy-style filter options shown BEFORE the list opens. Kept as its own
// piece of state so the operator can re-open the panel with "Change Filters".
interface FilterOptions {
  voucherSeries: string;
  startDate: string;
  endDate: string;
  accountShownBy: "Name" | "Code";
  showNarration: boolean;
  showAmount: boolean;
  showPaidFrom: boolean;
}

const todayIso = () => new Date().toISOString().split("T")[0];

// Busy behaviour: List of Payment Vouchers opens with both Starting and
// Ending Date pre-filled to today. Operator hits F2 to see just today's
// entries; they widen the range only if they need history.
const defaultFilters = (): FilterOptions => ({
  voucherSeries: "Main",
  startDate: todayIso(),
  endDate: todayIso(),
  accountShownBy: "Name",
  showNarration: true,
  showAmount: true,
  showPaidFrom: true,
});

const PaymentVoucherPage: React.FC = () => {
  const navigate = useNavigate();

  // Applied filters drive the actual data fetch; pending filters live inside
  // the panel until OK is pressed.
  const [applied, setApplied] = useState<FilterOptions>(() => defaultFilters());
  const [pending, setPending] = useState<FilterOptions>(() => defaultFilters());
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  // F2 = OK inside the filter panel (matches Busy shortcut).
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

  const cacheKey = `accounts:payment-vouchers:${applied.startDate}:${applied.endDate}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      try {
        const res = await voucherService.fetchVouchers({
          type: "PAYMENT",
          startDate: applied.startDate || undefined,
          endDate: applied.endDate || undefined,
          page: 1,
          limit: 10000,
        });
        return { data: res.vouchers || [], total: res.total || res.vouchers?.length || 0 };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load payment vouchers");
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

  // Sum of all voucher totals — memoised to avoid re-summing on unrelated
  // renders. MUST live above the early return below so hook order is stable
  // between the "filter panel" and "list" branches.
  const grandTotal = useMemo(
    () =>
      vouchers.reduce(
        (s, v) => s + v.items.reduce((si, i) => si + Number(i.debitAmount || 0), 0),
        0
      ),
    [vouchers]
  );

  const newButton = (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/accounts/payment-voucher/add")}>
      New Payment
    </ActionPill>
  );

  // ────── Busy-style pre-list options (F2 = show, Esc = close) ──────
  if (panelOpen) {
    return (
      <div className="w-full">
        <PageHeader
          title="Payment Register"
          subtitle="Money paid out of your bank and cash accounts"
          icon={<ArrowUpRight size={20} />}
          primaryAction={newButton}
        >
          <VoucherTypeNav current="PAYMENT" />
        </PageHeader>
        <RegisterOptionsCard
          onOk={() => {
            setApplied(pending);
            setPanelOpen(false);
          }}
        >
          <OptionRow label="Voucher series" htmlFor="pv-series">
            <input
              id="pv-series"
              type="text"
              value={pending.voucherSeries}
              onChange={(e) => setPending({ ...pending, voucherSeries: e.target.value })}
              className={optionInputClass}
            />
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
          <OptionRow label="Account shown by" htmlFor="pv-shown-by">
            <select
              id="pv-shown-by"
              value={pending.accountShownBy}
              onChange={(e) =>
                setPending({ ...pending, accountShownBy: e.target.value as "Name" | "Code" })
              }
              className={optionInputClass}
            >
              <option value="Name">Name</option>
              <option value="Code">Code</option>
            </select>
          </OptionRow>
          <YesNo
            label="Show paid from?"
            value={pending.showPaidFrom}
            onChange={(v) => setPending({ ...pending, showPaidFrom: v })}
          />
          <YesNo
            label="Show short narration?"
            value={pending.showNarration}
            onChange={(v) => setPending({ ...pending, showNarration: v })}
          />
          <YesNo
            label="Show amount?"
            value={pending.showAmount}
            onChange={(v) => setPending({ ...pending, showAmount: v })}
          />
        </RegisterOptionsCard>
      </div>
    );
  }

  // ────── Payment Register (list) ──────
  // Column count for footer colSpan (Date + Vch + Mode? + Account = 3 or 4)
  const preAmountCols = 2 + (applied.showPaidFrom ? 1 : 0) + 1;
  const selectedIndex = selectedRow ? vouchers.findIndex((v) => v.id === selectedRow) + 1 : 0;
  const firstLoad = loading && vouchers.length === 0;

  return (
    <div className="w-full">
      <PageHeader
        title="Payment Register"
        subtitle={
          <>
            Series {applied.voucherSeries} · {fmtDate(applied.startDate)} to{" "}
            {fmtDate(applied.endDate)}
          </>
        }
        icon={<ArrowUpRight size={20} />}
        primaryAction={newButton}
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
      >
        <VoucherTypeNav current="PAYMENT" />
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Vouchers" value={total} loading={firstLoad} />
        <StatTile
          label="Total paid"
          value={<span title={fmtINR(grandTotal)}>{fmtINRCompact(grandTotal)}</span>}
          loading={firstLoad}
        />
      </div>

      <section className="sl-tile overflow-hidden" aria-label="Payment vouchers">
        {listError && !loading && vouchers.length > 0 && (
          <StaleNotice onRetry={refresh} className="m-3" />
        )}
        {vouchers.length === 0 ? (
          listError && !loading ? (
            <LoadError compact title="Couldn't load payment vouchers" onRetry={refresh} />
          ) : loading ? (
            <SkeletonRows rows={6} columns={5} label="Loading payment vouchers" />
          ) : (
            <EmptyState
              title="No payment vouchers in this period"
              description="Widen the dates with Change filters, or record a new payment."
              action={
                <ActionPill
                  variant="secondary"
                  icon={<SlidersHorizontal size={16} />}
                  onClick={() => {
                    setPending(applied);
                    setPanelOpen(true);
                  }}
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
                  {applied.showPaidFrom && (
                    <th scope="col" className={thClass()}>
                      Paid from
                    </th>
                  )}
                  <th scope="col" className={thClass()}>
                    Account
                  </th>
                  {applied.showAmount && (
                    <th scope="col" className={thClass("right", "w-40")}>
                      Amount (₹)
                    </th>
                  )}
                  {applied.showNarration && (
                    <th scope="col" className={thClass()}>
                      Narration
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => {
                  const voucherTotal = v.items.reduce((s, i) => s + Number(i.debitAmount || 0), 0);
                  const debitLabel = v.items
                    .map((i) =>
                      applied.accountShownBy === "Code" ? i.debitLedger?.code : i.debitLedger?.name
                    )
                    .filter(Boolean)
                    .join(", ");
                  const creditLabel =
                    applied.accountShownBy === "Code"
                      ? v.items[0]?.creditLedger?.code
                      : v.items[0]?.creditLedger?.name;
                  const isSelected = selectedRow === v.id;
                  return (
                    <tr
                      key={v.id}
                      onClick={() => setSelectedRow(v.id)}
                      aria-selected={isSelected}
                      className={`cursor-pointer border-b border-line-soft last:border-b-0 ${
                        isSelected ? "bg-nav-active" : "sl-row-hover"
                      }`}
                    >
                      <td
                        className={tdClass("left", "whitespace-nowrap tabular-nums text-ink-muted")}
                      >
                        {fmtDate(v.date)}
                      </td>
                      <td className={tdClass("left", "font-semibold tabular-nums text-accent")}>
                        {displayVoucherNo(v.voucherNo)}
                      </td>
                      {applied.showPaidFrom && (
                        <td className={tdClass()}>
                          {creditLabel ? <Chip size="sm">{creditLabel}</Chip> : "—"}
                        </td>
                      )}
                      <td className={tdClass("left", "font-medium")}>{debitLabel || "—"}</td>
                      {applied.showAmount && (
                        <td className={tdClass("right", "font-semibold")}>
                          {fmtAmt(voucherTotal)}
                        </td>
                      )}
                      {applied.showNarration && (
                        <td className={tdClass("left", "max-w-xs truncate text-ink-muted")}>
                          {v.narration || "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {applied.showAmount && (
                <tfoot className="sticky bottom-0 z-[1]">
                  <tr className="border-t border-line bg-card-2">
                    <td
                      colSpan={preAmountCols}
                      className="px-4 py-3 text-right text-[13px] font-semibold text-ink-muted"
                    >
                      <span className="float-left font-medium text-ink-subtle">
                        Row {selectedIndex} of {vouchers.length}
                      </span>
                      Total ({vouchers.length})
                    </td>
                    <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums text-ink">
                      {fmtINR(grandTotal)}
                    </td>
                    {applied.showNarration && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default PaymentVoucherPage;
