import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  statutoryPayrollService,
  type PayrollRunRow,
  type PtSummary,
  type StatutoryRuleRow,
  type StatutorySummary,
} from "../../../services/statutoryPayrollService";
import {
  Card,
  field,
  message,
  money,
  primary,
  secondary,
  success,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * Statutory payroll (P1-16).
 *
 * The month's run is picked once at the top and everything else follows from it: what is owed to
 * each scheme, the files the portals want, and the journal. The provident fund is shown split the
 * way the EPFO actually takes it rather than as one employer figure, because that split is what
 * the ECR is checked against.
 */
type Tab = "summary" | "files" | "rules";

const StatutoryPayrollPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<Tab>("summary");
  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [summary, setSummary] = useState<StatutorySummary | null>(null);
  const [pt, setPt] = useState<PtSummary | null>(null);
  const [rules, setRules] = useState<StatutoryRuleRow[]>([]);
  const [notComputed, setNotComputed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await statutoryPayrollService.runs();
        setRuns(rows);
        if (rows[0]) setRunId(rows[0].id);
      } catch {
        // No runs yet; the screen says so.
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setNotComputed(false);
    try {
      if (tab === "rules") {
        setRules(await statutoryPayrollService.rules(true));
      } else if (runId) {
        try {
          setSummary(await statutoryPayrollService.summary(runId));
          setPt(await statutoryPayrollService.ptSummary(runId));
        } catch (err) {
          const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
          if (code === "NOT_COMPUTED") {
            setNotComputed(true);
            setSummary(null);
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, runId]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Statutory Payroll</h1>
          <p className="text-sm text-ink-muted">
            What the month owes the provident fund, the insurance scheme, the state and the
            income-tax department — and the files each of them wants.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className={field}
            value={runId ?? ""}
            onChange={(e) => setRunId(Number(e.target.value) || null)}
            aria-label="Payroll run"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.period} · {r.runCode}
              </option>
            ))}
            {runs.length === 0 && <option value="">No payroll run yet</option>}
          </select>
          {runId && can("payroll-run.create") && (
            <button
              className={primary}
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const out = await statutoryPayrollService.compute(runId);
                  if (out.wageCheckFailures.length > 0) {
                    toast.warn(
                      `${out.wageCheckFailures.length} employee(s) fail the Code on Wages check`
                    );
                  }
                }, "Worked out")
              }
            >
              Work out the month
            </button>
          )}
        </div>
      </header>

      <nav className="flex gap-1 border-b border-line-soft" role="tablist">
        {(
          [
            ["summary", "What is owed"],
            ["files", "Files and postings"],
            ["rules", "State rules"],
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

      {notComputed && tab !== "rules" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          The statutory figures have not been worked out for this run yet. Use “Work out the month”
          above — nothing is posted or filed by it.
        </div>
      )}

      {tab === "summary" && summary && (
        <>
          {summary.wageCheckFailures > 0 && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              {summary.wageCheckFailures} employee(s) have a basic under half of gross. The Code on
              Wages puts a floor there, and provident fund, gratuity and bonus all follow that wage
              — so all three are being understated.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Gross" value={money(summary.gross)} />
            <Stat label="Net payable" value={money(summary.net)} />
            <Stat label="Employees" value={String(summary.employees)} />
          </div>
          <Card title="Provident fund">
            <p className="mb-3 text-xs text-ink-muted">
              The employer&apos;s 12% is not one contribution: 8.33% goes to the pension scheme on
              wages capped at ₹15,000, the balance to the provident fund, and EDLI and
              administration charges are 0.5% each on top.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Employee" value={money(summary.pf.employee)} />
              <Stat label="Voluntary" value={money(summary.pf.vpf)} />
              <Stat label="Pension (8.33%)" value={money(summary.pf.pension)} />
              <Stat label="Employer (balance)" value={money(summary.pf.employer)} />
              <Stat label="EDLI" value={money(summary.pf.edli)} />
              <Stat label="Administration" value={money(summary.pf.admin)} />
            </div>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card title="Employees' state insurance">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Employee (0.75%)" value={money(summary.esi.employee)} />
                <Stat label="Employer (3.25%)" value={money(summary.esi.employer)} />
              </div>
            </Card>
            <Card title="State and tax">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Professional tax" value={money(summary.professionalTax)} />
                <Stat
                  label="Welfare fund"
                  value={money(summary.lwf.employee + summary.lwf.employer)}
                />
                <Stat label="Tax on salary" value={money(summary.incomeTax)} />
              </div>
            </Card>
          </div>
          {pt && pt.rows.length > 0 && (
            <Card title="Professional tax by state">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className={th}>State</th>
                      <th className={`${th} text-right`}>Employees</th>
                      <th className={`${th} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pt.rows.map((r) => (
                      <tr key={r.stateCode} className="border-t border-line-soft">
                        <td className={td}>{r.stateName}</td>
                        <td className={`${td} text-right`}>{r.employees}</td>
                        <td className={`${td} text-right font-semibold`}>{money(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === "files" && runId && (
        <Card title="Files and postings">
          <p className="mb-3 text-xs text-ink-muted">
            Each portal takes a file in its own fixed shape and rejects the whole thing on one bad
            line. Anyone left out of a file — no UAN, no ESIC number, no bank details — is counted
            rather than silently dropped.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={secondary}
              disabled={busy || notComputed}
              onClick={() => act(() => statutoryPayrollService.downloadEcr(runId), "Downloaded")}
            >
              EPFO ECR
            </button>
            <button
              className={secondary}
              disabled={busy || notComputed}
              onClick={() => act(() => statutoryPayrollService.downloadEsic(runId), "Downloaded")}
            >
              ESIC monthly file
            </button>
            <button
              className={secondary}
              disabled={busy || notComputed}
              onClick={() =>
                act(() => statutoryPayrollService.downloadBankFile(runId), "Downloaded")
              }
            >
              Bank salary transfer
            </button>
            {can("payroll-run.edit") && (
              <button
                className={success}
                disabled={busy || notComputed}
                onClick={() =>
                  act(async () => {
                    const out = await statutoryPayrollService.postJournal(runId);
                    toast.info(out.posted ? `Posted voucher ${out.voucherId}` : "Already posted");
                  }, "Posted")
                }
              >
                Post the payroll journal
              </button>
            )}
            {can("filings.prepare") && (
              <button
                className={primary}
                disabled={busy || notComputed}
                onClick={() =>
                  act(() => statutoryPayrollService.registerFilings(runId), "Sent for approval")
                }
              >
                Send the filings for approval
              </button>
            )}
          </div>
        </Card>
      )}

      {tab === "rules" && (
        <Card title="Professional tax and welfare fund, by state">
          <p className="mb-3 text-xs text-ink-muted">
            Neither is a national rate. Professional tax has its own slabs in each state that levies
            it — several charge more in one month of the year — and the welfare fund is a fixed
            amount at the frequency the state decides.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>State</th>
                  <th className={th}>Professional tax</th>
                  <th className={`${th} text-right`}>Welfare fund</th>
                  <th className={th}>Collected</th>
                  <th className={th}>Active</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft">
                    <td className={td}>
                      {r.stateName}
                      <div className="text-xs text-ink-muted">{r.stateCode}</div>
                    </td>
                    <td className={td}>
                      {r.ptEnabled ? (
                        <span className="text-xs text-ink-muted">
                          {r.ptSlabs.length} slab(s), up to{" "}
                          {money(Math.max(...r.ptSlabs.map((s) => s.amount)))} a month
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">Not levied</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {money(Number(r.lwfEmployee) + Number(r.lwfEmployer))}
                    </td>
                    <td className={td}>{r.lwfFrequency.replace(/_/g, " ").toLowerCase()}</td>
                    <td className={td}>{r.isActive ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {rules.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={5}>
                      No state rules yet.
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

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-line-soft bg-card-2 p-3">
    <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
  </div>
);

export default StatutoryPayrollPage;
