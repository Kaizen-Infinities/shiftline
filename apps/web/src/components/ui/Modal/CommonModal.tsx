import React, { useEffect, useId } from "react";
import { X } from "lucide-react";

export interface CommonModalProps {
  show: boolean;
  onHide: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  overflowVisible?: boolean;
  maxWidth?:
    "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full" | "wide";
}

const maxWidthMap: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
  full: "max-w-[60vw]",
  wide: "max-w-[95vw]",
};

/** General dialog: blurred backdrop, 24px card, title with a close pill, body and pill footer. */
const CommonModal: React.FC<CommonModalProps> = ({
  show,
  onHide,
  title,
  children,
  footer,
  overflowVisible,
  maxWidth = "lg",
}) => {
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && show) onHide();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [show, onHide]);

  if (!show) return null;

  const widthClass = maxWidthMap[maxWidth] || "max-w-6xl";

  return (
    <div
      className="sl-backdrop z-[9999] flex items-center justify-center p-3 sm:p-4"
      onClick={onHide}
    >
      <div
        className={`sl-dialog w-full ${widthClass} flex max-h-[90dvh] flex-col ${overflowVisible ? "overflow-visible" : "overflow-hidden"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sl-dialog-header items-center border-b border-line-soft pb-4">
          <h3 id={titleId} className="sl-dialog-title">
            {title}
          </h3>
          <button
            type="button"
            onClick={onHide}
            aria-label="Close dialog"
            title="Close"
            className="sl-icon-btn sl-icon-btn-md sl-icon-btn-ghost -mr-2 shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div
          className={`min-h-0 flex-1 px-4 py-5 sm:px-6 ${overflowVisible ? "overflow-visible" : "overflow-y-auto"}`}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && <div className="sl-dialog-footer">{footer}</div>}
      </div>
    </div>
  );
};

export default CommonModal;
