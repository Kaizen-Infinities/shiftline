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
import { Chip, type ChipTone } from "../../../components/ui/v2";

/**
 * The IRN strip on a document (P1-11): whether e-invoicing applies, the button to raise the
 * IRN, the number and acknowledgement once it exists, and cancellation within the portal's
 * 24-hour window. Drops into the invoice, credit note and debit note screens.
 */
const primary = "sl-btn-blue sl-pill-sm";
const danger = "sl-btn-soft-danger sl-pill-sm";
const secondary = "sl-btn sl-pill-sm";
const STATUS_TONE: Record<EInvoiceRow["status"], ChipTone> = {
  PENDING: "warning",
  GENERATED: "success",
  FAILED: "danger",
  CANCELLED: "muted",
};
const STATUS_LABEL: Record<EInvoiceRow["status"], string> = {
  PENDING: "Pending",
  GENERATED: "IRN generated",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
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
    <div className="sl-tile space-y-3 p-4 no-print" data-testid="e-invoice-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="sl-h2 m-0 text-base">E-invoice</span>
        {row && (
          <Chip tone={STATUS_TONE[row.status]} size="sm" dot>
            {STATUS_LABEL[row.status]}
          </Chip>
        )}
        {!row && applies && !applies.applies && (
          <span className="text-xs text-ink-muted">Not applicable: {applies.reason}</span>
        )}
        {!row && applies?.applies && applies.deadline && (
          <Chip tone="warning" size="sm">
            IRN due by {applies.deadline}
          </Chip>
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
        <dl className="m-0 grid gap-x-4 gap-y-1 rounded-[12px] bg-card-2 p-3 text-xs text-ink-muted sm:grid-cols-[auto_1fr]">
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
      {row?.status === "FAILED" && (
        <p className="m-0 text-xs text-[color:var(--color-danger)]">{row.error}</p>
      )}
      {row?.status === "CANCELLED" && (
        <p className="text-xs text-ink-muted">
          Cancelled {when(row.cancelledAt)} · {row.cancelRemarks}. This number cannot get a new IRN.
        </p>
      )}
      {cancelling && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="sl-input h-10 w-auto py-0 text-sm"
            aria-label="Cancellation reason"
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
            className="sl-input h-10 min-w-[220px] flex-1 py-0 text-sm"
            aria-label="Remarks"
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
