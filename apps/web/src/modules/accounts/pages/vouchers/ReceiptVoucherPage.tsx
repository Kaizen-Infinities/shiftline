import React, { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, SlidersHorizontal, ArrowDownLeft } from "lucide-react";
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

// Busy-style filter options shown BEFORE the list opens.
interface FilterOptions {
  voucherSeries: string;
  startDate: string;
  endDate: string;
  accountShownBy: "Name" | "Alias" | "Code";
  showNarration: boolean;
  showAmount: boolean;
  showReceiptMode: boolean;
}

const todayIso = () => new Date().toISOString().split("T")[0];

// Busy defaults: dates prefilled to today, Account shown by = "Alias"
// (Busy's Receipt filter defaults to Alias, unlike Payment which uses Name).
const defaultFilters = (): FilterOptions => ({
  voucherSeries: "Main",
  startDate: todayIso(),
  endDate: todayIso(),
  accountShownBy: "Alias",
  showNarration: true,
  showAmount: true,
  showReceiptMode: true,
});

const ReceiptVoucherPage: React.FC = () => {
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

  const cacheKey = `accounts:receipt-vouchers:${applied.startDate}:${applied.endDate}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      try {
        const res = await voucherService.fetchVouchers({
          type: "RECEIPT",
          startDate: applied.startDate || undefined,
          endDate: applied.endDate || undefined,
          page: 1,
          limit: 10000,
        });
        return { data: res.vouchers || [], total: res.total || res.vouchers?.length || 0 };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load receipt vouchers");
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
  } = useListCache<Voucher>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
  });

  const grandTotal = useMemo(
    () =>
      vouchers.reduce(
        (s, v) => s + v.items.reduce((si, i) => si + Number(i.debitAmount || 0), 0),
        0
      ),
    [vouchers]
  );

  const openFilters = () => {
    setPending(applied);
    setPanelOpen(true);
  };

  const newButton = (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/accounts/receipt-voucher/add")}>
      New Receipt
    </ActionPill>
  );

  // ────── Busy-style pre-list options (F2 = show, Esc = close) ──────
  if (panelOpen) {
    return (
      <div className="w-full">
        <PageHeader
          title="Receipt Register"
          subtitle="Money received into your bank and cash accounts"
          icon={<ArrowDownLeft size={20} />}
          primaryAction={newButton}
        >
          <VoucherTypeNav current="RECEIPT" />
        </PageHeader>
        <RegisterOptionsCard
          onOk={() => {
            setApplied(pending);
            setPanelOpen(false);
          }}
        >
          <OptionRow label="Voucher series" htmlFor="rv-series">
            <input
              id="rv-series"
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
          <OptionRow label="Account shown by" htmlFor="rv-shown-by">
            <select
              id="rv-shown-by"
              value={pending.accountShownBy}
              onChange={(e) =>
                setPending({
                  ...pending,
                  accountShownBy: e.target.value as "Name" | "Alias" | "Code",
                })
              }
              className={optionInputClass}
            >
              <option value="Alias">Alias</option>
              <option value="Name">Name</option>
              <option value="Code">Code</option>
            </select>
          </OptionRow>
          <YesNo
            label="Show receipt mode?"
            value={pending.showReceiptMode}
            onChange={(v) => setPending({ ...pending, showReceiptMode: v })}
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

  // ────── Receipt Register (list) ──────
  const preAmountCols = 2 + (applied.showReceiptMode ? 1 : 0) + 1;
  const selectedIndex = selectedRow ? vouchers.findIndex((v) => v.id === selectedRow) + 1 : 0;
  const firstLoad = loading && vouchers.length === 0;

  return (
    <div className="w-full">
      <PageHeader
        title="Receipt Register"
        subtitle={
          <>
            Series {applied.voucherSeries} · {fmtDate(applied.startDate)} to{" "}
            {fmtDate(applied.endDate)}
          </>
        }
        icon={<ArrowDownLeft size={20} />}
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
        <VoucherTypeNav current="RECEIPT" />
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Vouchers" value={total} loading={firstLoad} />
        <StatTile
          label="Total received"
          value={<span title={fmtINR(grandTotal)}>{fmtINRCompact(grandTotal)}</span>}
          loading={firstLoad}
        />
      </div>

      <section className="sl-tile overflow-hidden" aria-label="Receipt vouchers">
        {vouchers.length === 0 ? (
          loading ? (
            <SkeletonRows rows={6} columns={5} label="Loading receipt vouchers" />
          ) : (
            <EmptyState
              title="No receipt vouchers in this period"
              description="Widen the dates with Change filters, or record a new receipt."
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
                  {applied.showReceiptMode && (
                    <th scope="col" className={thClass()}>
                      Received in
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
                  // Receipt direction: credit = payer (customer), debit = bank/cash
                  const payerLabel = v.items
                    .map((i) =>
                      applied.accountShownBy === "Code"
                        ? i.creditLedger?.code
                        : i.creditLedger?.name
                    )
                    .filter(Boolean)
                    .join(", ");
                  const modeLabel =
                    applied.accountShownBy === "Code"
                      ? v.items[0]?.debitLedger?.code
                      : v.items[0]?.debitLedger?.name;
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
                      {applied.showReceiptMode && (
                        <td className={tdClass()}>
                          {modeLabel ? <Chip size="sm">{modeLabel}</Chip> : "—"}
                        </td>
                      )}
                      <td className={tdClass("left", "font-medium")}>{payerLabel || "—"}</td>
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

export default ReceiptVoucherPage;
