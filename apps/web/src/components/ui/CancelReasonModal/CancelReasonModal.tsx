import React, { useEffect, useState } from "react";
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
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => !isLoading && onHide()}
    >
      <div
        className="bg-card border border-line-soft rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 border border-red-500/20">
            <AlertTriangle className="text-red-400" size={22} />
          </div>
          <h5 className="text-lg font-bold text-ink text-center mb-1">{title}</h5>
          <p className="text-sm text-ink-muted text-center mb-4">{message}</p>
          <label className="block text-xs font-semibold uppercase tracking-wide text-ink-subtle mb-1">
            Reason
          </label>
          <textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is it being cancelled? This is kept in the audit trail."
            className="w-full rounded-lg border border-line-soft bg-card-2 px-3 py-2 text-sm text-ink outline-none focus:border-red-400"
            data-testid="cancel-reason"
          />
          <div className="flex justify-end gap-2.5 mt-5">
            <CustomButton
              text="Keep it"
              variant="secondary"
              onClick={onHide}
              disabled={isLoading}
            />
            <CustomButton
              text={isLoading ? "Cancelling…" : confirmText}
              variant="danger"
              onClick={() => onConfirm(reason.trim())}
              disabled={!ok || isLoading}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CancelReasonModal;
