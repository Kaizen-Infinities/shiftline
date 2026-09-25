import React, { useCallback, useEffect, useState } from "react";

import {
  statusService,
  type ComponentState,
  type StatusReport,
} from "../../../services/statusService";
import { CenteredPage } from "../../../components/layout/AuthLayout";

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
  ok: "bg-[color:var(--color-success)]",
  degraded: "bg-[color:var(--color-warning)]",
  down: "bg-[color:var(--color-danger)]",
  unknown: "bg-ink-subtle/40",
};
const WORD: Record<ComponentState, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};
const OVERALL: Record<StatusReport["overall"] | "unreachable", { text: string; cls: string }> = {
  operational: {
    text: "All systems operational",
    cls: "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]",
  },
  degraded: {
    text: "Some systems degraded",
    cls: "bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]",
  },
  down: {
    text: "Shiftline is down",
    cls: "bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]",
  },
  unreachable: {
    text: "Shiftline is not reachable",
    cls: "bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]",
  },
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
    <CenteredPage wide>
      <div className="w-full space-y-5">
        <div>
          <h1 className="sl-h1">System Status</h1>
          <p className="sl-muted mt-1 text-sm">
            Live state of the Shiftline platform. Refreshes every 30 seconds.
          </p>
        </div>
        {overall && (
          <div
            role="status"
            className={`rounded-[18px] px-5 py-4 text-base font-semibold ${overall.cls}`}
          >
            {overall.text}
          </div>
        )}
        {!overall && <div className="sl-skeleton h-14" aria-label="Checking…" />}
        {report && (
          <ul className="sl-tile divide-y divide-line-soft overflow-hidden">
            {(Object.keys(LABEL) as (keyof StatusReport["components"])[]).map((key) => {
              const c = report.components[key];
              return (
                <li key={key} className="flex min-h-[3.25rem] items-center gap-3 px-5 py-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${DOT[c.state]}`} aria-hidden />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-ink">{LABEL[key]}</div>
                    <div className="text-xs text-ink-subtle">{c.detail}</div>
                  </div>
                  <span
                    className={`sl-chip ${
                      c.state === "ok"
                        ? "sl-chip-success"
                        : c.state === "degraded"
                          ? "sl-chip-warning"
                          : c.state === "down"
                            ? "sl-chip-danger"
                            : "sl-chip-muted"
                    }`}
                  >
                    {WORD[c.state]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {report && <p className="text-xs text-ink-subtle">Last checked {when(report.checkedAt)}</p>}
      </div>
    </CenteredPage>
  );
};

export default StatusPage;
