import React, { useState, useCallback, useRef } from "react";
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
} from "../../../../components/ui/v2";
import {
  BalanceSummary,
  EntryFooter,
  Kbd,
  KeyHints,
  VOUCHER_KINDS,
  VoucherTypeNav,
  ctrlEnterSubmit,
  fmtAmt,
  gridInputClass,
  gridLedgerCellClass,
  gridThClass,
} from "../../components/accountsUi";
import { toast } from "react-toastify";
import { voucherService, type Voucher } from "../../../../services/voucherService";
import { accountService, type AccountLedger } from "../../../../services/accountService";
import LedgerSearchInput from "../../../../components/form/LedgerSearchInput/LedgerSearchInput";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { useListCache, prependToListCacheByPrefix } from "../../../../hooks/useListCache";

// Journal = free-form debit/credit entries. Unlike Payment/Receipt there is
// no fixed "Mode" account; every row picks its own ledger AND its own side
// (D or C). Trial balance closes only when Σ Debit == Σ Credit.
interface JournalRow {
  id: number;
  dc: "D" | "C";
  ledgerId: string;
  amount: string;
  narration: string;
}

let rowCounter = 1;
const INITIAL_ROW_COUNT = 17;

// Alternating D/C for the seed rows matches Busy's convention (first row
// defaults to Debit; the operator commonly flips subsequent rows to C).
const makeEmptyRow = (idx: number): JournalRow => ({
  id: rowCounter++,
  dc: idx === 0 ? "D" : "C",
  ledgerId: "",
  amount: "",
  narration: "",
});

const JournalEntryAddPage: React.FC = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [mainNarration, setMainNarration] = useState("");
  const [rows, setRows] = useState<JournalRow[]>(() =>
    Array.from({ length: INITIAL_ROW_COUNT }, (_, i) => makeEmptyRow(i))
  );

  useFormShortcuts({});

  // Busy quirk: Journal doesn't preview the next Vch No in the entry screen
  // (unlike Payment / Receipt). The number is assigned server-side on save.

  const ledgersFetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await accountService.fetchLedgers({ limit: 1000 });
    const list = res.ledgers || [];
    return { data: list, total: list.length };
  }, []);

  const { data: ledgers } = useListCache<AccountLedger>({
    cacheKey: "accounts:ledgers:all",
    socketModule: "accountLedger",
    fetcher: ledgersFetcher,
  });

  // Keyboard nav — DC → account → amount → narration → next row account
  const tableRef = useRef<HTMLDivElement>(null);

  const focusCell = (rowIdx: number, field: "dc" | "account" | "amount" | "narration") => {
    if (!tableRef.current) return;
    const wrap = tableRef.current.querySelector<HTMLElement>(`[data-cell="${rowIdx}-${field}"]`);
    if (!wrap) return;
    const el =
      wrap.tagName === "INPUT" || wrap.tagName === "SELECT"
        ? (wrap as HTMLInputElement)
        : wrap.querySelector("input");
    if (el) {
      el.focus();
      if ((el as HTMLInputElement).select) (el as HTMLInputElement).select();
    }
  };

  const addRow = () => {
    setRows((prev) => [...prev, makeEmptyRow(prev.length)]);
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
        setTimeout(() => focusCell(rowIdx + 1, "dc"), 0);
      } else {
        focusCell(rowIdx + 1, "dc");
      }
    }
  };

  const updateRow = (id: number, field: keyof JournalRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const totalDebit = rows.reduce(
    (sum, r) => sum + (r.dc === "D" ? parseFloat(r.amount) || 0 : 0),
    0
  );
  const totalCredit = rows.reduce(
    (sum, r) => sum + (r.dc === "C" ? parseFloat(r.amount) || 0 : 0),
    0
  );
  const diff = totalDebit - totalCredit;
  const isBalanced = Math.abs(diff) < 0.01;
  const hasAnyAmount = totalDebit > 0 || totalCredit > 0;
  const validCount = rows.filter((r) => r.ledgerId && parseFloat(r.amount) > 0).length;

  const isRowComplete = (r: JournalRow) => !!r.ledgerId && parseFloat(r.amount) > 0;
  const isRowUnlocked = (idx: number): boolean => {
    for (let i = 0; i < idx; i++) {
      if (!isRowComplete(rows[i])) return false;
    }
    return true;
  };

  // Busy behaviour: after save, wipe the entry rows so the operator can key
  // the next Journal voucher without leaving the page. Date is preserved.
  const resetFormForNext = () => {
    setMainNarration("");
    setRows(Array.from({ length: INITIAL_ROW_COUNT }, (_, i) => makeEmptyRow(i)));
    setTimeout(() => focusCell(0, "dc"), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validRows = rows.filter((r) => r.ledgerId && parseFloat(r.amount) > 0);
    if (validRows.length < 2) {
      toast.error("Need at least 2 entries (one debit, one credit)");
      return;
    }
    // Busy-style popup wording so the operator sees the exact same message
    // they know from Busy's "Invalid Data!" dialog on unbalanced entries.
    if (!isBalanced) {
      toast.error("Debit & Credit amounts should be equal.");
      return;
    }

    const items = validRows.map((r) => {
      const amt = parseFloat(r.amount);
      const isDebit = r.dc === "D";
      return {
        debitLedgerId: isDebit ? parseInt(r.ledgerId, 10) : null,
        creditLedgerId: !isDebit ? parseInt(r.ledgerId, 10) : null,
        debitAmount: isDebit ? amt : 0,
        creditAmount: !isDebit ? amt : 0,
        narration: r.narration || mainNarration || "Journal Entry",
      };
    });

    setSubmitting(true);
    try {
      const created = await voucherService.createVoucher({
        type: "JOURNAL",
        date,
        narration: mainNarration || "Journal Entry",
        items,
      });
      // Optimistic list update — Journal Register cache gets the new voucher.
      if (created?.id) {
        prependToListCacheByPrefix<Voucher>("accounts:journal-vouchers:", created);
      }
      toast.success("Journal entry saved successfully");
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
        title="New journal voucher"
        subtitle={VOUCHER_KINDS.JOURNAL.hint}
        back="/accounts/journal-entry"
        backLabel="Back to journal register"
        breadcrumbs={[
          { label: "Accounts" },
          { label: "Journal Register", to: "/accounts/journal-entry" },
          { label: "New" },
        ]}
        meta={<Chip tone="muted">Vch no. assigned on save</Chip>}
      >
        <VoucherTypeNav current="JOURNAL" target="add" />
      </PageHeader>

      <Tile title="Voucher details" className="mb-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <DatePickerCalendar
            name="date"
            label="Date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <Field label="Narration" hint="Used for every line that has no narration of its own">
            <input
              type="text"
              value={mainNarration}
              onChange={(e) => setMainNarration(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusCell(0, "dc");
                }
              }}
              className={fieldControlClass()}
            />
          </Field>
        </div>
      </Tile>

      <Tile
        padding="none"
        title="Entries"
        subtitle="Pick D or C, the ledger and the amount"
        divider
      >
        <div className="overflow-x-auto" ref={tableRef}>
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr>
                <th scope="col" className={gridThClass("center", "w-12")}>
                  #
                </th>
                <th scope="col" className={gridThClass("center", "w-16")}>
                  D/C
                </th>
                <th scope="col" className={gridThClass("left")}>
                  Account
                </th>
                <th scope="col" className={gridThClass("right", "w-40")}>
                  Debit (₹)
                </th>
                <th scope="col" className={gridThClass("right", "w-40")}>
                  Credit (₹)
                </th>
                <th scope="col" className={gridThClass("left", "w-[26%]")}>
                  Short narration
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const unlocked = isRowUnlocked(idx);
                const isDebit = row.dc === "D";
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
                    <td className="w-16 border-l border-line-soft">
                      <select
                        data-cell={`${idx}-dc`}
                        aria-label={`Line ${idx + 1} debit or credit`}
                        value={row.dc}
                        onChange={(e) => updateRow(row.id, "dc", e.target.value)}
                        disabled={!unlocked}
                        className={gridInputClass(!unlocked, "text-center font-semibold")}
                      >
                        <option value="D">D</option>
                        <option value="C">C</option>
                      </select>
                    </td>
                    <td className="border-l border-line-soft">
                      <div data-cell={`${idx}-account`} className={gridLedgerCellClass}>
                        <LedgerSearchInput
                          value={row.ledgerId}
                          ledgers={ledgers}
                          onChange={(val) => updateRow(row.id, "ledgerId", val)}
                          placeholder={unlocked ? "Type to search ledgers" : ""}
                          accentColor="purple-500"
                          variant="cell"
                          onSelected={() => focusCell(idx, "amount")}
                          disabled={!unlocked}
                        />
                      </div>
                    </td>
                    {/* Debit column — filled only when D/C = D */}
                    <td className="w-40 border-l border-line-soft">
                      {isDebit ? (
                        <input
                          data-cell={`${idx}-amount`}
                          aria-label={`Line ${idx + 1} debit amount`}
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
                      ) : (
                        <div className="px-3 text-right text-ink-subtle/50" aria-hidden="true">
                          —
                        </div>
                      )}
                    </td>
                    {/* Credit column — filled only when D/C = C */}
                    <td className="w-40 border-l border-line-soft">
                      {!isDebit ? (
                        <input
                          data-cell={`${idx}-amount`}
                          aria-label={`Line ${idx + 1} credit amount`}
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
                      ) : (
                        <div className="px-3 text-right text-ink-subtle/50" aria-hidden="true">
                          —
                        </div>
                      )}
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
                <td colSpan={3} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={addRow}
                    className="sl-btn-ghost sl-pill-sm text-accent"
                  >
                    <Plus size={15} aria-hidden="true" /> Add line
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                  {fmtAmt(totalDebit)}
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                  {fmtAmt(totalCredit)}
                </td>
                <td className="px-3 py-2 text-[12px] text-ink-muted">{validCount} valid entries</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-line-soft px-4 py-4 sm:px-5">
          <BalanceSummary debit={totalDebit} credit={totalCredit} count={validCount} />
          {hasAnyAmount && !isBalanced && (
            <p className="sl-muted m-0 mt-2 text-[13px]">
              Debit and credit must be equal before the voucher can be saved (difference{" "}
              {fmtAmt(Math.abs(diff))}).
            </p>
          )}
        </div>
      </Tile>

      <EntryFooter
        hints={
          <KeyHints
            hints={[
              [<Kbd key="dc">D</Kbd>, "/ C in the D/C column"],
              [<Kbd key="enter">Enter</Kbd>, "next cell"],
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
        <ActionPill variant="secondary" onClick={() => navigate("/accounts/journal-entry")}>
          Quit
        </ActionPill>
        <ActionPill type="submit" loading={submitting} loadingText="Saving...">
          Post Voucher
        </ActionPill>
      </EntryFooter>
    </form>
  );
};

export default JournalEntryAddPage;
