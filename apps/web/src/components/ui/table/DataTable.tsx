import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "../v2/EmptyState";
import { LoadError, StaleNotice } from "../v2/LoadError";

export interface DataTableColumn<T> {
  header: string;
  /**
   * Optional JSX to render in the column header instead of the plain `header` string.
   * Use this when you need multi-line or styled header content (e.g. "PRESENT / 7d").
   * `header` is still required for ColumnToggle / CSV export.
   */
  headerNode?: React.ReactNode;
  /** Simple key lookup on the row object */
  accessor?: keyof T;
  /** Custom cell renderer — receives the row and its index. Overrides `accessor` if both given. */
  render?: (row: T, index: number) => React.ReactNode;
  /** Optional explicit width (e.g. "50px"). If omitted, common columns
   *  (#, STATUS, ACTIONS, PRIORITY, etc.) get a sensible default width
   *  automatically based on their header text — see AUTO_WIDTH_BY_HEADER.
   *  Anything else stays tight around its own content (no stretching);
   *  leftover space becomes even gaps between columns instead. */
  width?: string;
  /** Optional alignment for this column's header and cells. Defaults to "left" if not set. */
  align?: "left" | "center" | "right";
}

export interface DataTablePagination {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  emptyMessage?: React.ReactNode;
  pagination?: DataTablePagination;
  className?: string;
  /** Optional row click handler */
  onRowClick?: (row: T, index: number) => void;
  /** Optional function to render a full-width sub-row underneath a row */
  renderSubRow?: (row: T, index: number) => React.ReactNode;
  /** Optional custom class names for the row */
  rowClassName?: (row: T, index: number) => string;
  /** Optional inline styles for the row */
  getRowStyle?: (row: T, index: number) => React.CSSProperties;
  /** Optional override for the default min-height classes */
  minHeightClassName?: string;
  /** Optional override for the default max-height (scroll cap) classes */
  maxHeightClassName?: string;
  /** Row density: `default` = 52px rows, `compact` = 40px rows for dense sub-tables. */
  density?: "default" | "compact";
  /** Accessible name announced for the table region. */
  ariaLabel?: string;
  /** Optional action shown under the empty message (e.g. the screen's primary CTA). */
  emptyAction?: React.ReactNode;
  /**
   * Set when the rows failed to load (e.g. `useListCache().error`). With no rows the
   * table shows a failed-load state instead of the empty message; with rows it keeps
   * them and adds a "couldn't refresh" notice.
   */
  error?: string | null;
  /** Retry for a failed load, usually the cache's `refresh`. */
  onRetry?: () => void;
  /**
   * Rows loaded before client-side search or filtering. Pass it when `data` is a filtered
   * view, so a failed refresh with loaded rows reads as stale data (plus the normal "no
   * matches" message) rather than as a failed load. Defaults to `data.length`.
   */
  sourceRowCount?: number;
}

const alignClass: Record<NonNullable<DataTableColumn<any>["align"]>, string> = {
  left: "text-left justify-start",
  center: "text-center justify-center",
  right: "text-right justify-end",
};

// Sizing for the table region.
//
// MIN is applied *only* in the loading / empty states, where there is no
// content to give the panel height — without it the tile would collapse to a
// sliver. Once real rows are present the panel sizes to its content.
//
// MAX (empty by default) can cap the panel so a long page scrolls internally
// while the sticky header stays in view.
const TABLE_MIN_HEIGHT_CLASS = "min-h-36";
const TABLE_MAX_HEIGHT_CLASS = "";

/** Page numbers to show around the current one: 1 … 4 5 6 … 12. */
const pageWindow = (current: number, total: number): Array<number | "gap"> => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
};

/** List table inside a tile: card-2 header band, 52px rows with hairlines, skeleton loading,
 *  friendly empty state, pill pager and horizontal scroll on narrow screens. */
function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyMessage = "No records found.",
  pagination,
  className = "",
  onRowClick,
  renderSubRow,
  rowClassName,
  getRowStyle,
  minHeightClassName = TABLE_MIN_HEIGHT_CLASS,
  maxHeightClassName = TABLE_MAX_HEIGHT_CLASS,
  density = "default",
  ariaLabel = "Data table",
  emptyAction,
  error = null,
  onRetry,
  sourceRowCount,
}: DataTableProps<T>) {
  const cellPaddingClass = density === "compact" ? "px-3 py-1.5" : "px-3 py-2 sm:px-4";
  const headerPaddingClass = density === "compact" ? "px-3 py-2" : "px-3 py-3 sm:px-4";
  const rowMinHeightClass = density === "compact" ? "min-h-[40px]" : "min-h-[52px]";

  // `minmax(max-content, 1fr)`: a column is never narrower than its content and
  // leftover width is shared out, so the table fills the tile; when the content
  // is wider than the screen the scroll area scrolls sideways.
  const gridTemplateColumns = columns
    .map((col) => col.width ?? "minmax(max-content, 1fr)")
    .join(" ");

  // True while the table shows the skeleton or the empty message instead of rows.
  const showingPlaceholder = loading || data.length === 0;

  // A failed load with nothing loaded at all shows the failed-load state; with rows loaded
  // (even if the current filter hides them all) the rows are stale, not missing.
  const loadedRows = sourceRowCount ?? data.length;
  const loadFailed = Boolean(error) && !loading && loadedRows === 0;
  const staleRows = Boolean(error) && !loading && loadedRows > 0;

  const hasPager = Boolean(pagination && pagination.totalPages > 1);

  const outerGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns,
    width: "100%",
    minWidth: "100%",
  };

  // Each row spans every column and uses `subgrid` so it inherits the outer tracks.
  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridColumn: "1 / -1",
    gridTemplateColumns: "subgrid",
  };

  const fullSpanStyle: React.CSSProperties = { gridColumn: "1 / -1" };

  const skeletonRows = density === "compact" ? 4 : 5;

  return (
    <div className={`sl-tile sl-table-tile w-full overflow-hidden ${className}`}>
      {staleRows && <StaleNotice onRetry={onRetry} className="m-3 mb-0" />}
      <div
        className={`flex flex-col ${showingPlaceholder ? minHeightClassName : ""} ${maxHeightClassName}`}
      >
        <div
          className="flex min-h-0 w-full flex-1 flex-col overflow-auto overscroll-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div
            role="table"
            aria-label={ariaLabel}
            aria-busy={loading || undefined}
            aria-rowcount={showingPlaceholder ? undefined : data.length + 1}
            className="w-full text-sm"
            style={outerGridStyle}
          >
            {/* Header row — cells are individually sticky because a `subgrid`
                row is not a reliable sticky box across browsers. */}
            <div role="row" style={rowStyle}>
              {columns.map((col, i) => (
                <div
                  key={i}
                  role="columnheader"
                  className={`sl-th sticky top-0 z-10 flex items-center border-b border-line-soft bg-card-2 ${headerPaddingClass} ${alignClass[col.align ?? "left"]}`}
                >
                  {col.headerNode ?? col.header}
                </div>
              ))}
            </div>

            {/* Skeleton rows while loading, drawn on the same grid as real rows. */}
            {loading &&
              Array.from({ length: skeletonRows }).map((_, r) => (
                <div
                  key={`sk-${r}`}
                  role="row"
                  aria-hidden="true"
                  style={rowStyle}
                  className={`${rowMinHeightClass} border-b border-line-soft last:border-b-0`}
                >
                  {columns.map((col, ci) => (
                    <div
                      key={ci}
                      role="cell"
                      className={`flex items-center ${cellPaddingClass} ${alignClass[col.align ?? "left"]}`}
                    >
                      <div
                        className="sl-skeleton h-3"
                        style={{
                          width: `${[70, 52, 84, 44, 62][(r + ci) % 5]}%`,
                          minWidth: 24,
                          opacity: 1 - r * 0.12,
                        }}
                      />
                    </div>
                  ))}
                </div>
              ))}

            {/* Body */}
            {!showingPlaceholder &&
              data.map((row, index) => {
                const subRow = renderSubRow ? renderSubRow(row, index) : null;
                const extraClassName = rowClassName ? rowClassName(row, index) : "";
                const extraStyle = getRowStyle ? getRowStyle(row, index) : {};
                const isLast = index === data.length - 1;
                return (
                  <React.Fragment key={rowKey(row)}>
                    <div
                      role="row"
                      style={{ ...rowStyle, ...extraStyle }}
                      className={`${rowMinHeightClass} ${isLast && !subRow ? "" : "border-b border-line-soft"} sl-row-hover transition-colors duration-150 ${onRowClick ? "cursor-pointer focus-visible:bg-nav-hover" : ""} ${extraClassName}`}
                      onClick={() => onRowClick && onRowClick(row, index)}
                      onKeyDown={(event) => {
                        if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          onRowClick(row, index);
                        }
                      }}
                      tabIndex={onRowClick ? 0 : undefined}
                    >
                      {columns.map((col, ci) => (
                        <div
                          key={ci}
                          role="cell"
                          className={`flex min-w-0 items-center gap-1.5 ${cellPaddingClass} text-sm text-ink ${alignClass[col.align ?? "left"]}`}
                        >
                          {col.render ? (
                            col.render(row, index)
                          ) : col.accessor ? (
                            <span
                              className="block truncate"
                              title={String(row[col.accessor] ?? "")}
                            >
                              {String(row[col.accessor] ?? "")}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {subRow && (
                      <div
                        role="row"
                        style={rowStyle}
                        className={isLast ? "" : "border-b border-line-soft"}
                      >
                        <div
                          role="cell"
                          style={fullSpanStyle}
                          className="bg-card-2/60"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {subRow}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
          </div>

          {loading && (
            <p role="status" className="sr-only">
              Loading data...
            </p>
          )}

          {/* Empty state: a flexible sibling of the grid so it can fill the
              reserved height and sit in the middle of the tile. */}
          {!loading && data.length === 0 && (
            <div className="flex min-w-full flex-1 items-center justify-center">
              {loadFailed ? (
                <LoadError compact title="Couldn't load this list" onRetry={onRetry} />
              ) : typeof emptyMessage === "string" ? (
                <EmptyState compact title={emptyMessage} action={emptyAction} />
              ) : (
                <div className="px-6 py-8 text-center text-sm text-ink-subtle">
                  {emptyMessage}
                  {emptyAction && <div className="mt-3 flex justify-center">{emptyAction}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pager: pill buttons at the foot of the tile. */}
        {hasPager && pagination && (
          <nav
            aria-label="Pagination"
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line-soft px-3 py-3 sm:px-4"
          >
            <span className="text-[13px] font-medium text-ink-subtle">
              Page <span className="font-semibold text-ink">{pagination.currentPage}</span> of{" "}
              <span className="font-semibold text-ink">{pagination.totalPages}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Previous page"
                disabled={pagination.currentPage === 1}
                onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
                className="sl-icon-btn sl-icon-btn-md"
              >
                <ChevronLeft size={17} aria-hidden="true" />
              </button>
              <div className="hidden items-center gap-1 sm:flex">
                {pageWindow(pagination.currentPage, pagination.totalPages).map((p, i) =>
                  p === "gap" ? (
                    <span key={`gap-${i}`} className="px-1 text-ink-subtle" aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => pagination.onPageChange(p)}
                      aria-label={`Page ${p}`}
                      aria-current={p === pagination.currentPage ? "page" : undefined}
                      className={`h-10 min-w-10 rounded-full px-3 text-[13px] font-semibold tabular-nums transition-colors ${
                        p === pagination.currentPage
                          ? "bg-nav-active text-[color:var(--color-nav-active-fg)]"
                          : "text-ink-muted hover:bg-nav-hover hover:text-ink"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              </div>
              <button
                type="button"
                aria-label="Next page"
                disabled={pagination.currentPage === pagination.totalPages}
                onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
                className="sl-icon-btn sl-icon-btn-md"
              >
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

export default DataTable;
