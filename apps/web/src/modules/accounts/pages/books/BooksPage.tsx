import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import type { LedgerStatementEntry } from "../../../../services/accountService";
import {
  booksService,
  fyStart,
  todayIso,
  type BankBook,
  type CashBook,
  type DayBook,
} from "../../../../services/booksService";
import { formatDate } from "../../../../utils/dateUtils";

/**
 * Day book, cash book and bank book (P1-10b): the books of prime entry, drawn from the same
 * journal as every other report. One page, three tabs, each with its own route.
 */
type Book = "day" | "cash" | "bank";
const TABS: { key: Book; title: string; path: string }[] = [
  { key: "day", title: "Day Book", path: "/accounts/day-book" },
  { key: "cash", title: "Cash Book", path: "/accounts/cash-book" },
  { key: "bank", title: "Bank Book", path: "/accounts/bank-book" },
];
const VOUCHER_TYPES = [
  "PAYMENT",
  "RECEIPT",
  "JOURNAL",
  "CONTRA",
  "SALES",
  "PURCHASE",
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "EXPENSE",
];

const input =
  "rounded-lg border border-line-soft bg-card px-3 py-2 text-sm text-ink outline-none focus:border-blue-500";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-1.5 text-sm text-ink";
const num = `${td} text-right tabular-nums`;

const fmt = (n: number) =>
  Math.abs(n) < 0.005
    ? ""
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBal = (n: number) =>
  `${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${n < 0 ? "Cr" : "Dr"}`;
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const StatementTable: React.FC<{
  entries: LedgerStatementEntry[];
  openingBalance: number;
  closingBalance: number;
}> = ({ entries, openingBalance, closingBalance }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-line-soft">
      <thead>
        <tr>
          <th className={th}>Date</th>
          <th className={th}>Voucher</th>
          <th className={th}>Particulars</th>
          <th className={`${th} text-right`}>Debit</th>
          <th className={`${th} text-right`}>Credit</th>
          <th className={`${th} text-right`}>Balance</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        <tr className="bg-card-2">
          <td className={td} colSpan={5}>
            Opening balance
          </td>
          <td className={num}>{fmtBal(openingBalance)}</td>
        </tr>
        {entries.map((e) => (
          <tr key={e.id}>
            <td className={td}>{formatDate(e.date)}</td>
            <td className={td}>
              <span className="font-medium">{e.voucherNo}</span>
              <span className="ml-1 text-xs text-ink-muted">{e.voucherType}</span>
            </td>
            <td className={td}>
              {e.particulars}
              {e.narration && <div className="text-xs text-ink-muted">{e.narration}</div>}
            </td>
            <td className={num}>{fmt(e.debit)}</td>
            <td className={num}>{fmt(e.credit)}</td>
            <td className={num}>{fmtBal(e.runningBalance)}</td>
          </tr>
        ))}
        {entries.length === 0 && (
          <tr>
            <td className={`${td} text-ink-muted`} colSpan={6}>
              No entries in this period.
            </td>
          </tr>
        )}
        <tr className="bg-card-2 font-semibold">
          <td className={td} colSpan={5}>
            Closing balance
          </td>
          <td className={num}>{fmtBal(closingBalance)}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

const BooksPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = useMemo<Book>(
    () => TABS.find((t) => location.pathname.startsWith(t.path))?.key ?? "day",
    [location.pathname]
  );
  const [startDate, setStartDate] = useState(fyStart());
  const [endDate, setEndDate] = useState(todayIso());
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [bankLedgerId, setBankLedgerId] = useState<number | null>(null);
  const [applied, setApplied] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dayBook, setDayBook] = useState<DayBook | null>(null);
  const [cashBook, setCashBook] = useState<CashBook | null>(null);
  const [bankBook, setBankBook] = useState<BankBook | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { startDate, endDate, search };
      if (tab === "day") {
        setDayBook(await booksService.dayBook({ ...params, type, includeCancelled }));
      } else if (tab === "cash") {
        setCashBook(await booksService.cashBook(params));
      } else {
        const book = await booksService.bankBook(bankLedgerId, params);
        setBankBook(book);
        if (!bankLedgerId && book.ledgers.length) setBankLedgerId(book.ledgers[0].id);
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, applied, bankLedgerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">{TABS.find((t) => t.key === tab)?.title}</h2>
        <p className="text-sm text-ink-muted">
          {tab === "day" && "Every voucher of the period, day by day, with its ledger lines."}
          {tab === "cash" && "All cash-in-hand ledgers as one running statement."}
          {tab === "bank" && "One bank account or overdraft as a running statement."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line-soft">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => navigate(t.path)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              t.key === tab
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.title}
          </button>
        ))}
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-line-soft bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied((n) => n + 1);
        }}
      >
        <label className="text-xs font-medium text-ink-muted">
          From
          <input
            type="date"
            className={`${input} block`}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-ink-muted">
          To
          <input
            type="date"
            className={`${input} block`}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        {tab === "day" && (
          <label className="text-xs font-medium text-ink-muted">
            Voucher type
            <select
              className={`${input} block`}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">All</option>
              {VOUCHER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {tab === "bank" && (
          <label className="text-xs font-medium text-ink-muted">
            Bank ledger
            <select
              className={`${input} block min-w-48`}
              value={bankLedgerId ?? ""}
              onChange={(e) => setBankLedgerId(e.target.value ? Number(e.target.value) : null)}
            >
              {(bankBook?.ledgers ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs font-medium text-ink-muted">
          Search
          <input
            className={`${input} block`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Voucher no. or narration"
          />
        </label>
        {tab === "day" && (
          <label className="flex items-center gap-2 pb-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
            />
            Show cancelled
          </label>
        )}
        <button type="submit" className={secondary} disabled={loading}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </form>

      {tab === "day" && dayBook && (
        <section className="rounded-xl border border-line-soft bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 text-sm">
            <span className="text-ink-muted">
              {dayBook.voucherCount} voucher{dayBook.voucherCount === 1 ? "" : "s"}
              {dayBook.truncated && " (first 5,000 shown; narrow the dates)"}
            </span>
            <span className="tabular-nums text-ink">
              Debit {fmt(dayBook.totalDebit) || "0.00"} · Credit{" "}
              {fmt(dayBook.totalCredit) || "0.00"}
            </span>
          </div>
          {dayBook.days.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-muted">No vouchers in this period.</p>
          )}
          {dayBook.days.map((day) => (
            <div key={day.date} className="border-b border-line-soft last:border-b-0">
              <div className="flex items-center justify-between bg-card-2 px-4 py-2 text-sm font-semibold text-ink">
                <span>{formatDate(day.date)}</span>
                <span className="tabular-nums">{fmt(day.totalDebit)}</span>
              </div>
              <table className="min-w-full">
                <tbody className="divide-y divide-line-soft">
                  {day.vouchers.map((v) => (
                    <React.Fragment key={v.id}>
                      <tr
                        className="cursor-pointer hover:bg-card-2"
                        onClick={() => toggle(v.id)}
                        data-testid="day-book-voucher"
                      >
                        <td className={`${td} w-8 text-ink-muted`}>{open.has(v.id) ? "▾" : "▸"}</td>
                        <td className={`${td} font-medium`}>{v.voucherNo}</td>
                        <td className={td}>
                          <span className="rounded bg-card-2 px-1.5 py-0.5 text-xs">{v.type}</span>
                          {v.status !== "POSTED" && (
                            <span className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800">
                              {v.status}
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-ink-muted`}>{v.narration}</td>
                        <td className={num}>{fmt(v.total)}</td>
                      </tr>
                      {open.has(v.id) &&
                        v.lines.map((l, i) => (
                          <tr key={`${v.id}-${i}`} className="bg-card-2/50">
                            <td />
                            <td className={`${td} text-xs text-ink-muted`} colSpan={2}>
                              {l.ledgerId ? (
                                <Link
                                  to={`/accounts/ledger-statement?mode=one&acc=${l.ledgerId}`}
                                  className="text-blue-700 hover:underline"
                                >
                                  {l.code} · {l.name}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className={`${td} text-xs text-ink-muted`}>{l.narration}</td>
                            <td className={`${num} text-xs`}>
                              {l.debit > 0 ? `Dr ${fmt(l.debit)}` : `Cr ${fmt(l.credit)}`}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {tab === "cash" && cashBook && (
        <section className="rounded-xl border border-line-soft bg-card">
          <div className="border-b border-line-soft px-4 py-3 text-sm text-ink-muted">
            Ledgers: {cashBook.ledgers.map((l) => `${l.code} ${l.name}`).join(", ")}
          </div>
          <StatementTable
            entries={cashBook.entries}
            openingBalance={cashBook.openingBalance}
            closingBalance={cashBook.closingBalance}
          />
        </section>
      )}

      {tab === "bank" && bankBook && (
        <section className="rounded-xl border border-line-soft bg-card">
          {bankBook.ledgers.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">
              No bank ledger yet. Add one under Bank Accounts in the Chart of Accounts.
            </p>
          ) : bankBook.statement ? (
            <StatementTable
              entries={bankBook.statement.entries}
              openingBalance={bankBook.statement.openingBalance}
              closingBalance={bankBook.statement.closingBalance}
            />
          ) : (
            <p className="px-4 py-6 text-sm text-ink-muted">Pick a bank ledger.</p>
          )}
        </section>
      )}
    </div>
  );
};

export default BooksPage;
