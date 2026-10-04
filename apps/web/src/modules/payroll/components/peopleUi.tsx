import React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cx } from "../../../components/ui/v2";

/**
 * Shared bits for the People & Payroll screens (UI v2): Indian money formatting,
 * token-only table classes, a small figure block and a toned notice tile.
 */

const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** "₹12,34,567.50" (or "₹12,34,568" with `decimals: 0`); empty values read "—". */
export const formatINR = (
  value: number | string | null | undefined,
  options: { decimals?: 0 | 2 } = {}
): string => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return (options.decimals === 0 ? inr0 : inr2).format(n);
};

/** Tile-sized rupees: full below a lakh, then "₹12.35L" / "₹1.23Cr". */
export const formatINRCompact = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  return inr0.format(n);
};

/** en-IN grouping for counts and quantities. */
export const formatNumber = (value: number | string | null | undefined, digits = 0): string => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits });
};

/** "24 Sep 2026". */
export const formatDay = (iso: string | Date | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/** "2026-09" → "September 2026" (other strings pass through). */
export const periodLabel = (period: string | null | undefined): string => {
  if (!period) return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

/** The server's friendly message, never raw error text. */
export const errorMessage = (err: unknown, fallback = "Something went wrong"): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/** The last `count` months, newest first, as period keys with readable labels. */
export const monthOptions = (count: number) => {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
};

/** The last `count` Indian financial years, newest first. */
export const fyOptions = (count: number) => {
  const now = new Date();
  const current = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const start = current - i;
    const key = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
    return { value: key, label: `FY ${key}` };
  });
};

/** Plain-table classes that match DataTable's header band and rows. */
export const th = "sl-th bg-card-2 px-4 py-3 text-left text-[12px] font-semibold text-ink-muted";
export const td = "px-4 py-3 text-sm text-ink";
export const tr = "border-t border-line-soft";
export const num = "text-right tabular-nums";
/** Native select / input in the v2 look. */
export const inputClass = "sl-input h-11";
export const inputSmClass = "sl-input h-10 text-sm";

/** A figure inside a tile: small slate label, a tabular value, optional hint. */
export const Figure: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
}> = ({ label, value, hint, tone = "default", className }) => (
  <div className={cx("rounded-[14px] bg-card-2 px-4 py-3", className)}>
    <p className="m-0 text-[12px] font-medium text-ink-subtle">{label}</p>
    <p
      className="m-0 mt-1 text-lg font-bold tabular-nums tracking-tight text-ink"
      style={tone === "default" ? undefined : { color: `var(--color-${tone})` }}
    >
      {value}
    </p>
    {hint && <p className="m-0 mt-0.5 text-[12px] text-ink-subtle">{hint}</p>}
  </div>
);

const NOTICE_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

/** A toned callout tile (warnings, "not worked out yet", errors with Retry). */
export const Notice: React.FC<{
  tone?: keyof typeof NOTICE_ICON;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ tone = "info", title, children, action, className }) => {
  const Icon = NOTICE_ICON[tone];
  const color = `var(--color-${tone})`;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex flex-col gap-3 rounded-[18px] border px-4 py-3.5 text-sm text-ink sm:flex-row sm:items-center",
        className
      )}
      style={{
        borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
        background: `color-mix(in srgb, ${color} 9%, var(--color-card))`,
      }}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color }} />
        <div className="min-w-0">
          {title && <p className="m-0 font-semibold">{title}</p>}
          {children && (
            <div className={cx("text-ink-muted", title ? "mt-0.5" : undefined)}>{children}</div>
          )}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
};

/** Initials avatar in a pale-blue circle (people lists). */
export const Avatar: React.FC<{ name?: string | null; size?: number; className?: string }> = ({
  name,
  size = 36,
  className,
}) => {
  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-chip font-semibold text-chip-fg",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials}
    </span>
  );
};

/** Page wrapper: the standard gutters and vertical rhythm for a v2 page. */
export const PageShell: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cx("sl-page", className)}>{children}</div>;

/* ── Drop-in v2 replacements for the old GST-screen helpers ─────────────────── */

/** Native select / input. */
export const field = "sl-input h-10 w-auto text-sm";
export const primary = "sl-cta sl-pill-sm";
export const secondary = "sl-btn sl-pill-sm";
export const success = "sl-btn-blue sl-pill-sm";
export const danger = "sl-btn-danger sl-pill-sm";
/** Row action rendered as a small text-ish pill. */
export const linkBtn = "sl-btn-ghost sl-pill-sm !px-2.5";
/** Rupees with two decimals, en-IN. */
export const money = (n: number | string | null | undefined) => formatINR(n ?? 0);
export const day = (iso: string | null | undefined) => formatDay(iso);
export const message = (err: unknown) => errorMessage(err);

/** A titled content tile (an `.sl-tile` with an `.sl-h2` header). */
export const Card: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, children, actions, className }) => (
  <section className={cx("sl-tile", className)}>
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
      <div className="min-w-0">
        <h2 className="sl-h2 m-0">{title}</h2>
        {subtitle && <p className="sl-muted m-0 mt-0.5 text-sm">{subtitle}</p>}
      </div>
      {actions}
    </header>
    <div className="p-4 pt-3 sm:p-5 sm:pt-4">{children}</div>
  </section>
);

/** A hairline-bordered table frame that scrolls sideways inside a tile. */
export const TableWrap: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={cx("overflow-x-auto rounded-[14px] border border-line-soft", className)}>
    {children}
  </div>
);
