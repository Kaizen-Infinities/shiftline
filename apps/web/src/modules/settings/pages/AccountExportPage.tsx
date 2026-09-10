import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  accountExportService,
  type AccountExportRow,
} from "../../../services/accountExportService";

/**
 * Account export (P1-03): everything the company holds in Shiftline as one archive, built in
 * the background and downloadable for 24 hours. Secrets never leave; the manifest says what is in.
 */
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-1.5 text-sm text-ink";
const STATUS: Record<AccountExportRow["status"], string> = {
  QUEUED: "bg-sky-100 text-sky-800",
  RUNNING: "bg-amber-100 text-amber-800",
  READY: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
  EXPIRED: "bg-slate-100 text-slate-700",
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const size = (n: number | null) =>
  n === null
    ? "—"
    : n > 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(1)} MB`
      : `${Math.ceil(n / 1024)} KB`;
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const AccountExportPage: React.FC = () => {
  const { can } = usePermission();
  const [rows, setRows] = useState<AccountExportRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await accountExportService.list());
    } catch (err) {
      toast.error(message(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Poll while an export is being built.
  useEffect(() => {
    if (!rows.some((r) => r.status === "QUEUED" || r.status === "RUNNING")) return;
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [rows, load]);

  const request = async () => {
    setBusy(true);
    try {
      const r = await accountExportService.request();
      toast.success(
        r.queued ? "Export queued; you will be notified when it is ready" : "Export ready"
      );
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async (row: AccountExportRow) => {
    try {
      await accountExportService.download(row);
      await load();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const inProgress = rows.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Account Export</h2>
          <p className="text-sm text-ink-muted">
            Everything your company holds in Shiftline, every table as JSON lines plus your uploaded
            files, in one archive. Passwords, tokens and integration credentials are never included.
            Archives can be downloaded for 24 hours.
          </p>
        </div>
        {can("account-export.create") && (
          <button type="button" className={primary} disabled={busy || inProgress} onClick={request}>
            {inProgress ? "Building…" : busy ? "Requesting…" : "Request export"}
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Requested</th>
              <th className={th}>Status</th>
              <th className={th}>Contents</th>
              <th className={th}>Size</th>
              <th className={th}>Available until</th>
              <th className={th}>Downloads</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((r) => {
              const tables = r.tableCounts ? Object.keys(r.tableCounts).length : 0;
              const total = r.tableCounts
                ? Object.values(r.tableCounts).reduce((a, b) => a + b, 0)
                : 0;
              return (
                <tr key={r.id}>
                  <td className={td}>{when(r.requestedAt)}</td>
                  <td className={td}>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[r.status]}`}
                    >
                      {r.status}
                    </span>
                    {r.error && <div className="text-xs text-rose-700">{r.error}</div>}
                  </td>
                  <td className={`${td} text-xs text-ink-muted`}>
                    {r.status === "READY" || r.status === "EXPIRED"
                      ? `${total.toLocaleString("en-IN")} rows · ${tables} tables · ${r.attachmentCount} files`
                      : "—"}
                  </td>
                  <td className={`${td} tabular-nums`}>{size(r.sizeBytes)}</td>
                  <td className={td}>{when(r.expiresAt)}</td>
                  <td className={`${td} tabular-nums`}>{r.downloads}</td>
                  <td className={td}>
                    {r.status === "READY" && (
                      <button type="button" className={secondary} onClick={() => download(r)}>
                        Download
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={7}>
                  No exports yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AccountExportPage;
