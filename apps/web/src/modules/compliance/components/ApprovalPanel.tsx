import React, { useState } from "react";
import { toast } from "react-toastify";
import { Check, CheckCircle2, Circle, Send, X } from "lucide-react";

import CancelReasonModal from "../../../components/ui/CancelReasonModal/CancelReasonModal";
import { ActionPill, Chip, chipClass, cx, type ChipTone } from "../../../components/ui/v2";
import { usePermission } from "../../../hooks/usePermission";
import { filingService, type FilingApprovalRow } from "../../../services/filingService";

/**
 * The approval gate as a panel (P1-04, PC7). Any filing screen (GSTR-1, ECR, payroll run)
 * drops it in with the gate row it registered; it shows the status, who prepared and approved,
 * and the actions the signed-in user may take. The API enforces every rule; the panel only
 * hides what cannot be done.
 */
export const STATUS_TONE: Record<FilingApprovalRow["status"], ChipTone> = {
  DRAFT: "muted",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUBMITTED: "info",
};
/** Chip classes per status (kept for callers that style their own element). */
export const STATUS_STYLE: Record<FilingApprovalRow["status"], string> = {
  DRAFT: chipClass({ tone: "muted", size: "sm" }),
  PENDING: chipClass({ tone: "warning", size: "sm" }),
  APPROVED: chipClass({ tone: "success", size: "sm" }),
  REJECTED: chipClass({ tone: "danger", size: "sm" }),
  SUBMITTED: chipClass({ tone: "info", size: "sm" }),
};
export const STATUS_LABEL: Record<FilingApprovalRow["status"], string> = {
  DRAFT: "Draft",
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUBMITTED: "Submitted",
};
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

/** A filing status as a chip with a dot: text plus colour, never colour alone. */
export const FilingStatusChip: React.FC<{
  status: FilingApprovalRow["status"];
  size?: "sm" | "md";
}> = ({ status, size = "sm" }) => (
  <Chip tone={STATUS_TONE[status]} size={size} dot>
    {STATUS_LABEL[status]}
  </Chip>
);

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

  const steps: { label: string; at: string | null }[] = [
    { label: "Prepared", at: row.preparedAt },
    { label: "Sent", at: row.sentForApprovalAt },
    { label: "Approved", at: row.approvedAt },
    { label: "Submitted", at: row.submittedAt },
  ];

  return (
    <div className="space-y-3" data-testid={`approval-panel-${row.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <FilingStatusChip status={row.status} size="md" />
        {row.status === "REJECTED" && row.rejectReason && (
          <span className="text-sm text-[color:var(--color-danger)]">{row.rejectReason}</span>
        )}
        {row.status === "SUBMITTED" && row.submissionRef && (
          <Chip tone="muted" size="sm">
            Ref {row.submissionRef}
          </Chip>
        )}
        <span className="flex-1" />
        {canSend && (
          <ActionPill
            size="sm"
            variant="blue"
            icon={<Send size={15} />}
            loading={busy === "send"}
            disabled={busy !== null}
            onClick={() => run("send", () => filingService.send(row.id), "Sent for approval")}
          >
            {row.status === "REJECTED" ? "Send again" : "Send for approval"}
          </ActionPill>
        )}
        {canDecide && (
          <>
            <ActionPill
              size="sm"
              variant="secondary"
              className="sl-btn-soft-danger"
              icon={<X size={15} />}
              disabled={busy !== null}
              onClick={() => setRejecting(true)}
            >
              Reject
            </ActionPill>
            <ActionPill
              size="sm"
              variant="cta"
              icon={<Check size={15} />}
              loading={busy === "approve"}
              disabled={busy !== null}
              onClick={() => run("approve", () => filingService.approve(row.id), "Approved")}
            >
              Approve
            </ActionPill>
          </>
        )}
        {canSubmit && !submitting && (
          <ActionPill
            size="sm"
            variant="cta"
            disabled={busy !== null}
            onClick={() => setSubmitting(true)}
          >
            Mark submitted
          </ActionPill>
        )}
      </div>
      {submitting && (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-card-2 p-3">
          <input
            className="sl-input h-10 w-full py-0 text-sm sm:w-80"
            placeholder="Acknowledgement / ARN (optional)"
            aria-label="Acknowledgement / ARN (optional)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            maxLength={120}
          />
          <ActionPill
            size="sm"
            variant="cta"
            loading={busy === "submit"}
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
          </ActionPill>
          <ActionPill size="sm" variant="secondary" onClick={() => setSubmitting(false)}>
            Back
          </ActionPill>
        </div>
      )}
      {detailed && (
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Approval steps">
          {steps.map((s) => (
            <li
              key={s.label}
              className={cx(
                "flex items-start gap-2 rounded-[14px] px-3 py-2",
                s.at ? "bg-nav-active" : "bg-card-2"
              )}
            >
              {s.at ? (
                <CheckCircle2
                  size={16}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-[color:var(--color-success)]"
                />
              ) : (
                <Circle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-subtle" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink">{s.label}</div>
                <div className="text-xs text-ink-muted">{when(s.at)}</div>
              </div>
            </li>
          ))}
        </ol>
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
