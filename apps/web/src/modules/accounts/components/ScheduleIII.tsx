import React from "react";

/**
 * Schedule III (Companies Act, 2013) presentation of the balance sheet and the statement of
 * profit and loss (P1-10c). The API already lays the ledgers out as sections → heads → groups →
 * ledgers in statutory order; these components only render that structure.
 */
export interface SIIILedger {
  code: string;
  name: string;
  balance?: number;
  netAmount?: number;
}
export interface SIIIGroup {
  code: string | null;
  name: string;
  items: SIIILedger[];
  total: number;
}
export interface SIIIHead {
  head: string;
  groups?: SIIIGroup[];
  items?: SIIILedger[];
  total: number;
}
export interface SIIISection {
  section: string;
  heads: SIIIHead[];
  total: number;
}
export interface BalanceSheetScheduleIII {
  equityAndLiabilities: SIIISection[];
  assets: SIIISection[];
}
export interface ProfitLossScheduleIII {
  income: SIIIHead[];
  expenses: SIIIHead[];
}

const fmt = (n: number) =>
  Math.abs(n) < 0.005
    ? "—"
    : `${n < 0 ? "(" : ""}${Math.abs(n).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}${n < 0 ? ")" : ""}`;

const amountOf = (l: SIIILedger) => l.balance ?? l.netAmount ?? 0;

const HeadRows: React.FC<{ head: SIIIHead; index: string; detailed: boolean }> = ({
  head,
  index,
  detailed,
}) => (
  <>
    <tr className="border-b border-line-soft">
      <td className="px-4 py-2 text-[13.5px] text-ink">
        <span className="mr-2 tabular-nums text-[10px] text-ink-subtle">{index}</span>
        {head.head}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-[13.5px] text-ink">
        {fmt(head.total)}
      </td>
    </tr>
    {detailed &&
      (head.groups ?? []).map((g) => (
        <React.Fragment key={g.code ?? g.name}>
          <tr className="bg-card-2/40">
            <td className="px-3 py-0.5 pl-10 text-[13px] text-ink-muted">{g.name}</td>
            <td className="px-3 py-0.5 text-right tabular-nums text-[13px] text-ink-muted">
              {fmt(g.total)}
            </td>
          </tr>
          {g.items.map((l) => (
            <tr key={l.code}>
              <td className="px-3 py-0.5 pl-14 text-[13px] text-ink-subtle">
                <span className="mr-1 tabular-nums">{l.code}</span> {l.name}
              </td>
              <td className="px-3 py-0.5 text-right tabular-nums text-[13px] text-ink-subtle">
                {fmt(amountOf(l))}
              </td>
            </tr>
          ))}
        </React.Fragment>
      ))}
    {detailed &&
      !head.groups &&
      (head.items ?? []).map((l) => (
        <tr key={l.code}>
          <td className="px-3 py-0.5 pl-10 text-[13px] text-ink-subtle">
            <span className="mr-1 tabular-nums">{l.code}</span> {l.name}
          </td>
          <td className="px-3 py-0.5 text-right tabular-nums text-[13px] text-ink-subtle">
            {fmt(amountOf(l))}
          </td>
        </tr>
      ))}
  </>
);

const roman = ["I", "II", "III", "IV", "V", "VI"];

export const ScheduleIIIBalanceSheet: React.FC<{
  data: BalanceSheetScheduleIII;
  asOnDate: string;
  detailed: boolean;
}> = ({ data, asOnDate, detailed }) => {
  const total = (s: SIIISection[]) => s.reduce((sum, x) => sum + x.total, 0);
  const side = (title: string, sections: SIIISection[], accent: string) => (
    <div className="sl-tile overflow-hidden">
      <div className="px-4 py-3 border-b border-line-soft flex items-center justify-between">
        <h3 className={`sl-h2 m-0 text-[15px] ${accent}`}>{title}</h3>
        <span className={`text-sm tabular-nums font-bold ${accent}`}>₹{fmt(total(sections))}</span>
      </div>
      <table className="w-full text-left border-collapse">
        <thead className="bg-card-2 text-ink-muted text-[12px] font-semibold border-b border-line-soft">
          <tr>
            <th className="px-4 py-2.5">Particulars</th>
            <th className="px-4 py-2.5 text-right w-[150px]">As at {asOnDate}</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, i) => (
            <React.Fragment key={sec.section}>
              <tr className="bg-card-2/60">
                <td className="px-4 py-2 text-[13px] font-semibold text-ink">
                  <span className="mr-2 tabular-nums text-ink-subtle">{roman[i] ?? i + 1}</span>
                  {sec.section}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[13px] font-bold text-ink">
                  {fmt(sec.total)}
                </td>
              </tr>
              {sec.heads.map((h, j) => (
                <HeadRows key={h.head} head={h} index={`(${j + 1})`} detailed={detailed} />
              ))}
            </React.Fragment>
          ))}
          <tr className="bg-card-2 border-t-2 border-line font-bold">
            <td className="px-4 py-2.5 text-[13.5px] font-bold text-ink">Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-sm text-ink">
              ₹{fmt(total(sections))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="schedule-iii-bs">
      {side("Equity and Liabilities", data.equityAndLiabilities, "text-ink")}
      {side("Assets", data.assets, "text-ink")}
    </div>
  );
};

export const ScheduleIIIProfitLoss: React.FC<{
  data: ProfitLossScheduleIII;
  startDate: string;
  endDate: string;
  detailed: boolean;
}> = ({ data, startDate, endDate, detailed }) => {
  const income = data.income.reduce((s, h) => s + h.total, 0);
  const expenses = data.expenses.reduce((s, h) => s + h.total, 0);
  const profit = income - expenses;
  return (
    <div className="sl-tile overflow-hidden" data-testid="schedule-iii-pl">
      <table className="w-full text-left border-collapse">
        <thead className="bg-card-2 text-ink-muted text-[12px] font-semibold border-b border-line-soft">
          <tr>
            <th className="px-4 py-2.5">Particulars</th>
            <th className="px-4 py-2.5 text-right w-[170px]">
              {startDate} to {endDate}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.income.map((h, i) => (
            <HeadRows key={h.head} head={h} index={roman[i] ?? String(i + 1)} detailed={detailed} />
          ))}
          <tr className="bg-card-2/60 font-semibold">
            <td className="px-4 py-2 text-[13.5px] text-ink">
              <span className="mr-2 tabular-nums text-ink-subtle">III</span>Total income
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-[13.5px] text-ink">
              {fmt(income)}
            </td>
          </tr>
          <tr>
            <td className="px-4 py-2 text-[13.5px] font-bold text-ink" colSpan={2}>
              <span className="mr-2 tabular-nums text-ink-subtle">IV</span>Expenses
            </td>
          </tr>
          {data.expenses.map((h, i) => (
            <HeadRows
              key={h.head}
              head={h}
              index={`(${String.fromCharCode(97 + i)})`}
              detailed={detailed}
            />
          ))}
          <tr className="bg-card-2/60 font-semibold">
            <td className="px-4 py-2 text-[13.5px] text-ink">Total expenses</td>
            <td className="px-4 py-2 text-right tabular-nums text-[13.5px] text-ink">
              {fmt(expenses)}
            </td>
          </tr>
          <tr className="bg-card-2 border-t-2 border-line font-bold">
            <td className="px-4 py-2.5 text-[13.5px] font-bold text-ink">
              <span className="mr-2 tabular-nums text-ink-subtle">V</span>Profit / (loss) for the
              period
            </td>
            <td
              className={`px-4 py-2.5 text-right tabular-nums text-sm ${profit >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-danger)]"}`}
            >
              ₹{fmt(profit)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
