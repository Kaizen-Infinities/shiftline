import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";

import { usePermission } from "../../../hooks/usePermission";
import {
  statutoryPayrollService,
  type PayrollRunRow,
  type PtSummary,
  type StatutoryRuleRow,
  type StatutorySummary,
} from "../../../services/statutoryPayrollService";
import { Download, Landmark, Send, BookCheck, Calculator } from "lucide-react";
import {
  ActionPill,
  actionPillClass,
  EmptyState,
  Chip,
  ChipTabs,
  PageHeader,
  SkeletonTile,
  StatTile,
} from "../../../components/ui/v2";
import {
  Card,
  Figure,
  Notice,
  PageShell,
  TableWrap,
  num,
  field,
  message,
  money,
  secondary,
  success,
  td,
  th,
} from "../components/peopleUi";

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
    <PageShell className="space-y-5">
      <PageHeader
        title="Statutory Payroll"
        icon={<Landmark size={20} />}
        breadcrumbs={[{ label: "Payroll", to: "/payroll" }, { label: "Statutory" }]}
        subtitle="What the month owes the provident fund, the insurance scheme, the state and the income-tax department — and the files each of them wants."
        actions={
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
        }
        primaryAction={
          runId && can("payroll-run.create") ? (
            <ActionPill
              icon={<Calculator size={17} />}
              loading={busy}
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
            </ActionPill>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ChipTabs
            ariaLabel="Statutory sections"
            value={tab}
            onChange={(k) => setTab(k as Tab)}
            items={[
              { key: "summary", label: "What is owed" },
              { key: "files", label: "Files and postings" },
              { key: "rules", label: "State rules" },
            ]}
          />
          <div className="flex flex-wrap gap-1.5" aria-label="Schemes">
            {["TDS", "PF", "ESI", "PT", "LWF"].map((c) => (
              <Chip key={c} size="sm">
                {c}
              </Chip>
            ))}
          </div>
        </div>
      </PageHeader>

      {loading && <SkeletonTile lines={4} label="Loading statutory figures" />}

      {!loading && !runId && tab !== "rules" && (
        <div className="sl-tile">
          <EmptyState
            icon={<Landmark size={28} strokeWidth={1.75} />}
            title="No payroll run yet"
            description="Statutory dues, challan files and the payroll journal follow from a month's payroll run."
            action={
              can("payroll-run.create") ? (
                <Link to="/payroll/run" className={actionPillClass({ variant: "secondary" })}>
                  Run Payroll
                </Link>
              ) : null
            }
          />
        </div>
      )}

      {notComputed && tab !== "rules" && (
        <Notice tone="warning" title="Not worked out yet">
          The statutory figures have not been worked out for this run yet. Use “Work out the month”
          above — nothing is posted or filed by it.
        </Notice>
      )}

      {tab === "summary" && summary && (
        <>
          {summary.wageCheckFailures > 0 && (
            <Notice tone="danger" title="Code on Wages check">
              {summary.wageCheckFailures} employee(s) have a basic under half of gross. The Code on
              Wages puts a floor there, and provident fund, gratuity and bonus all follow that wage
              — so all three are being understated.
            </Notice>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Gross" value={money(summary.gross)} />
            <StatTile label="Net payable" value={money(summary.net)} />
            <StatTile label="Employees" value={String(summary.employees)} />
          </div>
          <Card title="Provident fund">
            <p className="sl-muted m-0 mb-4 text-sm">
              The employer&apos;s 12% is not one contribution: 8.33% goes to the pension scheme on
              wages capped at ₹15,000, the balance to the provident fund, and EDLI and
              administration charges are 0.5% each on top.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Figure label="Employee" value={money(summary.pf.employee)} />
              <Figure label="Voluntary" value={money(summary.pf.vpf)} />
              <Figure label="Pension (8.33%)" value={money(summary.pf.pension)} />
              <Figure label="Employer (balance)" value={money(summary.pf.employer)} />
              <Figure label="EDLI" value={money(summary.pf.edli)} />
              <Figure label="Administration" value={money(summary.pf.admin)} />
            </div>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card title="Employees' state insurance">
              <div className="grid grid-cols-2 gap-3">
                <Figure label="Employee (0.75%)" value={money(summary.esi.employee)} />
                <Figure label="Employer (3.25%)" value={money(summary.esi.employer)} />
              </div>
            </Card>
            <Card title="State and tax">
              <div className="grid grid-cols-2 gap-3">
                <Figure label="Professional tax" value={money(summary.professionalTax)} />
                <Figure
                  label="Welfare fund"
                  value={money(summary.lwf.employee + summary.lwf.employer)}
                />
                <Figure label="Tax on salary" value={money(summary.incomeTax)} />
              </div>
            </Card>
          </div>
          {pt && pt.rows.length > 0 && (
            <Card title="Professional tax by state">
              <TableWrap>
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
                        <td className={`${td} ${num}`}>{r.employees}</td>
                        <td className={`${td} ${num} font-semibold`}>{money(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}
        </>
      )}

      {tab === "files" && runId && (
        <Card title="Files and postings">
          <p className="sl-muted m-0 mb-4 text-sm">
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
              <Download size={15} aria-hidden="true" /> EPFO ECR
            </button>
            <button
              className={secondary}
              disabled={busy || notComputed}
              onClick={() => act(() => statutoryPayrollService.downloadEsic(runId), "Downloaded")}
            >
              <Download size={15} aria-hidden="true" /> ESIC monthly file
            </button>
            <button
              className={secondary}
              disabled={busy || notComputed}
              onClick={() =>
                act(() => statutoryPayrollService.downloadBankFile(runId), "Downloaded")
              }
            >
              <Download size={15} aria-hidden="true" /> Bank salary transfer
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
                <BookCheck size={15} aria-hidden="true" /> Post the payroll journal
              </button>
            )}
            {can("filings.prepare") && (
              <button
                className={secondary}
                disabled={busy || notComputed}
                onClick={() =>
                  act(() => statutoryPayrollService.registerFilings(runId), "Sent for approval")
                }
              >
                <Send size={15} aria-hidden="true" /> Send the filings for approval
              </button>
            )}
          </div>
        </Card>
      )}

      {tab === "rules" && (
        <Card title="Professional tax and welfare fund, by state">
          <p className="sl-muted m-0 mb-4 text-sm">
            Neither is a national rate. Professional tax has its own slabs in each state that levies
            it — several charge more in one month of the year — and the welfare fund is a fixed
            amount at the frequency the state decides.
          </p>
          <TableWrap>
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
                    <td className={`${td} ${num}`}>
                      {money(Number(r.lwfEmployee) + Number(r.lwfEmployer))}
                    </td>
                    <td className={td}>{r.lwfFrequency.replace(/_/g, " ").toLowerCase()}</td>
                    <td className={td}>
                      <Chip size="sm" tone={r.isActive ? "success" : "muted"}>
                        {r.isActive ? "Active" : "Off"}
                      </Chip>
                    </td>
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
          </TableWrap>
        </Card>
      )}
    </PageShell>
  );
};

export default StatutoryPayrollPage;
