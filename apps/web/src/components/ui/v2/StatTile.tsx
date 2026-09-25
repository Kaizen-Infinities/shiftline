import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cx } from "./cx";
import { Chip, type ChipTone } from "./Chip";

export interface StatTileProps {
  /** Small slate label above the number ("Receivables"). */
  label: React.ReactNode;
  /** The big number, already formatted ("₹4.2L", "128"). */
  value: React.ReactNode;
  /** Change indicator shown as a chip ("+12%"). */
  delta?: React.ReactNode;
  /** Arrow direction for the delta; also picks the default tone (up = success, down = danger). */
  deltaDirection?: "up" | "down";
  deltaTone?: ChipTone;
  /** A line under the value ("vs last month"). */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** Shows grey slabs in place of the value. */
  loading?: boolean;
  /** Makes the whole tile a router link. */
  to?: string;
  onClick?: () => void;
  className?: string;
}

/** Dashboard stat: label, big tabular number, optional delta chip and icon, inside a tile. */
export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  delta,
  deltaDirection,
  deltaTone,
  hint,
  icon,
  loading = false,
  to,
  onClick,
  className,
}) => {
  const tone: ChipTone =
    deltaTone ??
    (deltaDirection === "up" ? "success" : deltaDirection === "down" ? "danger" : "muted");
  const interactive = Boolean(to || onClick);

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-medium leading-5 text-ink-subtle">{label}</span>
        {icon && (
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-chip text-accent"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-2 space-y-2" aria-hidden="true">
          <div className="sl-skeleton h-8 w-2/3" />
          <div className="sl-skeleton h-3 w-1/3" />
        </div>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-end gap-x-2.5 gap-y-1">
            <span className="sl-stat-value">{value}</span>
            {delta !== undefined && delta !== null && (
              <Chip tone={tone} size="sm" className="mb-1">
                {deltaDirection === "up" && <ArrowUpRight size={12} aria-hidden="true" />}
                {deltaDirection === "down" && <ArrowDownRight size={12} aria-hidden="true" />}
                {delta}
              </Chip>
            )}
          </div>
          {hint && <p className="m-0 mt-1.5 text-[13px] text-ink-subtle">{hint}</p>}
        </>
      )}
      {loading && <span className="sr-only">Loading</span>}
    </>
  );

  const classes = cx(
    "sl-tile block p-4 sm:p-5 text-left text-ink",
    interactive && "sl-tile-hover cursor-pointer",
    className
  );

  if (to) {
    return (
      <Link to={to} className={classes} onClick={onClick}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx(classes, "w-full")}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
};

export default StatTile;
