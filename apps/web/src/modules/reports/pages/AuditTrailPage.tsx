import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { usePermission } from "../../../hooks/usePermission";
import {
  auditTrailService,
  type AuditEntry,
  type AuditFilters,
  type AuditPage,
  type AuditQuery,
} from "../../../services/auditTrailService";
import { formatDateTime } from "../../../utils/dateUtils";
import { History } from "lucide-react";
import {
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type ChipTone,
} from "../../../components/ui/v2";

/**
 * Audit trail (P1-09d, MCA Rule 3(1)): every change to the books, documents, payroll and
 * masters as the database recorded it. Filter by entity, record, user, action and date; open a
 * row to see the fields that changed. Read-only by design; nothing here can edit or delete.
 */
const input = "sl-input mt-1.5 h-11 w-full px-3.5 text-left text-[15px] font-normal text-ink";
const labelCls = "flex flex-col text-left text-[13px] font-semibold text-ink-muted";
const primary = "sl-btn-blue sl-pill-sm";
const secondary = "sl-btn sl-pill-sm";

const ACTION_TONE: Record<string, ChipTone> = {
  CREATE: "success",
  UPDATE: "warning",
  DELETE: "danger",
};

const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const shortId = (id: string | null) => (id && id.length > 12 ? `${id.slice(0, 8)}…` : (id ?? "—"));

const PAGE_SIZE = 50;

type Draft = Required<Omit<AuditQuery, "page" | "pageSize">>;
const emptyDraft: Draft = {
  entity: "",
  entityId: "",
  action: "",
  userId: "",
  requestId: "",
  from: "",
  to: "",
};

const AuditTrailPage: React.FC = () => {
  const { can } = usePermission();
  const [params, setParams] = useSearchParams();

  const fromUrl = useMemo<Draft>(
    () => ({
      entity: params.get("entity") ?? "",
      entityId: params.get("entityId") ?? "",
      action: params.get("action") ?? "",
      userId: params.get("userId") ?? "",
      requestId: params.get("requestId") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
    }),
    [params]
  );
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const [draft, setDraft] = useState<Draft>(fromUrl);
  const [filters, setFilters] = useState<AuditFilters | null>(null);
  const [result, setResult] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setDraft(fromUrl);
  }, [fromUrl]);

  useEffect(() => {
    auditTrailService
      .filters()
      .then(setFilters)
      .catch((err) => toast.error(message(err)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await auditTrailService.list({ ...fromUrl, page, pageSize: PAGE_SIZE }));
      setOpen(null);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [fromUrl, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(draft)) if (v) next.set(k, v);
    setParams(next);
  };

  const reset = () => {
    setDraft(emptyDraft);
    setParams(new URLSearchParams());
  };

  const goto = (p: number) => {
    const next = new URLSearchParams(params);
    if (p > 1) next.set("page", String(p));
    else next.delete("page");
    setParams(next);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await auditTrailService.exportCsv(fromUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setExporting(false);
    }
  };

  const summary = (row: AuditEntry) => {
    if (row.action === "CREATE") return "Created";
    if (row.action === "DELETE") return "Deleted";
    const fields = row.changes.map((c) => c.field);
    if (fields.length === 0) return "No field changed";
    const shown = fields.slice(0, 3).join(", ");
    return fields.length > 3
      ? `${fields.length} fields: ${shown}, …`
      : `${fields.length} field${fields.length === 1 ? "" : "s"}: ${shown}`;
  };

  const first = result ? (result.page - 1) * result.pageSize + 1 : 0;
  const last = result ? Math.min(result.total, result.page * result.pageSize) : 0;

  return (
    <div className="sl-page">
      <PageHeader
        title="Audit trail"
        subtitle="Every change to the books, documents, payroll and masters, recorded by the database and never editable."
        icon={<History size={22} />}
        actions={
          can("audit-reports.export") && (
            <button
              type="button"
              className={secondary}
              onClick={() => void exportCsv()}
              disabled={exporting || !result || result.total === 0}
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          )
        }
      />

      <form
        onSubmit={apply}
        className="sl-tile grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:p-5 md:grid-cols-4"
      >
        <label className={labelCls}>
          Entity
          <select
            className={input}
            value={draft.entity}
            onChange={(e) => setDraft({ ...draft, entity: e.target.value })}
          >
            <option value="">All entities</option>
            {filters?.entities.map((en) => (
              <option key={en.table} value={en.table}>
                {en.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Record id
          <input
            className={input}
            value={draft.entityId}
            onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
            placeholder="Row id"
          />
        </label>
        <label className={labelCls}>
          Action
          <select
            className={input}
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          >
            <option value="">All actions</option>
            {(filters?.actions ?? ["CREATE", "UPDATE", "DELETE"]).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          User
          <select
            className={input}
            value={draft.userId}
            onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
          >
            <option value="">Anyone</option>
            {filters?.users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.fullName} ({u.username})
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          From
          <input
            type="date"
            className={input}
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label className={labelCls}>
          To
          <input
            type="date"
            className={input}
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <label className={labelCls}>
          Request id
          <input
            className={input}
            value={draft.requestId}
            onChange={(e) => setDraft({ ...draft, requestId: e.target.value })}
            placeholder="From an error or log line"
          />
        </label>
        <div className="flex items-end gap-2 md:justify-end">
          <button type="submit" className={primary} disabled={loading}>
            Run report
          </button>
          <button type="button" className={secondary} onClick={reset} disabled={loading}>
            Reset
          </button>
        </div>
      </form>

      <div className="sl-tile overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-card-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Record</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">By</th>
              <th className="px-4 py-3">Changes</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="p-0">
                  <SkeletonRows rows={6} columns={6} header={false} label="Loading…" />
                </td>
              </tr>
            )}
            {!loading && result && result.data.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    compact
                    icon={<History size={22} strokeWidth={1.75} />}
                    title="Nothing recorded for these filters."
                  />
                </td>
              </tr>
            )}
            {!loading &&
              result?.data.map((row) => (
                <React.Fragment key={row.id}>
                  <tr
                    className="h-[52px] cursor-pointer border-t border-line-soft hover:bg-card-2"
                    onClick={() => setOpen(open === row.id ? null : row.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-ink">
                      {formatDateTime(row.changedAt)}
                    </td>
                    <td className="px-4 py-2 text-ink">{row.entityLabel}</td>
                    <td
                      className="px-4 py-2 font-mono text-xs text-ink-muted"
                      title={row.entityId ?? ""}
                    >
                      {shortId(row.entityId)}
                    </td>
                    <td className="px-4 py-2">
                      <Chip size="sm" tone={ACTION_TONE[row.action] ?? "muted"}>
                        {row.action}
                      </Chip>
                    </td>
                    <td className="px-4 py-2 text-ink">
                      {row.actor.name}
                      {row.impersonatedBy && (
                        <span className="ml-1 text-xs text-[color:var(--color-warning)]">
                          (impersonated by {row.impersonatedBy})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">{summary(row)}</td>
                    <td className="px-4 py-2 text-ink-muted">{open === row.id ? "▾" : "▸"}</td>
                  </tr>
                  {open === row.id && (
                    <tr className="border-t border-line-soft bg-card-2/60">
                      <td colSpan={7} className="px-4 py-3">
                        <Details row={row} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
          </tbody>
        </table>
      </div>

      {result && result.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <span>
            Showing {first}–{last} of {result.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className={secondary}
              onClick={() => goto(result.page - 1)}
              disabled={result.page <= 1 || loading}
            >
              Previous
            </button>
            <span className="self-center">
              Page {result.page} of {result.pages}
            </span>
            <button
              type="button"
              className={secondary}
              onClick={() => goto(result.page + 1)}
              disabled={result.page >= result.pages || loading}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Details: React.FC<{ row: AuditEntry }> = ({ row }) => {
  const values = row.action === "DELETE" ? row.oldValues : row.newValues;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
        <span>
          Record <span className="font-mono text-ink">{row.entityId ?? "—"}</span>
        </span>
        <span>
          Table <span className="font-mono text-ink">{row.entity}</span>
        </span>
        <span>
          Request <span className="font-mono text-ink">{row.requestId ?? "—"}</span>
        </span>
        <span>
          Actor <span className="text-ink">{row.actor.type}</span>
        </span>
      </div>
      {row.action === "UPDATE" ? (
        row.changes.length === 0 ? (
          <p className="text-ink-muted">The row was saved without any field changing.</p>
        ) : (
          <table className="min-w-[40%] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="py-1 pr-4">Field</th>
                <th className="py-1 pr-4">Before</th>
                <th className="py-1">After</th>
              </tr>
            </thead>
            <tbody>
              {row.changes.map((c) => (
                <tr key={c.field} className="border-t border-line-soft">
                  <td className="py-1 pr-4 font-mono text-xs text-ink">{c.field}</td>
                  <td className="py-1 pr-4 text-[color:var(--color-danger)] line-through">
                    {fmt(c.from)}
                  </td>
                  <td className="py-1 text-[color:var(--color-success)]">{fmt(c.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-3">
          {Object.entries(values ?? {}).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="font-mono text-xs text-ink-muted">{k}</dt>
              <dd className="truncate text-ink" title={fmt(v)}>
                {fmt(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};

export default AuditTrailPage;
