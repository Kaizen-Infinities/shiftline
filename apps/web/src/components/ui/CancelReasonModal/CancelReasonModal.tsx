import React, { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

import CustomButton from "../Button/Button";

/**
 * "Cancel with reason" dialog (P1-10d). Books are never deleted: a document is cancelled, its
 * voucher reversed, and the reason lands in the audit trail. The reason is required.
 */
export interface CancelReasonModalProps {
  show: boolean;
  onHide: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  title?: string;
  message?: React.ReactNode;
  confirmText?: string;
  isLoading?: boolean;
  /** Minimum reason length; the button stays disabled below it. */
  minLength?: number;
}

const CancelReasonModal: React.FC<CancelReasonModalProps> = ({
  show,
  onHide,
  onConfirm,
  title = "Cancel this record?",
  message = "It stays in the books as cancelled and its ledger entries are reversed. Nothing is deleted.",
  confirmText = "Cancel record",
  isLoading = false,
  minLength = 3,
}) => {
  const [reason, setReason] = useState("");
  const titleId = useId();
  const reasonId = useId();
  const hintId = useId();

  useEffect(() => {
    if (show) setReason("");
  }, [show]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && show && !isLoading) onHide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, isLoading, onHide]);

  if (!show || typeof document === "undefined") return null;
  const ok = reason.trim().length >= minLength;

  return createPortal(
    <div
      className="sl-backdrop z-[99999] flex items-center justify-center p-4"
      onClick={() => !isLoading && onHide()}
    >
      <div
        className="sl-dialog w-full max-w-md overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pb-5 pt-7">
          <div className="sl-dialog-icon sl-dialog-icon-danger mx-auto mb-4" aria-hidden="true">
            <AlertTriangle size={24} />
          </div>
          <h5 id={titleId} className="sl-dialog-title mb-1.5 text-center">
            {title}
          </h5>
          <p className="m-0 mb-5 text-center text-sm leading-relaxed text-ink-muted">{message}</p>
          <label htmlFor={reasonId} className="sl-label">
            Reason
            <span className="sl-required" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id={reasonId}
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is it being cancelled? This is kept in the audit trail."
            aria-describedby={hintId}
            aria-required="true"
            className="sl-input resize-y py-2.5 text-sm"
            data-testid="cancel-reason"
          />
          <p id={hintId} className="sl-field-hint m-0">
            At least {minLength} characters.
          </p>
        </div>
        <div className="sl-dialog-footer">
          <CustomButton
            text="Keep it"
            variant="secondary"
            onClick={onHide}
            disabled={isLoading}
            size="md"
          />
          <CustomButton
            text={isLoading ? "Cancelling…" : confirmText}
            variant="danger"
            onClick={() => onConfirm(reason.trim())}
            disabled={!ok || isLoading}
            loading={isLoading}
            size="md"
          />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CancelReasonModal;
