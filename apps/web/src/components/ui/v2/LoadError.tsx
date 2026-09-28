import React from "react";
import { CloudOff, RotateCw } from "lucide-react";
import { cx } from "./cx";

export interface LoadErrorProps {
  /** What failed, in the user's words ("Couldn't load customers"). */
  title?: React.ReactNode;
  /** Optional second line; defaults to a connection hint. */
  description?: React.ReactNode;
  /** Retry handler; the button is hidden without one. */
  onRetry?: () => void;
  /** True while the retry is in flight. */
  retrying?: boolean;
  /** Tighter spacing for use inside tables and small tiles. */
  compact?: boolean;
  className?: string;
}

/**
 * A load that failed: says so plainly and offers a retry, so a failed request
 * never reads as "nothing here yet". `role="alert"` announces it once.
 */
export const LoadError: React.FC<LoadErrorProps> = ({
  title = "Couldn't load this",
  description = "Check your connection, then try again.",
  onRetry,
  retrying = false,
  compact = false,
  className,
}) => (
  <div
    role="alert"
    className={cx(
      "flex flex-col items-center justify-center text-center",
      compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-12",
      className
    )}
  >
    <span
      aria-hidden="true"
      className={cx(
        "sl-chip-danger flex items-center justify-center rounded-full",
        compact ? "h-12 w-12" : "h-16 w-16"
      )}
    >
      <CloudOff size={compact ? 22 : 28} strokeWidth={1.75} />
    </span>
    <div className="max-w-md">
      <p className={cx("m-0 font-semibold text-ink", compact ? "text-[15px]" : "text-base")}>
        {title}
      </p>
      {description && <p className="m-0 mt-1 text-sm text-ink-subtle">{description}</p>}
    </div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="sl-btn mt-1 min-h-10 px-4 py-2 text-sm"
      >
        <RotateCw
          size={16}
          aria-hidden="true"
          className={retrying ? "animate-spin motion-reduce:animate-none" : undefined}
        />
        {retrying ? "Trying again…" : "Try again"}
      </button>
    )}
  </div>
);

export interface StaleNoticeProps {
  /** Retry handler; the button is hidden without one. */
  onRetry?: () => void;
  retrying?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/**
 * A refresh that failed while older data is still on screen: a one-line
 * warning with a retry, so the user knows the figures may be out of date.
 */
export const StaleNotice: React.FC<StaleNoticeProps> = ({
  onRetry,
  retrying = false,
  children = "Couldn't refresh. Showing the last data that loaded.",
  className,
}) => (
  <div
    role="status"
    className={cx(
      "sl-chip-warning flex flex-wrap items-center justify-between gap-2 rounded-[12px] px-4 py-2 text-sm font-medium",
      className
    )}
  >
    <span>{children}</span>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
      >
        <RotateCw
          size={14}
          aria-hidden="true"
          className={retrying ? "animate-spin motion-reduce:animate-none" : undefined}
        />
        {retrying ? "Trying again…" : "Try again"}
      </button>
    )}
  </div>
);

export default LoadError;
