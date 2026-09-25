import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import type { CommonViewModalProps } from "./commonViewModal.types";

/** Read-only record dialog: avatar, title and status chips, then labelled field rows by section. */
const CommonViewModal: React.FC<CommonViewModalProps> = ({
  show,
  onHide,
  modalTitle,
  avatarText,
  headerTitle,
  headerSubtitle,
  statusNode,
  sections,
  size = "lg",
  footer,
  customContent,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && show) onHide();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [show, onHide]);

  useEffect(() => {
    if (show) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [show]);

  if (!show) return null;

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6">
      <div className="sl-backdrop" onClick={onHide} aria-hidden="true" />

      <div
        ref={modalRef}
        className={`sl-dialog relative flex max-h-[90dvh] w-full ${sizeClasses[size]} flex-col overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Header with title info */}
        <div className="border-b border-line-soft px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              {avatarText && (
                <div
                  className="sl-brand-tile h-12 w-12 shrink-0 text-base font-bold"
                  aria-hidden="true"
                >
                  {avatarText}
                </div>
              )}
              <div className="min-w-0">
                {modalTitle && headerTitle && (
                  <p className="m-0 mb-0.5 text-[12px] font-medium text-ink-subtle">{modalTitle}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={titleId} className="sl-dialog-title truncate">
                    {headerTitle || modalTitle}
                  </h3>
                  {statusNode && <div className="shrink-0">{statusNode}</div>}
                </div>
                {headerSubtitle && (
                  <p className="m-0 mt-0.5 text-sm text-ink-muted">{headerSubtitle}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onHide}
              aria-label="Close dialog"
              title="Close"
              className="sl-icon-btn sl-icon-btn-md sl-icon-btn-ghost -mr-2 -mt-1 shrink-0"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {sections.map((section, sIdx) => (
            <section key={sIdx} className={sIdx > 0 ? "mt-3" : undefined}>
              {section.title && (
                <h4 className="sl-section-label m-0 px-3 pb-1.5 pt-2">{section.title}</h4>
              )}
              <dl className="m-0 overflow-hidden rounded-[14px] border border-line-soft">
                {section.fields.map((field, fIdx) => (
                  <div
                    key={fIdx}
                    className={`flex flex-col gap-0.5 border-b border-line-soft px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4 ${field.xs === 12 ? "col-span-full" : ""}`}
                  >
                    <dt className="shrink-0 text-[13px] text-ink-subtle sm:w-[170px]">
                      {field.label}
                    </dt>
                    <dd className="m-0 min-w-0 break-words text-sm font-semibold text-ink">
                      {field.value || "-"}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          {customContent && <div className="px-2 py-4">{customContent}</div>}
        </div>

        {/* Footer */}
        {footer && <div className="sl-dialog-footer">{footer}</div>}
      </div>
    </div>
  );
};

export default CommonViewModal;
