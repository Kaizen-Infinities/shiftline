import React, { useState, useCallback, useRef, useEffect } from "react";
import { useFormShortcuts } from "../../../../hooks/useFormShortcuts";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Plus } from "lucide-react";
import {
  ActionPill,
  Chip,
  Field,
  PageHeader,
  Tile,
  fieldControlClass,
  StaleNotice,
} from "../../../../components/ui/v2";
import {
  EntryFooter,
  Kbd,
  KeyHints,
  VOUCHER_KINDS,
  VoucherTypeNav,
  ctrlEnterSubmit,
  fmtINR,
  gridInputClass,
  gridLedgerCellClass,
  gridThClass,
} from "../../components/accountsUi";
import { toast } from "react-toastify";
import {
  voucherService,
  displayVoucherNo,
  type Voucher,
} from "../../../../services/voucherService";
import { accountService, type AccountLedger } from "../../../../services/accountService";
import { msmeService, type MsmePaymentWarning } from "../../../../services/msmeService";
import LedgerSearchInput, {
  isBankOrCashLedger,
} from "../../../../components/form/LedgerSearchInput/LedgerSearchInput";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { useListCache, prependToListCacheByPrefix } from "../../../../hooks/useListCache";

interface PaymentRow {
  id: number;
  debitLedgerId: string;
  amount: string;
  narration: string;
}

let rowCounter = 1;

// Busy-style: 17 empty rows pre-visible so the data-entry operator can tab
// through them without clicking "Add Row" per transaction.
const INITIAL_ROW_COUNT = 17;

const makeEmptyRow = (): PaymentRow => ({
  id: rowCounter++,
  debitLedgerId: "",
  amount: "",
  narration: "",
});

const PaymentVoucherAddPage: React.FC = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [creditLedgerId, setCreditLedgerId] = useState("");
  const [mainNarration, setMainNarration] = useState("");
  const [nextVoucherNo, setNextVoucherNo] = useState<string>("");

  useFormShortcuts({});

  // Fetch the next sequential voucher number so it can be shown Busy-style
  // ("Vch No. 5"). We re-fetch after a save happens (see handleSubmit) so
  // the operator sees the next number ready for another entry.
  useEffect(() => {
    let cancelled = false;
    voucherService
      .fetchNextVoucherNo("PAYMENT")
      .then((no) => {
        if (!cancelled) setNextVoucherNo(no);
      })
      .catch(() => {
        if (!cancelled) setNextVoucherNo("");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [rows, setRows] = useState<PaymentRow[]>(() =>
    Array.from({ length: INITIAL_ROW_COUNT }, makeEmptyRow)
  );

  const ledgersFetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await accountService.fetchLedgers({ limit: 1000 });
    const list = res.ledgers || [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: ledgers,
    error: listError,
    refresh: retryList,
  } = useListCache<AccountLedger>({
    cacheKey: "accounts:ledgers:all",
    socketModule: "accountLedger",
    fetcher: ledgersFetcher,
  });

  const paidFromLedger = ledgers.find((l) => String(l.id) === creditLedgerId);

  // P2-10: as soon as a payee with a supplier ledger is picked, ask the MSME clock whether this
  // payment run is about to make a small supplier's bill go overdue. Never blocks the payment.
  const [msmeWarning, setMsmeWarning] = useState<MsmePaymentWarning | null>(null);
  const payeeSupplierIds = Array.from(
    new Set(
      rows
        .map((r) => ledgers.find((l) => String(l.id) === r.debitLedgerId)?.supplierId)
        .filter((id): id is number => typeof id === "number")
    )
  );
  const payeeSupplierKey = payeeSupplierIds.join(",");
  useEffect(() => {
    if (payeeSupplierIds.length === 0) {
      setMsmeWarning(null);
      return;
    }
    let cancelled = false;
    // One payee at a time is the common case; the first supplier row drives the warning.
    msmeService
      .paymentWarning(payeeSupplierIds[0])
      .then((w) => {
        if (!cancelled) setMsmeWarning(w);
      })
      .catch(() => {
        if (!cancelled) setMsmeWarning(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payeeSupplierKey]);

  // Cur.Bal for the selected Payment Mode account, as of the entry date.
  // Fetched from the ledger statement (closingBalance up to that date).
  // For an ASSET ledger (bank/cash), positive = Dr (money in hand),
  // negative = Cr (overdraft). Busy shows "0.08 Dr" / "999.92 Cr".
  const [paidFromBalance, setPaidFromBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!creditLedgerId) {
      setPaidFromBalance(null);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    accountService
      .fetchStatement(parseInt(creditLedgerId, 10), { endDate: date })
      .then((res) => {
        if (!cancelled) setPaidFromBalance(res.closingBalance ?? 0);
      })
      .catch(() => {
        if (!cancelled) setPaidFromBalance(null);
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [creditLedgerId, date]);

  const formatBalance = (bal: number) => {
    const abs = Math.abs(bal).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${abs} ${bal >= 0 ? "Dr" : "Cr"}`;
  };

  // Busy-style keyboard navigation. Every editable cell is tagged with
  // data-cell="rowIdx-field". focusCell() queries the container and focuses
  // the input inside. LedgerSearchInput cells are wrapped in a div, so we
  // pick the underlying <input>.
  const tableRef = useRef<HTMLDivElement>(null);

  const focusCell = (rowIdx: number, field: "account" | "amount" | "narration") => {
    if (!tableRef.current) return;
    const wrap = tableRef.current.querySelector<HTMLElement>(`[data-cell="${rowIdx}-${field}"]`);
    if (!wrap) return;
    const el = wrap.tagName === "INPUT" ? (wrap as HTMLInputElement) : wrap.querySelector("input");
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
  };

  const addRow = () => {
    setRows((prev) => [...prev, makeEmptyRow()]);
  };

  const handleAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      focusCell(rowIdx, "narration");
    }
  };

  const handleNarrationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Last row → add a new one, then focus its account
      if (rowIdx === rows.length - 1) {
        addRow();
        // Wait for React to render the new row before focusing
        setTimeout(() => focusCell(rowIdx + 1, "account"), 0);
      } else {
        focusCell(rowIdx + 1, "account");
      }
    }
  };

  const updateRow = (id: number, field: keyof PaymentRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  // Busy behaviour: after save, wipe the entry rows so the operator can key
  // the next voucher without leaving the page. Date + Payment Mode are kept
  // (batch data-entry keeps the same bank / same day). Vch No is re-fetched
  // so the top shows the next sequential number ready to go.
  const resetFormForNext = () => {
    setMainNarration("");
    setRows(Array.from({ length: INITIAL_ROW_COUNT }, makeEmptyRow));
    voucherService
      .fetchNextVoucherNo("PAYMENT")
      .then(setNextVoucherNo)
      .catch(() => setNextVoucherNo(""));
    setTimeout(() => focusCell(0, "account"), 0);
  };

  const totalAmount = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const validCount = rows.filter((r) => r.debitLedgerId && parseFloat(r.amount) > 0).length;

  // Busy rule: row N is editable only if all rows 0..N-1 have account+amount.
  // The first "unlocked" row is the current data-entry frontier.
  const isRowComplete = (r: PaymentRow) => !!r.debitLedgerId && parseFloat(r.amount) > 0;
  const isRowUnlocked = (idx: number): boolean => {
    for (let i = 0; i < idx; i++) {
      if (!isRowComplete(rows[i])) return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!creditLedgerId) {
      toast.error("Select 'Payment Mode' (Bank / Cash) account");
      return;
    }

    const validRows = rows.filter((r) => r.debitLedgerId && parseFloat(r.amount) > 0);
    if (validRows.length === 0) {
      toast.error("Add at least one payment entry with account and amount");
      return;
    }

    for (const r of validRows) {
      if (r.debitLedgerId === creditLedgerId) {
        toast.error("'Paid To' and 'Payment Mode' cannot be the same account");
        return;
      }
    }

    // Busy-style negative-balance guard: if the total we are about to pay
    // out exceeds the current Payment Mode balance, ask the user to confirm.
    // (Non-blocking — user can proceed, matching Busy's Yes/No dialog.)
    const total = validRows.reduce((s, r) => s + parseFloat(r.amount), 0);
    if (paidFromBalance !== null && total > paidFromBalance) {
      const shortfall = total - paidFromBalance;
      const shortfallStr = shortfall.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const proceed = window.confirm(
        `Cash / Bank balance is going negative ( Rs. -${shortfallStr} ).\n\nWould you like to continue?`
      );
      if (!proceed) return;
    }

    setSubmitting(true);
    try {
      const created = await voucherService.createVoucher({
        type: "PAYMENT",
        date,
        narration: mainNarration || "Payment Voucher",
        items: validRows.map((r) => ({
          debitLedgerId: parseInt(r.debitLedgerId, 10),
          creditLedgerId: parseInt(creditLedgerId, 10),
          debitAmount: parseFloat(r.amount),
          creditAmount: parseFloat(r.amount),
          narration: r.narration || mainNarration || "Payment",
        })),
      });
      // Optimistic list update — the Payment Register cache gets the new
      // voucher immediately, so navigating back shows it with no reload.
      if (created?.id) {
        prependToListCacheByPrefix<Voucher>("accounts:payment-vouchers:", created);
      }
      toast.success("Payment voucher saved successfully");
      resetFormForNext();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const msmeText =
    msmeWarning && msmeWarning.count > 0
      ? msmeWarning.type === "PAYEE_SMALL"
        ? `This is a micro/small supplier: ${msmeWarning.count} bill(s) worth ${fmtINR(msmeWarning.amount)} are due within 5 days or already overdue on the section 15 clock.`
        : `${msmeWarning.count} bill(s) to other micro/small suppliers, worth ${fmtINR(msmeWarning.amount)}, are about to breach the section 15 clock — this payment is money that could have gone to them instead.`
      : null;

  return (
    <form onSubmit={handleSubmit} onKeyDown={ctrlEnterSubmit} className="w-full">
      <PageHeader
        title="New payment voucher"
        subtitle={VOUCHER_KINDS.PAYMENT.hint}
        back="/accounts/payment-voucher"
        backLabel="Back to payment register"
        breadcrumbs={[
          { label: "Accounts" },
          { label: "Payment Register", to: "/accounts/payment-voucher" },
          { label: "New" },
        ]}
        meta={
          <Chip tone="muted">Vch no. {nextVoucherNo ? displayVoucherNo(nextVoucherNo) : "…"}</Chip>
        }
      >
        <VoucherTypeNav current="PAYMENT" target="add" />
      </PageHeader>

      {listError && ledgers.length === 0 && (
        <StaleNotice onRetry={retryList}>
          Couldn't load your ledgers, so the account lists below are empty.
        </StaleNotice>
      )}

      {msmeText && (
        <div
          role="status"
          className="sl-tile mb-4 flex items-start gap-3 border-[color:var(--color-warning)] px-4 py-3"
        >
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-[color:var(--color-warning)]"
            aria-hidden="true"
          />
          <p className="m-0 text-sm text-ink">
            <span className="font-semibold">MSME payment clock. </span>
            {msmeText}
          </p>
        </div>
      )}

      <Tile title="Voucher details" className="mb-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(0,1fr)]">
          <DatePickerCalendar
            name="date"
            label="Date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <div>
            <LedgerSearchInput
              label="Payment mode (bank / cash)"
              value={creditLedgerId}
              ledgers={ledgers}
              onChange={setCreditLedgerId}
              placeholder="Search bank / cash..."
              required
              filterFn={isBankOrCashLedger}
              accentColor="red-500"
              onSelected={() => focusCell(0, "account")}
            />
            {paidFromLedger && (
              <p className="m-0 mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
                <span>{paidFromLedger.group}</span>
                {balanceLoading ? (
                  <span
                    className="sl-skeleton inline-block h-3 w-24"
                    aria-label="Loading balance"
                  />
                ) : paidFromBalance !== null ? (
                  <Chip size="sm" tone={paidFromBalance < 0 ? "danger" : "success"}>
                    Cur. bal. {formatBalance(paidFromBalance)}
                  </Chip>
                ) : null}
              </p>
            )}
          </div>
          <Field
            label="Narration"
            className="md:col-span-2 xl:col-span-1"
            hint="Used for every line that has no narration of its own"
          >
            <input
              type="text"
              value={mainNarration}
              onChange={(e) => setMainNarration(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusCell(0, "account");
                }
              }}
              className={fieldControlClass()}
            />
          </Field>
        </div>
      </Tile>

      <Tile padding="none" title="Paid to" subtitle="One line per account paid" divider>
        <div className="overflow-x-auto" ref={tableRef}>
          <table className="w-full min-w-[640px] border-collapse text-[14px]">
            <thead>
              <tr>
                <th scope="col" className={gridThClass("center", "w-12")}>
                  #
                </th>
                <th scope="col" className={gridThClass("left")}>
                  Account
                </th>
                <th scope="col" className={gridThClass("right", "w-44")}>
                  Amount (₹)
                </th>
                <th scope="col" className={gridThClass("left", "w-[30%]")}>
                  Short narration
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const unlocked = isRowUnlocked(idx);
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-line-soft last:border-b-0 ${unlocked ? "" : "bg-card-2/40"}`}
                  >
                    <td
                      className={`w-12 text-center text-[12px] tabular-nums ${unlocked ? "text-ink-muted" : "text-ink-subtle/60"}`}
                    >
                      {idx + 1}
                    </td>
                    <td className="border-l border-line-soft">
                      <div data-cell={`${idx}-account`} className={gridLedgerCellClass}>
                        <LedgerSearchInput
                          value={row.debitLedgerId}
                          ledgers={ledgers}
                          onChange={(val) => updateRow(row.id, "debitLedgerId", val)}
                          placeholder={unlocked ? "Type to search ledgers" : ""}
                          filterFn={(l) => !isBankOrCashLedger(l)}
                          accentColor="red-500"
                          variant="cell"
                          onSelected={() => focusCell(idx, "amount")}
                          disabled={!unlocked}
                        />
                      </div>
                    </td>
                    <td className="w-44 border-l border-line-soft">
                      <input
                        data-cell={`${idx}-amount`}
                        aria-label={`Line ${idx + 1} amount`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={row.amount}
                        onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                        onKeyDown={(e) => handleAmountKeyDown(e, idx)}
                        disabled={!unlocked}
                        className={gridInputClass(!unlocked, "text-right tabular-nums")}
                      />
                    </td>
                    <td className="border-l border-line-soft">
                      <input
                        data-cell={`${idx}-narration`}
                        aria-label={`Line ${idx + 1} narration`}
                        type="text"
                        value={row.narration}
                        onChange={(e) => updateRow(row.id, "narration", e.target.value)}
                        onKeyDown={(e) => handleNarrationKeyDown(e, idx)}
                        disabled={!unlocked}
                        className={gridInputClass(!unlocked)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-card-2">
                <td colSpan={2} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={addRow}
                    className="sl-btn-ghost sl-pill-sm text-accent"
                  >
                    <Plus size={15} aria-hidden="true" /> Add line
                  </button>
                </td>
                <td className="px-3 py-2 text-right text-[15px] font-bold tabular-nums text-ink">
                  {fmtINR(totalAmount)}
                </td>
                <td className="px-3 py-2 text-[12px] text-ink-muted">{validCount} valid entries</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Tile>

      <EntryFooter
        hints={
          <KeyHints
            hints={[
              [<Kbd key="enter">Enter</Kbd>, "/ Tab next cell"],
              [<Kbd key="arrows">↑↓</Kbd>, "in the ledger list"],
              [
                <span key="save" className="inline-flex gap-1">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>Enter</Kbd>
                </span>,
                "save",
              ],
            ]}
          />
        }
      >
        <div className="mr-2 hidden text-right sm:block">
          <div className="text-[12px] text-ink-subtle">Total</div>
          <div className="text-lg font-bold tabular-nums text-ink">{fmtINR(totalAmount)}</div>
        </div>
        <ActionPill variant="secondary" onClick={() => navigate("/accounts/payment-voucher")}>
          Quit
        </ActionPill>
        <ActionPill type="submit" loading={submitting} loadingText="Saving...">
          Save Payment
        </ActionPill>
      </EntryFooter>
    </form>
  );
};

export default PaymentVoucherAddPage;
