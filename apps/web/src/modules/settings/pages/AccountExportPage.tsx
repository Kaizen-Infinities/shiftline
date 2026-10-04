import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  accountExportService,
  type AccountExportRow,
} from "../../../services/accountExportService";
import { Archive, Download } from "lucide-react";
import { ActionPill, Chip, EmptyState, PageHeader, type ChipTone } from "../../../components/ui/v2";

/**
 * Account export (P1-03): everything the company holds in Shiftline as one archive, built in
 * the background and downloadable for 24 hours. Secrets never leave; the manifest says what is in.
 */
const secondary = "sl-btn sl-pill-sm";
const th = "sl-th bg-card-2 px-3 py-2.5 text-left first:rounded-l-xl last:rounded-r-xl";
const td = "px-3 py-2.5 text-sm text-ink";
const STATUS: Record<AccountExportRow["status"], ChipTone> = {
  QUEUED: "muted",
  RUNNING: "warning",
  READY: "success",
  FAILED: "danger",
  EXPIRED: "muted",
};
const STATUS_LABEL: Record<AccountExportRow["status"], string> = {
  QUEUED: "Queued",
  RUNNING: "Building",
  READY: "Ready",
  FAILED: "Failed",
  EXPIRED: "Expired",
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
    <div className="sl-page sl-page-form">
      <PageHeader
        title="Account export"
        icon={<Archive size={22} />}
        subtitle="Everything your company holds in Shiftline, every table as JSON lines plus your uploaded files, in one archive. Passwords, tokens and integration credentials are never included. Archives can be downloaded for 24 hours."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "Account export" }]}
        primaryAction={
          can("account-export.create") ? (
            <ActionPill
              size="lg"
              icon={<Download size={18} />}
              disabled={busy || inProgress}
              loading={busy}
              onClick={request}
            >
              {inProgress ? "Building…" : busy ? "Requesting…" : "Request export"}
            </ActionPill>
          ) : undefined
        }
      />
      <div className="sl-tile overflow-x-auto p-2 sm:p-3">
        <table className="min-w-full">
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
          <tbody>
            {rows.map((r) => {
              const tables = r.tableCounts ? Object.keys(r.tableCounts).length : 0;
              const total = r.tableCounts
                ? Object.values(r.tableCounts).reduce((a, b) => a + b, 0)
                : 0;
              return (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className={td}>{when(r.requestedAt)}</td>
                  <td className={td}>
                    <Chip tone={STATUS[r.status]} size="sm" dot>
                      {STATUS_LABEL[r.status]}
                    </Chip>
                    {r.error && (
                      <div className="text-xs text-[color:var(--color-danger)]">{r.error}</div>
                    )}
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
                <td colSpan={7}>
                  <EmptyState
                    compact
                    icon={<Archive size={22} />}
                    title="No exports yet."
                    description="Request one to get a full copy of your data."
                  />
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
