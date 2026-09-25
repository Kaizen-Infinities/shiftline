import React from "react";
import { cx } from "./cx";

export interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  /** Fully rounded (for avatars and chips). */
  round?: boolean;
}

/** One grey slab (the concept's loading placeholder). */
export const Skeleton: React.FC<SkeletonProps> = ({ className, width, height, round }) => (
  <div
    aria-hidden="true"
    className={cx("sl-skeleton", round && "!rounded-full", className)}
    style={{ width, height }}
  />
);

const WIDTHS = ["72%", "54%", "86%", "40%", "64%", "48%", "78%"];

export interface SkeletonRowsProps {
  rows?: number;
  columns?: number;
  /** Draws a header band like a table header. */
  header?: boolean;
  /** Row height in px; defaults to the 52px table row. */
  rowHeight?: number;
  /** Accessible loading text (visually hidden). */
  label?: string;
  className?: string;
}

/** Table-shaped loading placeholder: a header band and rows of slabs. */
export const SkeletonRows: React.FC<SkeletonRowsProps> = ({
  rows = 5,
  columns = 4,
  header = true,
  rowHeight = 52,
  label = "Loading",
  className,
}) => (
  <div role="status" aria-live="polite" className={cx("w-full", className)}>
    <span className="sr-only">{label}</span>
    {header && (
      <div className="flex items-center gap-6 bg-card-2 px-4 py-3" aria-hidden="true">
        {Array.from({ length: columns }).map((_, c) => (
          <div key={c} className="sl-skeleton h-2.5 flex-1" style={{ maxWidth: 96 }} />
        ))}
      </div>
    )}
    {Array.from({ length: rows }).map((_, r) => (
      <div
        key={r}
        aria-hidden="true"
        className="flex items-center gap-6 border-b border-line-soft px-4 last:border-b-0"
        style={{ height: rowHeight }}
      >
        {Array.from({ length: columns }).map((_, c) => (
          <div key={c} className="flex-1">
            <div
              className="sl-skeleton h-3"
              style={{ width: WIDTHS[(r * 3 + c) % WIDTHS.length], opacity: 1 - r * 0.08 }}
            />
          </div>
        ))}
      </div>
    ))}
  </div>
);

export interface SkeletonTileProps {
  /** Number of text slabs. */
  lines?: number;
  /** Draws a title slab. */
  title?: boolean;
  /** Fixed height for a chart-sized tile. */
  height?: number | string;
  label?: string;
  className?: string;
}

/** A tile full of slabs, for cards and charts that are still loading. */
export const SkeletonTile: React.FC<SkeletonTileProps> = ({
  lines = 3,
  title = true,
  height,
  label = "Loading",
  className,
}) => (
  <div
    role="status"
    aria-live="polite"
    className={cx("sl-tile flex flex-col gap-3 p-4 sm:p-5", className)}
    style={{ height }}
  >
    <span className="sr-only">{label}</span>
    {title && <div aria-hidden="true" className="sl-skeleton h-4 w-2/5" />}
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        aria-hidden="true"
        className="sl-skeleton h-3"
        style={{ width: WIDTHS[i % WIDTHS.length] }}
      />
    ))}
    {height !== undefined && <div aria-hidden="true" className="sl-skeleton mt-1 flex-1" />}
  </div>
);

export default Skeleton;
