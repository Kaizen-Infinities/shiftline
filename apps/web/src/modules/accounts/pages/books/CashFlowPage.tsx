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
import { Printer, Waves } from "lucide-react";
import { ActionPill, PageHeader, SkeletonTile, StatTile } from "../../../../components/ui/v2";
import { fmtINRCompact } from "../../components/accountsUi";

/**
 * Cash flow statement, indirect method (P1-10b): profit adjusted for depreciation and working
 * capital, then investing and financing movements, reconciled to the change in cash and bank.
 */
const input = "sl-input h-11 text-sm";
const row = "flex items-center justify-between gap-4 px-4 py-2 text-[13.5px] text-ink";

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
          className={`${row} sl-row-hover w-full text-left`}
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
                className="text-accent hover:underline"
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
  <section className="sl-tile overflow-hidden">
    <h3 className="sl-h2 m-0 border-b border-line-soft px-4 py-3 text-[15px]">{title}</h3>
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
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Cash Flow Statement"
        subtitle="Indirect method. Figures in brackets are outflows. Depreciation is assumed to be posted against a Fixed Assets ledger."
        icon={<Waves size={20} />}
        className="!mb-0"
        actions={
          <ActionPill
            variant="secondary"
            icon={<Printer size={16} />}
            onClick={() => window.print()}
            disabled={!data}
          >
            Print
          </ActionPill>
        }
      />
      {data && (
        <div className="order-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile label="Operating" value={fmtINRCompact(data.operating.total)} />
          <StatTile label="Investing" value={fmtINRCompact(data.investing.total)} />
          <StatTile label="Financing" value={fmtINRCompact(data.financing.total)} />
          <StatTile
            label="Closing cash and bank"
            value={fmtINRCompact(data.closingCash)}
            delta={data.reconciles ? "Ties" : "Off"}
            deltaTone={data.reconciles ? "success" : "danger"}
          />
        </div>
      )}
      {!data && loading && <SkeletonTile className="order-3" lines={6} label="Loading cash flow" />}

      <form
        className="order-2 sl-tile flex flex-wrap items-end gap-4 p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ startDate, endDate });
        }}
      >
        <label className="sl-label !mb-0 flex-col items-start gap-1.5">
          From
          <input
            type="date"
            className={`${input} block`}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </label>
        <label className="sl-label !mb-0 flex-col items-start gap-1.5">
          To
          <input
            type="date"
            className={`${input} block`}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="sl-btn-blue sl-pill-md" disabled={loading}>
          {loading ? "Loading…" : "Run report"}
        </button>
      </form>

      {data && (
        <div className="order-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
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
                <div className={`${row} text-[12px] font-semibold text-ink-muted`}>
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
            <section className="sl-tile overflow-hidden">
              <h3 className="sl-h2 m-0 border-b border-line-soft px-4 py-3 text-[15px]">
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
                    <span className="sl-chip sl-chip-success sl-chip-sm">
                      Ties to the balance sheet
                    </span>
                  ) : (
                    <span className="sl-chip sl-chip-danger sl-chip-sm !whitespace-normal">
                      Off by {fmt(data.difference)}: an unclassified ledger or an unbalanced voucher
                    </span>
                  )}
                </div>
              </div>
            </section>
            <section className="sl-tile overflow-hidden">
              <h3 className="sl-h2 m-0 border-b border-line-soft px-4 py-3 text-[15px]">
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
                      className="text-accent hover:underline"
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
