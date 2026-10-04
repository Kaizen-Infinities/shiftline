import React, { useState, useCallback, useRef, useEffect } from "react";
import { useFormShortcuts } from "../../../../hooks/useFormShortcuts";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
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
import LedgerSearchInput, {
  isBankOrCashLedger,
} from "../../../../components/form/LedgerSearchInput/LedgerSearchInput";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { useListCache, prependToListCacheByPrefix } from "../../../../hooks/useListCache";

// Receipt = money coming IN. Direction reversed from Payment:
//   debitLedgerId  = Bank/Cash where the money lands ("Received In")
//   creditLedgerId = Customer / Income account that paid us ("Received From")
interface ReceiptRow {
  id: number;
  creditLedgerId: string;
  amount: string;
  narration: string;
}

let rowCounter = 1;
const INITIAL_ROW_COUNT = 17;

const makeEmptyRow = (): ReceiptRow => ({
  id: rowCounter++,
  creditLedgerId: "",
  amount: "",
  narration: "",
});

const ReceiptVoucherAddPage: React.FC = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [debitLedgerId, setDebitLedgerId] = useState("");
  const [mainNarration, setMainNarration] = useState("");
  const [nextVoucherNo, setNextVoucherNo] = useState<string>("");
  const [rows, setRows] = useState<ReceiptRow[]>(() =>
    Array.from({ length: INITIAL_ROW_COUNT }, makeEmptyRow)
  );

  useFormShortcuts({});

  // Peek next Vch No so the operator sees "R-5" waiting for them
  useEffect(() => {
    let cancelled = false;
    voucherService
      .fetchNextVoucherNo("RECEIPT")
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

  const receivedInLedger = ledgers.find((l) => String(l.id) === debitLedgerId);

  // Cur.Bal for the "Received In" account, as of entry date. In Busy this
  // shows just so the operator sees the current cash/bank position before
  // recording the receipt.
  const [receivedInBalance, setReceivedInBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!debitLedgerId) {
      setReceivedInBalance(null);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    accountService
      .fetchStatement(parseInt(debitLedgerId, 10), { endDate: date })
      .then((res) => {
        if (!cancelled) setReceivedInBalance(res.closingBalance ?? 0);
      })
      .catch(() => {
        if (!cancelled) setReceivedInBalance(null);
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debitLedgerId, date]);

  const formatBalance = (bal: number) => {
    const abs = Math.abs(bal).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${abs} ${bal >= 0 ? "Dr" : "Cr"}`;
  };

  // Keyboard nav — same pattern as Payment: account → amount → narration → next row
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
      if (rowIdx === rows.length - 1) {
        addRow();
        setTimeout(() => focusCell(rowIdx + 1, "account"), 0);
      } else {
        focusCell(rowIdx + 1, "account");
      }
    }
  };

  const updateRow = (id: number, field: keyof ReceiptRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const totalAmount = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const validCount = rows.filter((r) => r.creditLedgerId && parseFloat(r.amount) > 0).length;

  const isRowComplete = (r: ReceiptRow) => !!r.creditLedgerId && parseFloat(r.amount) > 0;
  const isRowUnlocked = (idx: number): boolean => {
    for (let i = 0; i < idx; i++) {
      if (!isRowComplete(rows[i])) return false;
    }
    return true;
  };

  // Busy behaviour: after save, wipe the entry rows so the operator can key
  // the next voucher without leaving the page. Date + Receipt Mode are kept
  // (batch data-entry keeps the same bank / same day). Vch No is re-fetched.
  const resetFormForNext = () => {
    setMainNarration("");
    setRows(Array.from({ length: INITIAL_ROW_COUNT }, makeEmptyRow));
    voucherService
      .fetchNextVoucherNo("RECEIPT")
      .then(setNextVoucherNo)
      .catch(() => setNextVoucherNo(""));
    setTimeout(() => focusCell(0, "account"), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!debitLedgerId) {
      toast.error("Select 'Receipt Mode' (Bank / Cash) account");
      return;
    }

    const validRows = rows.filter((r) => r.creditLedgerId && parseFloat(r.amount) > 0);
    if (validRows.length === 0) {
      toast.error("Add at least one receipt entry with account and amount");
      return;
    }

    for (const r of validRows) {
      if (r.creditLedgerId === debitLedgerId) {
        toast.error("'Received From' and 'Receipt Mode' cannot be the same account");
        return;
      }
    }

    // Receipts increase our bank/cash balance so we do NOT need a
    // negative-cash guard (unlike Payment). Just save.

    setSubmitting(true);
    try {
      const created = await voucherService.createVoucher({
        type: "RECEIPT",
        date,
        narration: mainNarration || "Receipt Voucher",
        items: validRows.map((r) => ({
          debitLedgerId: parseInt(debitLedgerId, 10),
          creditLedgerId: parseInt(r.creditLedgerId, 10),
          debitAmount: parseFloat(r.amount),
          creditAmount: parseFloat(r.amount),
          narration: r.narration || mainNarration || "Receipt",
        })),
      });
      // Optimistic list update — Receipt Register cache gets the new voucher
      // immediately, so navigating back shows it with no reload.
      if (created?.id) {
        prependToListCacheByPrefix<Voucher>("accounts:receipt-vouchers:", created);
      }
      toast.success("Receipt voucher saved successfully");
      resetFormForNext();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} onKeyDown={ctrlEnterSubmit} className="w-full">
      <PageHeader
        title="New receipt voucher"
        subtitle={VOUCHER_KINDS.RECEIPT.hint}
        back="/accounts/receipt-voucher"
        backLabel="Back to receipt register"
        breadcrumbs={[
          { label: "Accounts" },
          { label: "Receipt vouchers", to: "/accounts/receipt-voucher" },
          { label: "New" },
        ]}
        meta={
          <Chip tone="muted">Vch no. {nextVoucherNo ? displayVoucherNo(nextVoucherNo) : "…"}</Chip>
        }
      >
        <VoucherTypeNav current="RECEIPT" target="add" />
      </PageHeader>

      {listError && ledgers.length === 0 && (
        <StaleNotice onRetry={retryList}>
          Couldn't load your ledgers, so the account lists below are empty.
        </StaleNotice>
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
              label="Received in (bank / cash)"
              value={debitLedgerId}
              ledgers={ledgers}
              onChange={setDebitLedgerId}
              placeholder="Search bank / cash..."
              required
              filterFn={isBankOrCashLedger}
              accentColor="emerald-500"
              onSelected={() => focusCell(0, "account")}
            />
            {receivedInLedger && (
              <p className="m-0 mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
                <span>{receivedInLedger.group}</span>
                {balanceLoading ? (
                  <span
                    className="sl-skeleton inline-block h-3 w-24"
                    aria-label="Loading balance"
                  />
                ) : receivedInBalance !== null ? (
                  <Chip size="sm" tone={receivedInBalance < 0 ? "danger" : "success"}>
                    Cur. bal. {formatBalance(receivedInBalance)}
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

      <Tile
        padding="none"
        title="Received from"
        subtitle="One line per account that paid you"
        divider
      >
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
                          value={row.creditLedgerId}
                          ledgers={ledgers}
                          onChange={(val) => updateRow(row.id, "creditLedgerId", val)}
                          placeholder={unlocked ? "Type to search ledgers" : ""}
                          ariaLabel={`Account, line ${idx + 1}`}
                          filterFn={(l) => !isBankOrCashLedger(l)}
                          accentColor="emerald-500"
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
        <ActionPill variant="secondary" onClick={() => navigate("/accounts/receipt-voucher")}>
          Quit
        </ActionPill>
        <ActionPill type="submit" loading={submitting} loadingText="Saving...">
          Save Receipt
        </ActionPill>
      </EntryFooter>
    </form>
  );
};

export default ReceiptVoucherAddPage;
