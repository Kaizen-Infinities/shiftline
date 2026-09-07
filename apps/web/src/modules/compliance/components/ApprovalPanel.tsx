import React, { useState } from "react";
import { toast } from "react-toastify";

import CancelReasonModal from "../../../components/ui/CancelReasonModal/CancelReasonModal";
import { usePermission } from "../../../hooks/usePermission";
import { filingService, type FilingApprovalRow } from "../../../services/filingService";

/**
 * The approval gate as a panel (P1-04, PC7). Any filing screen (GSTR-1, ECR, payroll run)
 * drops it in with the gate row it registered; it shows the status, who prepared and approved,
 * and the actions the signed-in user may take. The API enforces every rule; the panel only
 * hides what cannot be done.
 */
export const STATUS_STYLE: Record<FilingApprovalRow["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  SUBMITTED: "bg-sky-100 text-sky-800",
};
export const STATUS_LABEL: Record<FilingApprovalRow["status"], string> = {
  DRAFT: "Draft",
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUBMITTED: "Submitted",
};
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const success = `${btn} bg-emerald-600 text-white hover:bg-emerald-700`;
const danger = `${btn} border border-rose-300 text-rose-700 hover:bg-rose-50`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

export interface ApprovalPanelProps {
  row: FilingApprovalRow;
  onChange?: (row: FilingApprovalRow) => void;
  /** When false the panel renders one line of status and actions only. */
  detailed?: boolean;
  /** The current user's id; the preparer sees no approve button. */
  userId?: string | null;
}

const ApprovalPanel: React.FC<ApprovalPanelProps> = ({
  row,
  onChange,
  detailed = true,
  userId,
}) => {
  const { can } = usePermission();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ref, setRef] = useState("");

  const run = async (label: string, fn: () => Promise<FilingApprovalRow>, done: string) => {
    setBusy(label);
    try {
      const next = await fn();
      toast.success(done);
      onChange?.(next);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(null);
    }
  };

  const canSend = can("filings.prepare") && (row.status === "DRAFT" || row.status === "REJECTED");
  const canDecide =
    can("filings.approve") && row.status === "PENDING" && (!userId || userId !== row.preparedBy);
  const canSubmit = can("filings.submit") && row.status === "APPROVED";

  return (
    <div className="space-y-2" data-testid={`approval-panel-${row.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[row.status]}`}
        >
          {STATUS_LABEL[row.status]}
        </span>
        {row.status === "REJECTED" && row.rejectReason && (
          <span className="text-xs text-rose-700">{row.rejectReason}</span>
        )}
        {row.status === "SUBMITTED" && row.submissionRef && (
          <span className="text-xs text-ink-muted">Ref {row.submissionRef}</span>
        )}
        <span className="flex-1" />
        {canSend && (
          <button
            type="button"
            className={primary}
            disabled={busy !== null}
            onClick={() => run("send", () => filingService.send(row.id), "Sent for approval")}
          >
            {row.status === "REJECTED" ? "Send again" : "Send for approval"}
          </button>
        )}
        {canDecide && (
          <>
            <button
              type="button"
              className={success}
              disabled={busy !== null}
              onClick={() => run("approve", () => filingService.approve(row.id), "Approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className={danger}
              disabled={busy !== null}
              onClick={() => setRejecting(true)}
            >
              Reject
            </button>
          </>
        )}
        {canSubmit && !submitting && (
          <button
            type="button"
            className={secondary}
            disabled={busy !== null}
            onClick={() => setSubmitting(true)}
          >
            Mark submitted
          </button>
        )}
      </div>
      {submitting && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="rounded-lg border border-line-soft bg-card-2 px-3 py-1.5 text-sm text-ink"
            placeholder="Acknowledgement / ARN (optional)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            maxLength={120}
          />
          <button
            type="button"
            className={primary}
            disabled={busy !== null}
            onClick={() =>
              run(
                "submit",
                () => filingService.markSubmitted(row.id, ref.trim() || null),
                "Marked as submitted"
              ).then(() => setSubmitting(false))
            }
          >
            Confirm
          </button>
          <button type="button" className={secondary} onClick={() => setSubmitting(false)}>
            Back
          </button>
        </div>
      )}
      {detailed && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted md:grid-cols-4">
          <dt>Prepared</dt>
          <dd className="text-ink">{when(row.preparedAt)}</dd>
          <dt>Sent</dt>
          <dd className="text-ink">{when(row.sentForApprovalAt)}</dd>
          <dt>Approved</dt>
          <dd className="text-ink">{when(row.approvedAt)}</dd>
          <dt>Submitted</dt>
          <dd className="text-ink">{when(row.submittedAt)}</dd>
        </dl>
      )}
      <CancelReasonModal
        show={rejecting}
        onHide={() => setRejecting(false)}
        isLoading={busy === "reject"}
        title="Reject this filing?"
        message="It goes back to the preparer with your reason. Nothing is filed."
        confirmText="Reject"
        onConfirm={async (reason) => {
          await run("reject", () => filingService.reject(row.id, reason), "Rejected");
          setRejecting(false);
        }}
      />
    </div>
  );
};

export default ApprovalPanel;
