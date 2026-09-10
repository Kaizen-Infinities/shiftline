import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import {
  booksService,
  fyStart,
  todayIso,
  type CashFlowGroupLine,
  type CashFlowStatement,
} from "../../../../services/booksService";

/**
 * Cash flow statement, indirect method (P1-10b): profit adjusted for depreciation and working
 * capital, then investing and financing movements, reconciled to the change in cash and bank.
 */
const input =
  "rounded-lg border border-line-soft bg-card px-3 py-2 text-sm text-ink outline-none focus:border-blue-500";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const row = "flex items-center justify-between gap-4 px-4 py-1.5 text-sm";

const fmt = (n: number) => {
  const s = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${s})` : s;
};
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const GroupLines: React.FC<{
  lines: CashFlowGroupLine[];
  open: Set<string>;
  toggle: (c: string) => void;
}> = ({ lines, open, toggle }) => (
  <>
    {lines.map((l) => (
      <React.Fragment key={l.groupCode}>
        <button
          type="button"
          className={`${row} w-full text-left hover:bg-card-2`}
          onClick={() => toggle(l.groupCode)}
        >
          <span className="text-ink">
            <span className="mr-1 text-ink-muted">{open.has(l.groupCode) ? "▾" : "▸"}</span>
            {l.groupName}
          </span>
          <span className="tabular-nums text-ink">{fmt(l.amount)}</span>
        </button>
        {open.has(l.groupCode) &&
          l.ledgers.map((g) => (
            <div key={g.ledgerId} className={`${row} bg-card-2/50 pl-10 text-xs`}>
              <Link
                to={`/accounts/ledger-statement?mode=one&acc=${g.ledgerId}`}
                className="text-blue-700 hover:underline"
              >
                {g.code} · {g.name}
              </Link>
              <span className="tabular-nums text-ink-muted">{fmt(g.amount)}</span>
            </div>
          ))}
      </React.Fragment>
    ))}
  </>
);

const Section: React.FC<{ title: string; total: number; children: React.ReactNode }> = ({
  title,
  total,
  children,
}) => (
  <section className="rounded-xl border border-line-soft bg-card">
    <h3 className="border-b border-line-soft px-4 py-2 text-sm font-semibold text-ink">{title}</h3>
    <div className="divide-y divide-line-soft/60 py-1">{children}</div>
    <div className={`${row} border-t border-line-soft font-semibold`}>
      <span>Net cash from {title.toLowerCase()}</span>
      <span className="tabular-nums">{fmt(total)}</span>
    </div>
  </section>
);

const CashFlowPage: React.FC = () => {
  const [startDate, setStartDate] = useState(fyStart());
  const [endDate, setEndDate] = useState(todayIso());
  const [applied, setApplied] = useState({ startDate: fyStart(), endDate: todayIso() });
  const [data, setData] = useState<CashFlowStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await booksService.cashFlow(applied.startDate, applied.endDate));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (code: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">Cash Flow Statement</h2>
        <p className="text-sm text-ink-muted">
          Indirect method. Figures in brackets are outflows. Depreciation is assumed to be posted
          against a Fixed Assets ledger.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-line-soft bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ startDate, endDate });
        }}
      >
        <label className="text-xs font-medium text-ink-muted">
          From
          <input
            type="date"
            className={`${input} block`}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </label>
        <label className="text-xs font-medium text-ink-muted">
          To
          <input
            type="date"
            className={`${input} block`}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </label>
        <button type="submit" className={secondary} disabled={loading}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </form>

      {data && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <Section title="Operating activities" total={data.operating.total}>
              <div className={row}>
                <span>Net profit / (loss) for the period</span>
                <span className="tabular-nums">{fmt(data.operating.netProfit)}</span>
              </div>
              <div className={row}>
                <span>Add: depreciation</span>
                <span className="tabular-nums">{fmt(data.operating.depreciation)}</span>
              </div>
              {data.operating.workingCapital.length > 0 && (
                <div className={`${row} text-xs uppercase tracking-wide text-ink-muted`}>
                  Changes in working capital
                </div>
              )}
              <GroupLines lines={data.operating.workingCapital} open={open} toggle={toggle} />
            </Section>
            <Section title="Investing activities" total={data.investing.total}>
              {data.investing.lines.length === 0 && (
                <div className={`${row} text-ink-muted`}>No movement</div>
              )}
              <GroupLines lines={data.investing.lines} open={open} toggle={toggle} />
            </Section>
            <Section title="Financing activities" total={data.financing.total}>
              {data.financing.lines.length === 0 && (
                <div className={`${row} text-ink-muted`}>No movement</div>
              )}
              <GroupLines lines={data.financing.lines} open={open} toggle={toggle} />
            </Section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-line-soft bg-card">
              <h3 className="border-b border-line-soft px-4 py-2 text-sm font-semibold text-ink">
                Cash and cash equivalents
              </h3>
              <div className="py-1">
                <div className={row}>
                  <span>Net increase / (decrease)</span>
                  <span className="tabular-nums font-semibold">{fmt(data.netChange)}</span>
                </div>
                <div className={row}>
                  <span>Opening cash and bank</span>
                  <span className="tabular-nums">{fmt(data.openingCash)}</span>
                </div>
                <div className={`${row} font-semibold`}>
                  <span>Closing cash and bank</span>
                  <span className="tabular-nums">{fmt(data.closingCash)}</span>
                </div>
                <div className={`${row} text-xs`}>
                  {data.reconciles ? (
                    <span className="text-emerald-700">Ties to the balance sheet</span>
                  ) : (
                    <span className="text-rose-700">
                      Off by {fmt(data.difference)}: an unclassified ledger or an unbalanced voucher
                    </span>
                  )}
                </div>
              </div>
            </section>
            <section className="rounded-xl border border-line-soft bg-card">
              <h3 className="border-b border-line-soft px-4 py-2 text-sm font-semibold text-ink">
                Movement by cash ledger
              </h3>
              <div className="py-1">
                {data.cashLedgers.length === 0 && (
                  <div className={`${row} text-ink-muted`}>No movement</div>
                )}
                {data.cashLedgers.map((l) => (
                  <div key={l.ledgerId} className={`${row} text-xs`}>
                    <Link
                      to={`/accounts/ledger-statement?mode=one&acc=${l.ledgerId}`}
                      className="text-blue-700 hover:underline"
                    >
                      {l.code} · {l.name}
                    </Link>
                    <span className="tabular-nums">{fmt(l.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
};

export default CashFlowPage;
