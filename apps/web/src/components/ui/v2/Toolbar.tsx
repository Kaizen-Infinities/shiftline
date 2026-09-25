import React from "react";
import { Search, X } from "lucide-react";
import { cx } from "./cx";
import { Chip } from "./Chip";

export interface SearchFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value" | "size"
> {
  value: string;
  /** Receives the new text (not the event). */
  onValueChange: (value: string) => void;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  /** Shows a clear button while there is text. */
  clearable?: boolean;
  className?: string;
  inputClassName?: string;
}

/** Search `.sl-input` with a leading icon and a clear button. */
export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onValueChange,
  label,
  placeholder = "Search…",
  clearable = true,
  className,
  inputClassName,
  ...rest
}) => (
  <div className={cx("relative w-full sm:w-72", className)}>
    <Search
      size={17}
      aria-hidden="true"
      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
    />
    <input
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      className={cx(
        "sl-input h-11 pl-10 [&::-webkit-search-cancel-button]:appearance-none",
        clearable && value ? "pr-10" : "pr-4",
        inputClassName
      )}
      {...rest}
    />
    {clearable && value && (
      <button
        type="button"
        onClick={() => onValueChange("")}
        aria-label="Clear search"
        className="sl-icon-btn sl-icon-btn-ghost absolute right-1.5 top-1/2 !h-8 !w-8 -translate-y-1/2"
      >
        <X size={15} aria-hidden="true" />
      </button>
    )}
  </div>
);

export interface ToolbarFilter<K extends string = string> {
  key: K;
  label: React.ReactNode;
  count?: React.ReactNode;
}

export interface ToolbarProps<K extends string = string> {
  /** Search text (controlled). Omit `onSearchChange` to hide the search field. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Single-select filter chips. */
  filters?: ToolbarFilter<K>[];
  filterValue?: K;
  onFilterChange?: (key: K) => void;
  /** Accessible name for the chip group. */
  filtersLabel?: string;
  /** Right side: column toggles, export, filter popovers. */
  right?: React.ReactNode;
  /** Extra left-side content after the chips. */
  children?: React.ReactNode;
  className?: string;
}

/** List-screen toolbar: search input, a row of filter chips, and a right-hand slot. */
export function Toolbar<K extends string = string>({
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search…",
  searchLabel,
  filters,
  filterValue,
  onFilterChange,
  filtersLabel = "Filters",
  right,
  children,
  className,
}: ToolbarProps<K>) {
  return (
    <div
      className={cx(
        "mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {onSearchChange && (
          <SearchField
            value={searchValue}
            onValueChange={onSearchChange}
            placeholder={searchPlaceholder}
            label={searchLabel}
          />
        )}
        {filters && filters.length > 0 && (
          <div
            role="group"
            aria-label={filtersLabel}
            className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
          >
            {filters.map((filter) => (
              <Chip
                key={filter.key}
                size="lg"
                count={filter.count}
                selected={filter.key === filterValue}
                onClick={() => onFilterChange?.(filter.key)}
                className="shrink-0"
              >
                {filter.label}
              </Chip>
            ))}
          </div>
        )}
        {children}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{right}</div>}
    </div>
  );
}

export default Toolbar;
