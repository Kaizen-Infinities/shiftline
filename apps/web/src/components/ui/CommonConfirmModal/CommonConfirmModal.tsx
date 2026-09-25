import React, { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import CustomButton from "../Button/Button";
import { FaTrash } from "react-icons/fa";
import { AlertTriangle, HelpCircle } from "lucide-react";
import type { CommonConfirmModalProps } from "./common-confirm-modal.types";

/** Confirm dialog: icon tile, question, optional warning and Cancel / Confirm pills. */
const CommonConfirmModal: React.FC<CommonConfirmModalProps> = ({
  show,
  isOpen,
  onHide,
  onClose,
  onConfirm,
  title = "Confirm Action",
  message = "Are you sure you want to perform this action?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmVariant = "danger",
  confirmDisabled = false,
  isLoading = false,
  isDangerous,
  warningText = "This action cannot be undone.",
  loadingText = "Processing...",
  confirmIcon = FaTrash,
}) => {
  const isVisible = show ?? isOpen ?? false;
  const handleClose = onHide ?? onClose ?? (() => {});
  const dangerMode = isDangerous ?? confirmVariant === "danger";
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isVisible) handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, handleClose]);

  if (!isVisible || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sl-backdrop z-[99999] flex items-center justify-center p-4"
      onClick={handleClose}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div
        className="sl-dialog relative my-auto w-full max-w-sm overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pb-5 pt-7 text-center">
          <div
            className={`sl-dialog-icon mx-auto mb-4 ${dangerMode ? "sl-dialog-icon-danger" : ""}`}
            aria-hidden="true"
          >
            {dangerMode ? <AlertTriangle size={24} /> : <HelpCircle size={24} />}
          </div>

          <h5 id={titleId} className="sl-dialog-title mb-1.5">
            {title}
          </h5>

          <div id={messageId} className="text-sm leading-relaxed text-ink-muted">
            {message}
          </div>

          {warningText && (
            <p className="m-0 mt-2 text-[13px] font-medium text-ink-subtle">{warningText}</p>
          )}
        </div>

        <div className="sl-dialog-footer justify-center">
          <CustomButton
            text={cancelText}
            variant="secondary"
            onClick={handleClose}
            disabled={isLoading}
            size="md"
            className="flex-1"
          />
          <CustomButton
            text={isLoading ? loadingText : confirmText}
            icon={confirmIcon}
            variant={dangerMode ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={confirmDisabled || isLoading}
            loading={isLoading}
            size="md"
            className="flex-1"
          />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CommonConfirmModal;
