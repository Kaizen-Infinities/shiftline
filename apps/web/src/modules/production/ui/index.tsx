/**
 * Small UI v2 helpers shared by the production screens (orders, planning, shop floor,
 * machines). Built on the v2 primitives and `.sl-*` classes; every colour is a token.
 */
import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { ActionPill, cx } from "../../../components/ui/v2";

/* ------------------------------------------------------------------ formatting */

const qtyFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1234567.5" → "₹12,34,567.50"; empty → "—". Display only, never used for maths. */
export const formatINR = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? inrFormatter.format(n) : "—";
};

/** Quantity with en-IN grouping and an optional unit: "1,250 kg". */
export const formatQty = (
  value: string | number | null | undefined,
  uom?: string | null
): string => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return uom ? `${qtyFormatter.format(n)} ${uom}` : qtyFormatter.format(n);
};

/** "INJECTION_MOULDING" → "Injection moulding". */
export const humanize = (value: string | null | undefined): string => {
  if (!value) return "—";
  const s = String(value).replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/* ------------------------------------------------------------------ layout */

/** Page body: vertical rhythm between tiles. */
export const PageBody: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => <div className={cx("flex w-full min-w-0 flex-col gap-5", className)}>{children}</div>;

/**
 * Sticky form footer: Cancel (white pill) on the left of Save (green CTA). Stays at the
 * bottom of the viewport while the form scrolls.
 */
export const StickyFormFooter: React.FC<{
  children: React.ReactNode;
  /** Optional hint on the left ("F2 saves"). */
  hint?: React.ReactNode;
  className?: string;
}> = ({ children, hint, className }) => (
  <div
    className={cx(
      "sl-tile sticky bottom-3 z-20 flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5 sm:py-3",
      className
    )}
  >
    <div className="sl-muted hidden text-[13px] sm:block">{hint}</div>
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
      {children}
    </div>
  </div>
);

/** A labelled figure inside a summary tile: small slate label, big tabular number. */
export const Figure: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
  size?: "md" | "lg";
  className?: string;
}> = ({ label, value, hint, tone = "default", size = "md", className }) => (
  <div className={cx("min-w-0", className)}>
    <div className="text-[13px] font-medium leading-5 text-ink-subtle">{label}</div>
    <div
      className={cx(
        "font-bold tabular-nums leading-tight tracking-tight",
        size === "lg" ? "text-[26px] sm:text-[28px]" : "text-[20px]",
        tone === "success" && "text-[color:var(--color-success)]",
        tone === "warning" && "text-[color:var(--color-warning)]",
        tone === "danger" && "text-[color:var(--color-danger)]",
        tone === "accent" && "text-accent",
        tone === "default" && "text-ink"
      )}
    >
      {value}
    </div>
    {hint && <div className="mt-0.5 text-[12px] text-ink-subtle">{hint}</div>}
  </div>
);

/** Read-only key/value pair for detail tiles and view modals. */
export const InfoItem: React.FC<{
  label: React.ReactNode;
  value?: React.ReactNode;
  className?: string;
  mono?: boolean;
}> = ({ label, value, className, mono }) => (
  <div className={cx("min-w-0", className)}>
    <dt className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle">{label}</dt>
    <dd
      className={cx(
        "m-0 mt-0.5 break-words text-[15px] font-medium text-ink",
        mono && "font-mono text-[14px]"
      )}
    >
      {value === null || value === undefined || value === "" ? "—" : value}
    </dd>
  </div>
);

/** Failed-load tile with a Retry pill; never shows raw server text. */
export const ErrorTile: React.FC<{
  title?: React.ReactNode;
  message?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}> = ({ title = "Could not load this screen", message, onRetry, className }) => (
  <div
    role="alert"
    className={cx("sl-tile flex flex-col items-center gap-3 px-6 py-10 text-center", className)}
  >
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card-2 text-[color:var(--color-danger)]">
      <AlertTriangle size={22} aria-hidden="true" />
    </span>
    <p className="m-0 font-semibold text-ink">{title}</p>
    {message && <p className="sl-muted m-0 max-w-md text-sm">{message}</p>}
    {onRetry && (
      <ActionPill variant="secondary" icon={<RotateCw size={16} />} onClick={onRetry}>
        Retry
      </ActionPill>
    )}
  </div>
);

/** Row of icon-pill actions in a table cell. */
export const RowActions: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cx("flex items-center justify-end gap-1.5", className)}>{children}</div>;

/** Big numeric stepper for the shop floor: 56px − / number / + with a numeric keypad. */
export const QtyStepper: React.FC<{
  id?: string;
  name?: string;
  value: string | number;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  disabled?: boolean;
  label: string;
  inputMode?: "numeric" | "decimal";
  className?: string;
}> = ({
  id,
  name,
  value,
  onChange,
  step = 1,
  min = 0,
  disabled,
  label,
  inputMode = "numeric",
  className,
}) => {
  const bump = (delta: number) => {
    const n = Number(value) || 0;
    const next = Math.max(min, n + delta);
    onChange(String(Number(next.toFixed(3))));
  };
  return (
    <div className={cx("flex items-stretch gap-2", className)}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => bump(-step)}
        disabled={disabled}
        className="sl-btn h-14 w-14 shrink-0 !p-0 text-2xl font-bold"
      >
        −
      </button>
      <input
        id={id}
        name={name}
        type="number"
        inputMode={inputMode}
        aria-label={label}
        value={value}
        min={min}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="sl-input h-14 min-w-0 flex-1 text-center text-[22px] font-bold tabular-nums"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => bump(step)}
        disabled={disabled}
        className="sl-btn h-14 w-14 shrink-0 !p-0 text-2xl font-bold"
      >
        +
      </button>
    </div>
  );
};
