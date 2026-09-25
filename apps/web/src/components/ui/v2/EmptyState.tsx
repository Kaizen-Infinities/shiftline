import React from "react";
import { Inbox } from "lucide-react";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** Icon in the pale-blue circle; defaults to an inbox. Pass `null` for none. */
  icon?: React.ReactNode;
  /** The friendly line ("No invoices yet"). */
  title: React.ReactNode;
  /** Optional second line with a hint. */
  description?: React.ReactNode;
  /** Optional action, usually the screen's primary `<ActionPill>`. */
  action?: React.ReactNode;
  /** Tighter spacing for use inside tables and small tiles. */
  compact?: boolean;
  className?: string;
}

/** Friendly empty state: an icon in a pale-blue circle, one line, an optional hint and action. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}) => (
  <div
    className={cx(
      "flex flex-col items-center justify-center text-center",
      compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-12",
      className
    )}
  >
    {icon !== null && (
      <span
        className={cx(
          "flex items-center justify-center rounded-full bg-chip text-accent",
          compact ? "h-12 w-12" : "h-16 w-16"
        )}
        aria-hidden="true"
      >
        {icon ?? <Inbox size={compact ? 22 : 28} strokeWidth={1.75} />}
      </span>
    )}
    <div className="max-w-md">
      <p className={cx("m-0 font-semibold text-ink", compact ? "text-[15px]" : "text-base")}>
        {title}
      </p>
      {description && <p className="m-0 mt-1 text-sm text-ink-subtle">{description}</p>}
    </div>
    {action && (
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>
    )}
  </div>
);

export default EmptyState;
