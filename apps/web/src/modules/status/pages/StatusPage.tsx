import React, { useCallback, useEffect, useState } from "react";

import {
  statusService,
  type ComponentState,
  type StatusReport,
} from "../../../services/statusService";

/**
 * Public status page (P1-05, PF6): the five components behind Shiftline and one word for the
 * whole. Polls every 30 seconds; when the API itself is unreachable the page says so.
 */
const LABEL: Record<keyof StatusReport["components"], string> = {
  api: "Application",
  database: "Database",
  migrations: "Schema",
  worker: "Background jobs",
  backups: "Backups",
};
const DOT: Record<ComponentState, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-rose-500",
  unknown: "bg-slate-400",
};
const WORD: Record<ComponentState, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};
const OVERALL: Record<StatusReport["overall"] | "unreachable", { text: string; cls: string }> = {
  operational: { text: "All systems operational", cls: "bg-emerald-50 text-emerald-800" },
  degraded: { text: "Some systems degraded", cls: "bg-amber-50 text-amber-800" },
  down: { text: "Shiftline is down", cls: "bg-rose-50 text-rose-800" },
  unreachable: { text: "Shiftline is not reachable", cls: "bg-rose-50 text-rose-800" },
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";

const StatusPage: React.FC = () => {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await statusService.report();
      if (r && r.components) {
        setReport(r);
        setUnreachable(false);
      } else {
        setUnreachable(true);
      }
    } catch {
      setUnreachable(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const overall = unreachable ? OVERALL.unreachable : report ? OVERALL[report.overall] : null;
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">System Status</h1>
          <p className="text-sm text-slate-500">
            Live state of the Shiftline platform. Refreshes every 30 seconds.
          </p>
        </div>
        {overall && (
          <div className={`rounded-xl px-4 py-3 text-base font-semibold ${overall.cls}`}>
            {overall.text}
          </div>
        )}
        {!overall && <p className="text-sm text-slate-500">Checking…</p>}
        {report && (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {(Object.keys(LABEL) as (keyof StatusReport["components"])[]).map((key) => {
              const c = report.components[key];
              return (
                <li key={key} className="flex items-center gap-3 px-4 py-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${DOT[c.state]}`} aria-hidden />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{LABEL[key]}</div>
                    <div className="text-xs text-slate-500">{c.detail}</div>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">{WORD[c.state]}</span>
                </li>
              );
            })}
          </ul>
        )}
        {report && <p className="text-xs text-slate-400">Last checked {when(report.checkedAt)}</p>}
      </div>
    </div>
  );
};

export default StatusPage;
