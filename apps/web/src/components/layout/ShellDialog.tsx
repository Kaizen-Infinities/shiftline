import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { useT } from "../../i18n/I18nProvider";

interface ShellDialogProps {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/** Small confirmation dialog for the shell (sign out): 24px radius over a frosted scrim. */
const ShellDialog: React.FC<ShellDialogProps> = ({
  open,
  title,
  children,
  confirmText,
  onConfirm,
  onCancel,
  busy,
}) => {
  const titleId = useId();
  const { t } = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
      if (event.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled])");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="sl-backdrop sl-anim-fade absolute inset-0" onClick={onCancel} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sl-popover sl-anim-pop relative w-full max-w-sm rounded-[24px] p-6"
      >
        <h2 id={titleId} className="sl-h2">
          {title}
        </h2>
        {children && <div className="mt-2 text-sm text-ink-muted">{children}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="sl-btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="sl-btn-blue" onClick={onConfirm} disabled={busy}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ShellDialog;
