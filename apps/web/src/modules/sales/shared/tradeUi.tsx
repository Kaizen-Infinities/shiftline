import React from "react";
import { cx } from "../../../components/ui/v2";

/**
 * Small presentation helpers shared by the trade screens (sales, purchases, customers,
 * suppliers, exports). Display only: nothing here changes a stored or computed value.
 */

const inr = (decimals: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
const INR2 = inr(2);
const INR0 = inr(0);

/** "1234567.5" → "₹12,34,567.50"; empty → "—". */
export const formatINR = (
  value: string | number | null | undefined,
  options: { decimals?: 0 | 2; blank?: string } = {}
): string => {
  if (value === null || value === undefined || value === "") return options.blank ?? "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return options.blank ?? "—";
  return (options.decimals === 0 ? INR0 : INR2).format(n);
};

/** Compact rupees for tiles: < 1 lakh in full, then "₹12.35L" / "₹1.23Cr". */
export const formatINRCompact = (value: string | number | null | undefined): string => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  return INR0.format(n);
};

/** "2026-09-24" → "24 Sep 2026"; empty or invalid → "—". */
export const formatDateIN = (value: string | Date | null | undefined): string => {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Page frame for trade screens: full width with a comfortable maximum. */
export const PAGE_CLASS = "mx-auto w-full max-w-[1600px]";

/** Sticky footer for create/edit forms: Cancel (white pill) and the green Save pill. */
export const FormFooter: React.FC<{
  children: React.ReactNode;
  /** Left side: a hint such as the keyboard shortcut or the totals. */
  start?: React.ReactNode;
  className?: string;
}> = ({ children, start, className }) => (
  <div
    className={cx(
      "sl-tile sticky bottom-3 z-20 mt-4 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5",
      className
    )}
  >
    <div className="min-w-0 text-[13px] text-ink-subtle">{start}</div>
    <div className="flex flex-wrap items-center justify-end gap-2.5">{children}</div>
  </div>
);

/** A labelled key figure for summary tiles: small slate label, big tabular number. */
export const KeyFigure: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  emphasis?: boolean;
  className?: string;
}> = ({ label, value, hint, emphasis, className }) => (
  <div className={cx("min-w-0", className)}>
    <div className="text-[13px] font-medium text-ink-subtle">{label}</div>
    <div
      className={cx(
        "mt-0.5 break-words font-semibold tabular-nums text-ink",
        emphasis ? "text-2xl tracking-tight" : "text-base"
      )}
    >
      {value}
    </div>
    {hint && <div className="mt-0.5 text-[12px] text-ink-subtle">{hint}</div>}
  </div>
);

/** Keyboard hint shown in form footers. */
export const KeyHint: React.FC<{ keys: string[]; children: React.ReactNode }> = ({
  keys,
  children,
}) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    {keys.map((k) => (
      <kbd key={k} className="sl-kbd">
        {k}
      </kbd>
    ))}
    <span>{children}</span>
  </span>
);
