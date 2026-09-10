import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import type { FilingDef, FilingStatus } from "@shiftline/shared";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { filingService, type FilingApprovalRow } from "../../../services/filingService";
import ApprovalPanel, { STATUS_LABEL, STATUS_STYLE, when } from "../components/ApprovalPanel";

/**
 * Filing approvals (P1-04): every statutory return the company prepares passes through here
 * before it is filed. Preparers send, someone else approves or rejects, and the submission is
 * recorded with its acknowledgement. Changing the figures after approval voids it.
 */
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-2 align-top text-sm text-ink";
const STATUSES: FilingStatus[] = ["PENDING", "DRAFT", "APPROVED", "REJECTED", "SUBMITTED"];
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const summaryText = (summary: Record<string, unknown>) =>
  Object.entries(summary)
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toLocaleString("en-IN") : String(v)}`)
    .join(" · ");

const FilingApprovalsPage: React.FC = () => {
  const userId = useAppSelector((s) => s.auth.user?.userId ?? null);
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const [registry, setRegistry] = useState<FilingDef[]>([]);
  const [rows, setRows] = useState<FilingApprovalRow[]>([]);
  const [status, setStatus] = useState<FilingStatus | "">("");
  const [filingType, setFilingType] = useState("");
  const [open, setOpen] = useState<string | null>(focus);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [defs, list] = await Promise.all([
        filingService.registry(),
        filingService.list({
          ...(status && { status }),
          ...(filingType && { filingType }),
        }),
      ]);
      setRegistry(defs);
      setRows(list);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [status, filingType]);
  useEffect(() => {
    void load();
  }, [load]);

  const names = useMemo(() => new Map(registry.map((d) => [d.key, d.name])), [registry]);
  const pending = rows.filter((r) => r.status === "PENDING").length;

  const replace = (next: FilingApprovalRow) =>
    setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)));

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Filing Approvals</h2>
          <p className="text-sm text-ink-muted">
            Every GST, TDS and payroll filing is approved by someone other than its preparer before
            it leaves Shiftline. Figures that change after approval need approving again.
          </p>
        </div>
        {pending > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {pending} awaiting approval
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-line-soft bg-card px-3 py-1.5 text-sm text-ink"
          value={status}
          onChange={(e) => setStatus(e.target.value as FilingStatus | "")}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-line-soft bg-card px-3 py-1.5 text-sm text-ink"
          value={filingType}
          onChange={(e) => setFilingType(e.target.value)}
          aria-label="Filing"
        >
          <option value="">All filings</option>
          {registry.map((d) => (
            <option key={d.key} value={d.key}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Filing</th>
              <th className={th}>Period</th>
              <th className={th}>Status</th>
              <th className={th}>Summary</th>
              <th className={th}>Last change</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((r) => {
              const isOpen = open === r.id;
              return (
                <React.Fragment key={r.id}>
                  <tr className={isOpen ? "bg-card-2" : undefined}>
                    <td className={`${td} font-medium`}>
                      {names.get(r.filingType) ?? r.filingType}
                    </td>
                    <td className={`${td} tabular-nums`}>{r.periodKey}</td>
                    <td className={td}>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className={`${td} text-xs text-ink-muted`}>{summaryText(r.summary)}</td>
                    <td className={`${td} text-xs`}>{when(r.updatedAt)}</td>
                    <td className={`${td} text-right`}>
                      <button
                        type="button"
                        className="text-sm font-semibold text-blue-600 hover:underline"
                        onClick={() => {
                          const next = isOpen ? null : r.id;
                          setOpen(next);
                          if (next) setParams({ focus: next }, { replace: true });
                          else setParams({}, { replace: true });
                        }}
                      >
                        {isOpen ? "Close" : "Review"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-card-2">
                      <td className={td} colSpan={6}>
                        <div className="space-y-3">
                          {r.notes && <p className="text-sm text-ink">{r.notes}</p>}
                          <div className="grid gap-1 text-xs text-ink-muted sm:grid-cols-2 lg:grid-cols-3">
                            {Object.entries(r.summary).map(([k, v]) => (
                              <div
                                key={k}
                                className="flex justify-between gap-2 border-b border-line-soft py-0.5"
                              >
                                <span>{k}</span>
                                <span className="tabular-nums text-ink">
                                  {typeof v === "number" ? v.toLocaleString("en-IN") : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                          <ApprovalPanel row={r} onChange={replace} userId={userId} />
                          {r.history.length > 0 && (
                            <ol className="text-xs text-ink-muted">
                              {r.history.map((h, i) => (
                                <li key={i}>
                                  {when(h.at)} · {h.event.replace(/_/g, " ").toLowerCase()}
                                  {h.note ? ` · ${h.note}` : ""}
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={6}>
                  No filings registered yet. Returns appear here when a filing screen prepares them.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FilingApprovalsPage;
