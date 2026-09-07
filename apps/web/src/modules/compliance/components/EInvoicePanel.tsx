import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { useSocketSync } from "../../../hooks/useSocketSync";
import {
  eInvoiceService,
  type Applicability,
  type EInvoiceDocType,
  type EInvoiceRow,
} from "../../../services/eInvoiceService";

/**
 * The IRN strip on a document (P1-11): whether e-invoicing applies, the button to raise the
 * IRN, the number and acknowledgement once it exists, and cancellation within the portal's
 * 24-hour window. Drops into the invoice, credit note and debit note screens.
 */
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const danger = `${btn} border border-rose-300 text-rose-700 hover:bg-rose-50`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const STATUS: Record<EInvoiceRow["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  GENERATED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-slate-100 text-slate-700",
};
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

export interface EInvoicePanelProps {
  docType: EInvoiceDocType;
  docId: string;
  /** ISO date of the document, for the applicability check. */
  docDate: string;
  buyerGstin: string | null | undefined;
  /** The document is cancelled in the books; nothing can be raised. */
  documentCancelled?: boolean;
}

const EInvoicePanel: React.FC<EInvoicePanelProps> = ({
  docType,
  docId,
  docDate,
  buyerGstin,
  documentCancelled,
}) => {
  const { can } = usePermission();
  const [row, setRow] = useState<EInvoiceRow | null>(null);
  const [applies, setApplies] = useState<Applicability | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("2");
  const [remarks, setRemarks] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([
        eInvoiceService.forDocument(docType, docId),
        eInvoiceService.applicability(docDate.slice(0, 10), buyerGstin),
      ]);
      setRow(r);
      setApplies(a);
    } catch (err) {
      toast.error(message(err));
    }
  }, [docType, docId, docDate, buyerGstin]);
  useEffect(() => {
    void load();
  }, [load]);
  useSocketSync("e-invoice", undefined, load);
  useEffect(() => {
    if (row?.status !== "PENDING") return;
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [row?.status, load]);

  if (!can("e-invoice.view")) return null;

  const generate = async () => {
    setBusy(true);
    try {
      const r = await eInvoiceService.generate(docType, docId);
      setRow(r);
      toast.success(
        r.queued
          ? "IRN requested; the portal is being called"
          : r.status === "GENERATED"
            ? "IRN generated"
            : "IRN request recorded"
      );
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!row) return;
    setBusy(true);
    try {
      setRow(await eInvoiceService.cancel(row.id, reason, remarks));
      toast.success("IRN cancelled on the portal");
      setCancelling(false);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };
  const openCancel = async () => {
    if (Object.keys(reasons).length === 0) {
      try {
        setReasons(await eInvoiceService.cancelReasons());
      } catch {
        setReasons({
          "1": "Duplicate",
          "2": "Data entry mistake",
          "3": "Order cancelled",
          "4": "Other",
        });
      }
    }
    setCancelling(true);
  };

  const withinDay = row?.ackDate
    ? Date.now() - new Date(row.ackDate).getTime() < 24 * 3600 * 1000
    : false;
  const canGenerate =
    can("e-invoice.generate") &&
    !documentCancelled &&
    applies?.applies &&
    (!row || row.status === "FAILED" || row.status === "PENDING");

  return (
    <div
      className="rounded-xl border border-line-soft bg-card p-3 space-y-2 no-print"
      data-testid="e-invoice-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">E-invoice</span>
        {row && (
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[row.status]}`}>
            {row.status}
          </span>
        )}
        {!row && applies && !applies.applies && (
          <span className="text-xs text-ink-muted">Not applicable: {applies.reason}</span>
        )}
        {!row && applies?.applies && applies.deadline && (
          <span className="text-xs text-amber-700">IRN due by {applies.deadline}</span>
        )}
        <span className="flex-1" />
        {canGenerate && (
          <button type="button" className={primary} disabled={busy} onClick={generate}>
            {row?.status === "FAILED" ? "Retry IRN" : "Generate IRN"}
          </button>
        )}
        {row?.status === "GENERATED" && can("e-invoice.cancel") && withinDay && !cancelling && (
          <button type="button" className={danger} disabled={busy} onClick={openCancel}>
            Cancel IRN
          </button>
        )}
      </div>
      {row?.status === "GENERATED" && (
        <dl className="grid gap-x-4 gap-y-0.5 text-xs text-ink-muted sm:grid-cols-[auto_1fr]">
          <dt>IRN</dt>
          <dd className="break-all font-mono text-ink">{row.irn}</dd>
          <dt>Ack</dt>
          <dd className="text-ink">
            {row.ackNo} · {when(row.ackDate)}
            {!withinDay && " · past the 24-hour cancellation window; reverse with a credit note"}
          </dd>
          {row.ewbNo && (
            <>
              <dt>E-way bill</dt>
              <dd className="text-ink">{row.ewbNo}</dd>
            </>
          )}
        </dl>
      )}
      {row?.status === "FAILED" && <p className="text-xs text-rose-700">{row.error}</p>}
      {row?.status === "CANCELLED" && (
        <p className="text-xs text-ink-muted">
          Cancelled {when(row.cancelledAt)} · {row.cancelRemarks}. This number cannot get a new IRN.
        </p>
      )}
      {cancelling && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-line-soft bg-card-2 px-2 py-1.5 text-sm text-ink"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {Object.entries(reasons).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            className="min-w-[220px] flex-1 rounded-lg border border-line-soft bg-card-2 px-3 py-1.5 text-sm text-ink"
            placeholder="Remarks (kept on the portal)"
            value={remarks}
            maxLength={100}
            onChange={(e) => setRemarks(e.target.value)}
          />
          <button
            type="button"
            className={danger}
            disabled={busy || remarks.trim().length < 3}
            onClick={cancel}
          >
            Confirm cancellation
          </button>
          <button type="button" className={secondary} onClick={() => setCancelling(false)}>
            Back
          </button>
        </div>
      )}
    </div>
  );
};

export default EInvoicePanel;
