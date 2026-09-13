import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { payrollService, type ApiPayrollRun } from "../../../services/payrollService";
import {
  statutoryRegistersService,
  type AdvanceRow,
  type DeductionsRegister,
  type FineRow,
  type MusterRoll,
  type OvertimeRegister,
  type WagesRegister,
} from "../../../services/statutoryRegistersService";
import {
  Card,
  day,
  field,
  message,
  money,
  monthOptions,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * The inspector's registers (P2T-03): the muster roll, the wages, overtime and deductions
 * registers for one payroll run, and the fines and advances registers for a date range.
 *
 * Nothing here is entered by hand — every register is read straight off attendance and payroll
 * data that already exists, which is exactly what an inspector expects: the numbers on the
 * register are the numbers in the books, not a second copy someone has to keep matching.
 */
type Tab = "muster" | "wages" | "overtime" | "deductions" | "fines" | "advances";
const TABS: { key: Tab; label: string }[] = [
  { key: "muster", label: "Muster Roll" },
  { key: "wages", label: "Wages" },
  { key: "overtime", label: "Overtime" },
  { key: "deductions", label: "Deductions" },
  { key: "fines", label: "Fines" },
  { key: "advances", label: "Advances" },
];

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

const StatutoryRegistersPage: React.FC = () => {
  const months = useMemo(() => monthOptions(12), []);
  const [tab, setTab] = useState<Tab>("muster");
  const [period, setPeriod] = useState(months[0].value);
  const [runs, setRuns] = useState<ApiPayrollRun[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());

  const [muster, setMuster] = useState<MusterRoll | null>(null);
  const [wages, setWages] = useState<WagesRegister | null>(null);
  const [overtime, setOvertime] = useState<OvertimeRegister | null>(null);
  const [deductions, setDeductions] = useState<DeductionsRegister | null>(null);
  const [fines, setFines] = useState<FineRow[]>([]);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const needsRun = tab === "wages" || tab === "overtime" || tab === "deductions";

  // A run picker for the three run-scoped registers: list this period's runs whenever it changes.
  useEffect(() => {
    if (!needsRun) return;
    payrollService
      .listRuns({ period })
      .then((res) => {
        setRuns(res.runs);
        setRunId((current) =>
          res.runs.some((r) => r.id === current) ? current : (res.runs[0]?.id ?? null)
        );
      })
      .catch((err) => toast.error(message(err)));
  }, [needsRun, period]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "muster") setMuster(await statutoryRegistersService.musterRoll(period));
      if (tab === "wages" && runId) setWages(await statutoryRegistersService.wages(runId));
      if (tab === "overtime" && runId) setOvertime(await statutoryRegistersService.overtime(runId));
      if (tab === "deductions" && runId)
        setDeductions(await statutoryRegistersService.deductions(runId));
      if (tab === "fines") setFines((await statutoryRegistersService.fines(from, to)).rows);
      if (tab === "advances")
        setAdvances((await statutoryRegistersService.advances(from, to)).rows);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, period, runId, from, to]);

  useEffect(() => {
    if (needsRun && !runId) return;
    void load();
  }, [load, needsRun, runId]);

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">Statutory Registers</h1>
        <p className="text-sm text-ink-muted">
          The muster roll, wages, overtime, deductions, fines and advances registers the Factories
          Act and the Labour Codes require — generated from attendance and payroll, never kept
          separately.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-line-soft pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? "bg-blue-600 text-white" : "text-ink-muted hover:bg-card-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {(tab === "muster" || needsRun) && (
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Period
            <select className={field} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsRun && (
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Payroll run
            <select
              className={field}
              value={runId ?? ""}
              onChange={(e) => setRunId(e.target.value ? Number(e.target.value) : null)}
            >
              {runs.length === 0 && <option value="">No runs this period</option>}
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.runCode} · {r.employeeCategory} · {r.status}
                </option>
              ))}
            </select>
          </label>
        )}
        {(tab === "fines" || tab === "advances") && (
          <>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              From
              <input
                type="date"
                className={field}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              To
              <input
                type="date"
                className={field}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button
              onClick={() => void load()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Refresh
            </button>
          </>
        )}
      </div>

      {loading && <p className="text-sm text-ink-muted">Loading…</p>}

      {!loading && tab === "muster" && muster && (
        <Card title={`Muster roll — ${muster.period} (${muster.days} days)`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Employee</th>
                  <th className={th}>Present</th>
                  <th className={th}>Absent</th>
                  <th className={th}>Half day</th>
                  <th className={th}>Weekly off</th>
                  <th className={th}>Holiday</th>
                  <th className={th}>Leave (paid)</th>
                  <th className={th}>Leave (unpaid)</th>
                </tr>
              </thead>
              <tbody>
                {muster.employees.map((e) => (
                  <tr key={e.employeeId} className="border-t border-line-soft">
                    <td className={td}>
                      {e.employeeCode} — {e.employeeName}
                    </td>
                    <td className={td}>{e.totals.PRESENT ?? 0}</td>
                    <td className={td}>{e.totals.ABSENT ?? 0}</td>
                    <td className={td}>{e.totals.HALF_DAY ?? 0}</td>
                    <td className={td}>{e.totals.WEEKLY_OFF ?? 0}</td>
                    <td className={td}>{e.totals.HOLIDAY ?? 0}</td>
                    <td className={td}>{e.totals.LEAVE_PAID ?? 0}</td>
                    <td className={td}>{e.totals.LEAVE_UNPAID ?? 0}</td>
                  </tr>
                ))}
                {muster.employees.length === 0 && (
                  <tr>
                    <td className={td} colSpan={8}>
                      No active employees.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && tab === "wages" && wages && (
        <Card title={`Wages register — ${wages.runCode} (${wages.period})`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Employee</th>
                  <th className={th}>Days paid</th>
                  <th className={th}>Gross</th>
                  <th className={th}>Deductions</th>
                  <th className={th}>Net</th>
                  <th className={th}>Mode</th>
                </tr>
              </thead>
              <tbody>
                {wages.employees.map((r) => (
                  <tr key={r.employeeId} className="border-t border-line-soft">
                    <td className={td}>
                      {r.employeeCode} — {r.employeeName}
                    </td>
                    <td className={td}>{r.daysPaid}</td>
                    <td className={`${td} text-right`}>{money(r.grossWages)}</td>
                    <td className={`${td} text-right`}>{money(r.totalDeductions)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(r.netWages)}</td>
                    <td className={td}>{r.paymentMode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && tab === "overtime" && overtime && (
        <Card title={`Overtime register — ${overtime.runCode} (${overtime.period})`}>
          <div className="space-y-3">
            {overtime.employees.length === 0 && (
              <p className="text-sm text-ink-muted">No overtime this run.</p>
            )}
            {overtime.employees.map((r) => (
              <div key={r.employeeId} className="rounded-lg border border-line-soft p-3">
                <div className="flex items-center justify-between text-sm font-semibold text-ink">
                  <span>
                    {r.employeeCode} — {r.employeeName}
                  </span>
                  <span>
                    {r.totalOtHours}h · {money(r.otWagesPaid)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {r.days.map((d) => `${day(d.date)} (${d.otHours}h)`).join(", ")}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!loading && tab === "deductions" && deductions && (
        <Card title={`Deductions register — ${deductions.runCode} (${deductions.period})`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Employee</th>
                  <th className={th}>PF</th>
                  <th className={th}>ESI</th>
                  <th className={th}>PT</th>
                  <th className={th}>Advance</th>
                  <th className={th}>Loan</th>
                  <th className={th}>Other</th>
                  <th className={th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {deductions.employees.map((r) => (
                  <tr key={r.employeeId} className="border-t border-line-soft">
                    <td className={td}>
                      {r.employeeCode} — {r.employeeName}
                    </td>
                    <td className={`${td} text-right`}>{money(r.providentFund)}</td>
                    <td className={`${td} text-right`}>{money(r.esi)}</td>
                    <td className={`${td} text-right`}>{money(r.professionalTax)}</td>
                    <td className={`${td} text-right`}>{money(r.salaryAdvance)}</td>
                    <td className={`${td} text-right`}>{money(r.loanRecovery)}</td>
                    <td className={`${td} text-right`}>
                      {r.other.length === 0
                        ? "—"
                        : r.other.map((o) => `${o.label} (${money(o.amount)})`).join(", ")}
                    </td>
                    <td className={`${td} text-right font-semibold`}>{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && tab === "fines" && (
        <Card title={`Register of fines — ${day(from)} to ${day(to)}`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Employee</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Amount</th>
                  <th className={th}>Recorded</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {fines.map((r, i) => (
                  <tr key={i} className="border-t border-line-soft">
                    <td className={td}>
                      {r.employeeCode} — {r.employeeName}
                    </td>
                    <td className={td}>{r.label}</td>
                    <td className={`${td} text-right`}>{money(r.amount)}</td>
                    <td className={td}>{day(r.recordedAt)}</td>
                    <td className={td}>{r.isActive ? "Active" : "Ended"}</td>
                  </tr>
                ))}
                {fines.length === 0 && (
                  <tr>
                    <td className={td} colSpan={5}>
                      No fines recorded in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && tab === "advances" && (
        <Card title={`Register of advances — ${day(from)} to ${day(to)}`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Employee</th>
                  <th className={th}>Disbursed</th>
                  <th className={th}>Amount</th>
                  <th className={th}>Recovered</th>
                  <th className={th}>Outstanding</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {advances.map((r, i) => (
                  <tr key={i} className="border-t border-line-soft">
                    <td className={td}>
                      {r.employeeCode} — {r.employeeName}
                    </td>
                    <td className={td}>{day(r.disbursedDate)}</td>
                    <td className={`${td} text-right`}>{money(r.amount)}</td>
                    <td className={`${td} text-right`}>{money(r.recovered)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(r.outstanding)}</td>
                    <td className={td}>{r.status}</td>
                  </tr>
                ))}
                {advances.length === 0 && (
                  <tr>
                    <td className={td} colSpan={6}>
                      No advances disbursed in this range.
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

export default StatutoryRegistersPage;
