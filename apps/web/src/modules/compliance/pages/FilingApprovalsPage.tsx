import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import type { FilingDef, FilingStatus } from "@shiftline/shared";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { filingService, type FilingApprovalRow } from "../../../services/filingService";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tile,
  Toolbar,
  cx,
} from "../../../components/ui/v2";
import ApprovalPanel, { FilingStatusChip, STATUS_LABEL, when } from "../components/ApprovalPanel";
import { periodLabel } from "../components/gstUi";

/**
 * Filing approvals (P1-04): every statutory return the company prepares passes through here
 * before it is filed. Preparers send, someone else approves or rejects, and the submission is
 * recorded with its acknowledgement. Changing the figures after approval voids it.
 */
const STATUSES: FilingStatus[] = ["PENDING", "DRAFT", "APPROVED", "REJECTED", "SUBMITTED"];
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const figure = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN") : String(v));
const summaryText = (summary: Record<string, unknown>) =>
  Object.entries(summary)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${figure(v)}`)
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
  const firstPending = rows.find((r) => r.status === "PENDING");

  const replace = (next: FilingApprovalRow) =>
    setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)));

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next) setParams({ focus: next }, { replace: true });
    else setParams({}, { replace: true });
  };

  const filtered = status !== "" || filingType !== "";

  return (
    <div className="sl-page">
      <PageHeader
        title="Filing Approvals"
        icon={<ShieldCheck size={22} />}
        subtitle="Every GST, TDS and payroll filing is approved by someone other than its preparer before it leaves Shiftline. Figures that change after approval need approving again."
        meta={
          pending > 0 ? (
            <Chip tone="warning" dot>
              {pending} awaiting approval
            </Chip>
          ) : undefined
        }
        primaryAction={
          firstPending && open === null ? (
            <ActionPill size="lg" onClick={() => toggle(firstPending.id)}>
              Review next filing
            </ActionPill>
          ) : undefined
        }
      />

      <Toolbar<FilingStatus | "">
        filters={[
          { key: "", label: "All" },
          ...STATUSES.map((s) => ({
            key: s,
            label: STATUS_LABEL[s],
            count: s === "PENDING" && status === "" && pending > 0 ? pending : undefined,
          })),
        ]}
        filterValue={status}
        onFilterChange={setStatus}
        filtersLabel="Status"
        right={
          <select
            className="sl-input h-11 w-full py-0 text-sm sm:w-64"
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
        }
      />

      <Tile padding="none" className="overflow-hidden">
        {loading && rows.length === 0 ? (
          <SkeletonRows rows={6} columns={5} label="Loading filings" />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No filings match these filters"
              action={
                <ActionPill
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setStatus("");
                    setFilingType("");
                  }}
                >
                  Clear filters
                </ActionPill>
              }
            />
          ) : (
            <EmptyState
              icon={<ShieldCheck size={28} strokeWidth={1.75} />}
              title="No filings registered yet"
              description="Returns appear here when a filing screen prepares them."
            />
          )
        ) : (
          <ul className="divide-y divide-line-soft" aria-label="Filings">
            <li
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1.4fr)_120px_170px_minmax(0,2fr)_170px_110px] gap-4 bg-card-2 px-5 py-3 md:grid"
            >
              <span className="sl-th">Filing</span>
              <span className="sl-th">Period</span>
              <span className="sl-th">Status</span>
              <span className="sl-th">Summary</span>
              <span className="sl-th">Last change</span>
              <span />
            </li>
            {rows.map((r) => {
              const isOpen = open === r.id;
              return (
                <li key={r.id} className={cx(isOpen && "bg-card-2/60")}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_120px_170px_minmax(0,2fr)_170px_110px] md:px-5">
                    <div className="min-w-0 font-semibold text-ink">
                      {names.get(r.filingType) ?? r.filingType}
                      <div className="text-xs font-normal text-ink-muted md:hidden">
                        {periodLabel(r.periodKey)} · {when(r.updatedAt)}
                      </div>
                    </div>
                    <div className="hidden text-sm tabular-nums text-ink md:block">
                      {periodLabel(r.periodKey)}
                    </div>
                    <div className="order-first col-span-2 md:order-none md:col-span-1">
                      <FilingStatusChip status={r.status} />
                    </div>
                    <div className="hidden truncate text-xs text-ink-muted md:block">
                      {summaryText(r.summary)}
                    </div>
                    <div className="hidden text-xs text-ink-muted md:block">
                      {when(r.updatedAt)}
                    </div>
                    <div className="row-start-2 flex justify-end md:row-auto">
                      <button
                        type="button"
                        className={cx(
                          "sl-btn sl-pill-sm",
                          r.status === "PENDING" && !isOpen && "sl-btn-blue"
                        )}
                        aria-expanded={isOpen}
                        onClick={() => toggle(r.id)}
                      >
                        {isOpen ? "Close" : "Review"}
                        {isOpen ? (
                          <ChevronDown size={15} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={15} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="space-y-4 px-4 pb-5 md:px-5">
                      {r.notes && <p className="m-0 text-sm text-ink">{r.notes}</p>}
                      {Object.keys(r.summary).length > 0 && (
                        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {Object.entries(r.summary).map(([k, v]) => (
                            <div key={k} className="rounded-[14px] bg-card px-3 py-2 shadow-sm">
                              <dt className="text-xs text-ink-muted">{k}</dt>
                              <dd className="m-0 text-base font-semibold tabular-nums text-ink">
                                {figure(v)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <ApprovalPanel row={r} onChange={replace} userId={userId} />
                      {r.history.length > 0 && (
                        <div>
                          <h3 className="sl-section-label m-0 mb-2">Activity</h3>
                          <ol className="space-y-1.5 border-l-2 border-line pl-4 text-xs text-ink-muted">
                            {r.history.map((h, i) => (
                              <li key={i}>
                                <span className="text-ink">
                                  {h.event.replace(/_/g, " ").toLowerCase()}
                                </span>{" "}
                                · {when(h.at)}
                                {h.note ? ` · ${h.note}` : ""}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
    </div>
  );
};

export default FilingApprovalsPage;
