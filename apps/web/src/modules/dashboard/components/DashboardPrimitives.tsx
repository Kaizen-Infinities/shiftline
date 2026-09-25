import React from "react";
import { Link } from "react-router-dom";

/* ════════════════════════════════════════════════════════════════
   DASHBOARD BUILDING BLOCKS (UI v2)
   Every dashboard widget composes from these so the home screen reads as
   one family of white rounded tiles: a pale-blue icon square, a title, a
   quiet subtitle, and a friendly empty state when there is nothing to show.
   Colours come only from theme tokens (docs/specs/UI-v2.md).
   ════════════════════════════════════════════════════════════════ */

type IconType = React.ComponentType<{ className?: string; size?: number | string }>;

/** A white rounded tile. `as="section"` gives the landmark a label via its header. */
export const DashTile: React.FC<{
  className?: string;
  children: React.ReactNode;
  labelledBy?: string;
}> = ({ className = "", children, labelledBy }) => (
  <section
    aria-labelledby={labelledBy}
    className={`sl-tile flex min-w-0 flex-col overflow-hidden ${className}`}
  >
    {children}
  </section>
);

/** Tile header: icon square, title, optional subtitle and trailing actions. */
export const TileHeader: React.FC<{
  id?: string;
  icon: IconType;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ id, icon: Icon, title, subtitle, actions, className = "" }) => (
  <header
    className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-5 pb-3 ${className}`}
  >
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-chip text-accent"
      >
        <Icon className="text-[18px]" />
      </span>
      <div className="min-w-0">
        <h2 id={id} className="sl-h2 truncate text-[15px] leading-tight">
          {title}
        </h2>
        {subtitle && <p className="sl-muted mt-0.5 truncate text-xs">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>
);

/** A friendly line, a quiet hint and (optionally) the one thing to do next. */
export const EmptyState: React.FC<{
  icon: IconType;
  title: string;
  hint?: string;
  action?: { label: string; to: string } | null;
  tone?: "neutral" | "success";
  className?: string;
}> = ({ icon: Icon, title, hint, action, tone = "neutral", className = "" }) => (
  <div
    className={`flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center ${className}`}
  >
    <span
      aria-hidden="true"
      className={`mb-1 grid h-12 w-12 place-items-center rounded-2xl ${
        tone === "success" ? "sl-chip-success" : "bg-chip text-accent"
      }`}
    >
      <Icon className="text-xl" />
    </span>
    <p className="text-sm font-semibold text-ink">{title}</p>
    {hint && <p className="sl-muted max-w-[34ch] text-xs leading-relaxed">{hint}</p>}
    {action && (
      <Link to={action.to} className="sl-btn mt-2 px-4 py-2 text-sm">
        {action.label}
      </Link>
    )}
  </div>
);

/** The concept's grey slabs: a few rows standing in for a list while it loads. */
export const SkeletonRows: React.FC<{ rows?: number; className?: string }> = ({
  rows = 4,
  className = "",
}) => (
  <div className={`flex flex-col gap-3 px-5 pb-5 ${className}`} aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <div className="sl-skeleton h-10 w-10 shrink-0 rounded-[12px]" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="sl-skeleton h-3 w-2/3" />
          <div className="sl-skeleton h-3 w-1/3" />
        </div>
        <div className="sl-skeleton h-6 w-16 rounded-full" />
      </div>
    ))}
  </div>
);

export type Trend = "up" | "down" | "neutral";

/** Stat tile: label, big number, delta chip and an icon square. */
export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  icon: IconType;
  trend?: Trend;
  note?: string;
  onClick?: () => void;
}> = ({ label, value, icon: Icon, trend = "neutral", note, onClick }) => {
  const chipTone =
    trend === "up" ? "sl-chip-success" : trend === "down" ? "sl-chip-danger" : "sl-chip-muted";
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="sl-tile sl-tile-hover group flex min-w-0 flex-col gap-2.5 p-4 text-left sm:gap-3 sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[13px] leading-snug font-medium text-ink-muted">{label}</span>
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] bg-chip text-accent sm:h-9 sm:w-9"
        >
          <Icon className="text-base" />
        </span>
      </div>
      <div className="truncate text-[1.375rem] leading-none font-bold tracking-tight text-ink tabular-nums sm:text-[1.75rem]">
        {value}
      </div>
      {note && (
        <span className={`sl-chip ${chipTone} self-start px-2.5 py-0.5 text-xs`}>
          {arrow && (
            <span aria-label={trend === "up" ? "rising" : "falling"} role="img">
              {arrow}
            </span>
          )}
          {note}
        </span>
      )}
    </button>
  );
};

/** Skeleton stand-in for a StatTile. */
export const StatTileSkeleton: React.FC = () => (
  <div className="sl-tile flex flex-col gap-4 p-5" aria-hidden="true">
    <div className="flex items-start justify-between">
      <div className="sl-skeleton h-3 w-24" />
      <div className="sl-skeleton h-9 w-9 rounded-[12px]" />
    </div>
    <div className="sl-skeleton h-7 w-32" />
    <div className="sl-skeleton h-5 w-20 rounded-full" />
  </div>
);

/** A compact segmented control built from chips (period, chart type, tabs). */
export function ChipToggle<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full border border-line-soft bg-card p-1 shadow-[var(--shadow-sm)]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-label={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`sl-chip cursor-pointer ${
            value === o.value ? "" : "bg-transparent text-ink-muted hover:bg-card-2"
          } ${size === "sm" ? "px-2.5 py-1 text-xs" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small "View all →" link used in tile headers. */
export const TileLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link
    to={to}
    className="rounded-full px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-chip"
  >
    {children}
  </Link>
);
