import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  msmeService,
  type MsmeBillRow,
  type MsmeDisallowance,
  type MsmeForm1,
} from "../../../services/msmeService";
import {
  Card,
  day,
  field,
  fyOptions,
  message,
  money,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * MSME dues and section 43B(h) (P1-07).
 *
 * The clock is what this screen is for. A bill from a micro or small supplier paid a day late
 * stops being deductible this year, so overdue comes first, what is about to run out comes
 * second, and the year-end adjustment — both the amount going out and the amount coming back —
 * is a tab of its own.
 */
type Tab = "clock" | "yearEnd" | "form1";
/** Half-years, newest first, as the MCA return keys them. */
const halfYearOptions = () => {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i * 6, 1));
    const first = d.getUTCMonth() >= 3 && d.getUTCMonth() < 9;
    const year = d.getUTCMonth() < 3 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
    const key = `${year}-H${first ? 1 : 2}`;
    if (!out.some((o) => o.value === key)) {
      out.push({ value: key, label: first ? `Apr–Sep ${year}` : `Oct ${year} – Mar ${year + 1}` });
    }
  }
  return out;
};

const MsmePage: React.FC = () => {
  const { can } = usePermission();
  const years = useMemo(() => fyOptions(3), []);
  const halves = useMemo(() => halfYearOptions(), []);
  const [tab, setTab] = useState<Tab>("clock");
  const [fyCode, setFyCode] = useState(years[0].value);
  const [half, setHalf] = useState(halves[0].value);
  const [bills, setBills] = useState<MsmeBillRow[]>([]);
  const [report, setReport] = useState<MsmeDisallowance | null>(null);
  const [form1, setForm1] = useState<MsmeForm1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "clock") setBills(await msmeService.bills({ openOnly: true }));
      if (tab === "yearEnd") setReport(await msmeService.disallowance(fyCode));
      if (tab === "form1") setForm1(await msmeService.form1(half));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, fyCode, half]);
  useEffect(() => {
    void load();
  }, [load]);

  const overdue = bills.filter((b) => b.overdue);
  const soon = bills.filter((b) => !b.overdue && b.daysLeft <= 15);

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">MSME Dues</h1>
          <p className="text-sm text-ink-muted">
            Micro and small suppliers have to be paid within 15 days, or 45 where there is a written
            agreement. Past that, section 43B(h) moves the deduction to the year the money actually
            leaves.
          </p>
        </div>
        {tab === "yearEnd" && (
          <select
            className={field}
            value={fyCode}
            onChange={(e) => setFyCode(e.target.value)}
            aria-label="Financial year"
          >
            {years.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {tab === "form1" && (
          <select
            className={field}
            value={half}
            onChange={(e) => setHalf(e.target.value)}
            aria-label="Half year"
          >
            {halves.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </header>

      <nav className="flex gap-1 border-b border-line-soft" role="tablist">
        {(
          [
            ["clock", "The clock"],
            ["yearEnd", "Section 43B(h)"],
            ["form1", "MSME Form 1"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-semibold transition ${
              tab === key
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && <p className="text-sm text-ink-muted">Loading…</p>}

      {tab === "clock" && (
        <>
          {overdue.length > 0 && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              <strong>
                {overdue.length} bill{overdue.length === 1 ? "" : "s"} past the section 15 date,
                worth {money(overdue.reduce((s, b) => s + b.outstanding, 0))}.
              </strong>{" "}
              Every one of them is a deduction that has moved to next year until it is paid.
            </div>
          )}
          {soon.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {soon.length} more fall due within a fortnight.
            </div>
          )}
          <Card title="Unpaid bills from micro and small suppliers">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Supplier</th>
                    <th className={th}>Bill</th>
                    <th className={th}>Source</th>
                    <th className={th}>Accepted</th>
                    <th className={th}>Pay by</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                    <th className={th}>Clock</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.grnId} className="border-t border-line-soft">
                      <td className={td}>
                        {b.supplierName}
                        <div className="text-xs text-ink-muted">
                          {b.category.toLowerCase()}
                          {b.udyamNumber ? ` · ${b.udyamNumber}` : " · no Udyam number on file"}
                        </div>
                      </td>
                      <td className={td}>{b.invoiceNo}</td>
                      <td className={td}>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            b.source === "EXPENSE"
                              ? "bg-sky-100 text-sky-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {b.source === "EXPENSE" ? "Expense" : "GRN"}
                        </span>
                      </td>
                      <td className={td}>{day(b.acceptedOn)}</td>
                      <td className={td}>
                        {day(b.dueDate)}
                        <div className="text-xs text-ink-muted">{b.limitDays}-day limit</div>
                      </td>
                      <td className={`${td} text-right font-semibold`}>{money(b.outstanding)}</td>
                      <td className={td}>
                        {b.overdue ? (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                            {-b.daysLeft} days late
                          </span>
                        ) : (
                          <span className="text-xs text-ink-muted">{b.daysLeft} days left</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {bills.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={7}>
                        Nothing is outstanding to a micro or small supplier.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "yearEnd" && report && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card title={`Disallowed as at ${report.fyEnd}`}>
              <p className="text-2xl font-semibold text-rose-700">
                {money(report.disallowed.total)}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Unpaid at the year end and already past the section 15 date. It comes out of this
                year&apos;s profit and is deductible only in the year it is paid.
              </p>
            </Card>
            <Card title="Coming back this year">
              <p className="text-2xl font-semibold text-emerald-700">
                {money(report.allowedOnPayment.total)}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Paid late during the year. It was disallowed when it was incurred, so the deduction
                lands now.
              </p>
            </Card>
          </div>
          <Card title="Disallowed, by supplier">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Supplier</th>
                    <th className={th}>Udyam</th>
                    <th className={th}>Category</th>
                    <th className={`${th} text-right`}>Bills</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.disallowed.suppliers.map((s) => (
                    <tr key={s.supplierId} className="border-t border-line-soft">
                      <td className={td}>{s.supplierName}</td>
                      <td className={td}>{s.udyamNumber ?? "—"}</td>
                      <td className={td}>{s.category.toLowerCase()}</td>
                      <td className={`${td} text-right`}>{s.bills}</td>
                      <td className={`${td} text-right font-semibold`}>{money(s.amount)}</td>
                    </tr>
                  ))}
                  {report.disallowed.suppliers.length === 0 && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={5}>
                        Nothing is disallowed for this year.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "form1" && form1 && (
        <Card
          title={`MSME Form 1 · ${form1.from} to ${form1.to}`}
          actions={
            can("filings.prepare") && (
              <button
                className={form1.filing ? secondary : primary}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await msmeService.registerForm1(half);
                    toast.success("Sent for approval");
                    await load();
                  } catch (err) {
                    toast.error(message(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Send for approval
              </button>
            )
          }
        >
          <p className="mb-3 text-xs text-ink-muted">
            The MCA return asks for dues outstanding beyond 45 days, whatever the parties agreed —
            so a bill on a 15-day clock is late for section 15 without yet being reportable here.
            Total {money(form1.total)}
            {form1.filing ? ` · filing ${form1.filing.status.toLowerCase()}` : ""}.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Supplier</th>
                  <th className={th}>Udyam</th>
                  <th className={th}>Bill</th>
                  <th className={`${th} text-right`}>Outstanding</th>
                  <th className={th}>Due since</th>
                  <th className={th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {form1.lines.map((l, i) => (
                  <tr key={`${l.invoiceNo}-${i}`} className="border-t border-line-soft">
                    <td className={td}>{l.supplierName}</td>
                    <td className={td}>{l.udyamNumber ?? "—"}</td>
                    <td className={td}>{l.invoiceNo}</td>
                    <td className={`${td} text-right`}>{money(l.amountOutstanding)}</td>
                    <td className={td}>{day(l.dueSince)}</td>
                    <td className={td}>{l.reason}</td>
                  </tr>
                ))}
                {form1.lines.length === 0 && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={6}>
                      Nil return — nothing is outstanding beyond 45 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default MsmePage;
