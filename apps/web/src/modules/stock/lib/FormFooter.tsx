import React from "react";
import { cx } from "../../../components/ui/v2";

/**
 * Sticky action bar at the bottom of an inventory form: Cancel / secondary pills on the
 * left of the primary green pill, pinned to the bottom of the viewport while the form scrolls.
 */
const FormFooter: React.FC<{
  children: React.ReactNode;
  /** Optional hint on the left ("Ctrl+Enter saves", totals). */
  hint?: React.ReactNode;
  className?: string;
}> = ({ children, hint, className }) => (
  <div
    className={cx(
      "sl-sticky-footer z-20 mt-5 flex flex-col gap-3 rounded-[18px] border border-line-soft bg-card/95 px-4 py-3 shadow-[var(--shadow-md)] backdrop-blur sm:flex-row sm:items-center sm:justify-between",
      className
    )}
  >
    <div className="min-w-0 text-[13px] text-ink-subtle">{hint}</div>
    <div className="flex flex-wrap items-center justify-end gap-2.5">{children}</div>
  </div>
);

export default FormFooter;
