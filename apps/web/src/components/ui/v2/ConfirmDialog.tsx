import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Destructive actions get `.sl-btn-danger`, everything else `.sl-btn-blue`. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * Accessible confirm dialog: role="alertdialog", focus moves in and is trapped,
 * Escape cancels, focus returns to the trigger on close.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title = "Please confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelFn = useRef(onCancel);
  useEffect(() => {
    cancelFn.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancelFn.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "var(--sl-scrim)" }}
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        className="sl-tile w-full max-w-sm p-6"
        style={{ borderRadius: 24, boxShadow: "var(--sl-shadow-dialog)" }}
      >
        <h2 id={titleId} className="m-0 text-base font-semibold text-ink">
          {title}
        </h2>
        <p
          id={descId}
          className="mb-0 mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted"
        >
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="sl-btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={cx(destructive ? "sl-btn-danger" : "sl-btn-blue")}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

/**
 * Promise-based confirm. Render `dialog` once in the component:
 *   const [confirm, dialog] = useConfirm();
 *   if (!(await confirm({ message: "…", destructive: true }))) return;
 *   return <>…{dialog}</>
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const settle = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  const dialog = (
    <ConfirmDialog
      open={opts !== null}
      title={opts?.title}
      message={opts?.message}
      confirmText={opts?.confirmText}
      cancelText={opts?.cancelText}
      destructive={opts?.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return [confirm, dialog];
}
