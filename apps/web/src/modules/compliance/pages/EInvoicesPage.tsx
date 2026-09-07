import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import {
  eInvoiceService,
  type EInvoiceRow,
  type EInvoiceStatus,
} from "../../../services/eInvoiceService";

/** E-invoice register (P1-11): every IRN request with its outcome, filterable by status and type. */
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-1.5 text-sm text-ink";
const STATUS: Record<EInvoiceStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  GENERATED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-slate-100 text-slate-700",
};
const TYPE: Record<EInvoiceRow["docType"], string> = {
  INV: "Invoice",
  CRN: "Credit note",
  DBN: "Debit note",
};
const linkFor = (r: EInvoiceRow) =>
  r.docType === "INV"
    ? `/sales-invoices/${r.docId}`
    : r.docType === "CRN"
      ? "/returns/sales"
      : "/returns/purchase";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const EInvoicesPage: React.FC = () => {
  const [rows, setRows] = useState<EInvoiceRow[]>([]);
  const [status, setStatus] = useState<EInvoiceStatus | "">("");
  const [docType, setDocType] = useState<EInvoiceRow["docType"] | "">("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        await eInvoiceService.list({ ...(status && { status }), ...(docType && { docType }) })
      );
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [status, docType]);
  useEffect(() => {
    void load();
  }, [load]);

  const failed = rows.filter((r) => r.status === "FAILED").length;
  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">E-invoice Register</h2>
          <p className="text-sm text-ink-muted">
            Every IRN raised or refused by the portal for invoices, credit notes and debit notes.
            Failed ones can be retried from the document.
          </p>
        </div>
        {failed > 0 && (
          <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800">
            {failed} failed
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-line-soft bg-card px-3 py-1.5 text-sm text-ink"
          value={status}
          onChange={(e) => setStatus(e.target.value as EInvoiceStatus | "")}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS) as EInvoiceStatus[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-line-soft bg-card px-3 py-1.5 text-sm text-ink"
          value={docType}
          onChange={(e) => setDocType(e.target.value as EInvoiceRow["docType"] | "")}
          aria-label="Document type"
        >
          <option value="">All documents</option>
          {(Object.keys(TYPE) as EInvoiceRow["docType"][]).map((t) => (
            <option key={t} value={t}>
              {TYPE[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Document</th>
              <th className={th}>Date</th>
              <th className={th}>Buyer GSTIN</th>
              <th className={th}>Status</th>
              <th className={th}>IRN / Ack</th>
              <th className={th}>Last change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  <Link className="font-medium text-blue-600 hover:underline" to={linkFor(r)}>
                    {TYPE[r.docType]} {r.docNo}
                  </Link>
                </td>
                <td className={td}>{day(r.docDate)}</td>
                <td className={`${td} font-mono text-xs`}>{r.buyerGstin}</td>
                <td className={td}>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[r.status]}`}
                  >
                    {r.status}
                  </span>
                  {r.error && (
                    <div className="max-w-xs truncate text-xs text-rose-700" title={r.error}>
                      {r.error}
                    </div>
                  )}
                </td>
                <td className={`${td} font-mono text-xs`}>
                  {r.irn ? (
                    <>
                      <div title={r.irn}>{r.irn.slice(0, 16)}…</div>
                      <div className="text-ink-muted">{r.ackNo}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${td} text-xs`}>{when(r.updatedAt)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={6}>
                  No e-invoices yet. Raise one from a B2B invoice once e-invoicing is enabled in
                  Settings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default EInvoicesPage;
