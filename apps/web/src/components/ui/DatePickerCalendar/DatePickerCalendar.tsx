import { useState, useRef, useEffect, useId } from "react";
import {
  FieldError,
  RequiredMark,
  fieldControlClasses,
  fieldLabelClass,
} from "../../form/fieldStyles";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

/**
 * DatePickerCalendar — React + TypeScript + Tailwind CSS (medium size)
 * Drop-in replacement for a native <input type="date">.
 * Header has clickable month/year dropdowns for fast navigation.
 */

export interface DatePickerCalendarProps {
  name?: string;
  value?: Date | string | null;
  onChange?: (e: { target: { name: string; value: string } }) => void;
  minDate?: Date | string | null;
  maxDate?: Date | string | null;
  placeholder?: string;
  label?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  /** Place label and input side by side in one row */
  horizontal?: boolean;
  /** Accessible name when no visible `label` is rendered. */
  ariaLabel?: string;
}

interface DayCell {
  date: Date;
  inMonth: boolean;
}

const WEEKDAYS: string[] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS: string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isSameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isDisabled(date: Date, minDate?: Date | null, maxDate?: Date | null): boolean {
  if (minDate && date < stripTime(minDate)) return true;
  if (maxDate && date > stripTime(maxDate)) return true;
  return false;
}

function buildMonthGrid(year: number, month: number): DayCell[] {
  const firstOfMonth = new Date(year, month, 1);
  // Weeks run Monday to Sunday everywhere in the product.
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: DayCell[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }
  return cells;
}

export function formatLocalDate(date: Date | null | undefined): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return new Date(year, month, day);
}

// Generate a range of years: 100 years back to 10 years forward
function buildYearOptions(today: Date): number[] {
  const currentYear = today.getFullYear();
  const years: number[] = [];
  for (let y = currentYear - 100; y <= currentYear + 10; y++) {
    years.push(y);
  }
  return years;
}

export default function DatePickerCalendar({
  name = "",
  value = null,
  onChange,
  minDate = null,
  maxDate = null,
  placeholder = "Select a date",
  label,
  required = false,
  error,
  disabled = false,
  horizontal = false,
  ariaLabel,
}: DatePickerCalendarProps) {
  const [open, setOpen] = useState<boolean>(false);

  const parsedValue = typeof value === "string" ? parseLocalDate(value) : value;
  const parsedMinDate = typeof minDate === "string" ? parseLocalDate(minDate) : minDate;
  const parsedMaxDate = typeof maxDate === "string" ? parseLocalDate(maxDate) : maxDate;

  const [internalValue, setInternalValue] = useState<Date | null>(parsedValue);
  const today = stripTime(new Date());

  const [viewYear, setViewYear] = useState<number>((parsedValue || today).getFullYear());
  const [viewMonth, setViewMonth] = useState<number>((parsedValue || today).getMonth());

  const containerRef = useRef<HTMLDivElement>(null);
  const yearSelectRef = useRef<HTMLSelectElement>(null);
  const baseId = useId();
  const triggerId = `${baseId}-date`;
  const errorId = `${baseId}-error`;

  const yearOptions = buildYearOptions(today);

  // Sync state if value changes externally
  useEffect(() => {
    setInternalValue(parsedValue);
    if (parsedValue) {
      setViewYear(parsedValue.getFullYear());
      setViewMonth(parsedValue.getMonth());
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = parsedValue || internalValue;

  const goPrevMonth = (): void => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  };

  const goNextMonth = (): void => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  };

  const handleSelect = (date: Date): void => {
    if (isDisabled(date, parsedMinDate, parsedMaxDate)) return;
    const formatted = formatLocalDate(date);
    setInternalValue(date);
    if (onChange) {
      onChange({
        target: {
          name: name,
          value: formatted,
        },
      } as any);
    }
    setOpen(false);
  };

  const goToday = (): void => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    handleSelect(today);
  };

  const cells = buildMonthGrid(viewYear, viewMonth);

  return (
    <div
      ref={containerRef}
      className={`relative w-full min-w-0 group ${horizontal ? "flex flex-col sm:flex-row sm:items-center sm:gap-3" : ""}`}
    >
      {label && (
        <label
          htmlFor={triggerId}
          className={fieldLabelClass(horizontal, horizontal ? "sm:pt-0" : "")}
        >
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <div className={`relative ${horizontal ? "flex-1" : ""}`}>
        {/* Input trigger */}
        <button
          id={triggerId}
          aria-label={label ? undefined : ariaLabel}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={Boolean(error)}
          aria-required={required || undefined}
          aria-describedby={error ? errorId : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          className={fieldControlClasses({
            invalid: Boolean(error),
            open,
            disabled,
            className: "flex h-11 items-center justify-between px-4 text-left",
          })}
        >
          <span className={selected ? "text-ink tabular-nums" : "font-normal text-ink-subtle"}>
            {selected ? formatLocalDate(selected) : placeholder}
          </span>
          <CalendarIcon size={17} aria-hidden="true" className="shrink-0 text-ink-subtle" />
        </button>

        {/* Popover */}
        {open && !disabled && (
          <div
            role="dialog"
            aria-label={label ? `Choose ${label}` : "Choose a date"}
            className="sl-popover absolute left-0 top-full z-50 mt-1.5 w-[272px] !p-3"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            {/* Header: prev arrow | month select | year select | next arrow */}
            <div className="mb-2 flex items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={goPrevMonth}
                aria-label="Previous month"
                className="sl-icon-btn sl-icon-btn-ghost"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>

              {/* Month dropdown */}
              <select
                value={viewMonth}
                aria-label="Month"
                onChange={(e) => setViewMonth(Number(e.target.value))}
                className="h-8 min-w-0 flex-1 cursor-pointer rounded-full border border-line bg-card px-2 text-[13px] font-semibold text-ink focus:border-[color:var(--color-primary)] focus:outline-none"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i} className="bg-card text-ink">
                    {m}
                  </option>
                ))}
              </select>

              {/* Year dropdown */}
              <select
                ref={yearSelectRef}
                value={viewYear}
                aria-label="Year"
                onChange={(e) => setViewYear(Number(e.target.value))}
                className="h-8 w-[74px] flex-shrink-0 cursor-pointer rounded-full border border-line bg-card px-2 text-[13px] font-semibold text-ink focus:border-[color:var(--color-primary)] focus:outline-none"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y} className="bg-card text-ink">
                    {y}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={goNextMonth}
                aria-label="Next month"
                className="sl-icon-btn sl-icon-btn-ghost"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Weekday labels */}
            <div className="mb-1 grid grid-cols-7">
              {WEEKDAYS.map((w) => (
                <div key={w} className="pb-1 text-center text-[11px] font-semibold text-ink-subtle">
                  {w}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map(({ date, inMonth }, i) => {
                const disabledCell = isDisabled(date, parsedMinDate, parsedMaxDate);
                const isSelected = isSameDay(date, selected);
                const isToday = isSameDay(date, today);

                return (
                  <button
                    key={i}
                    type="button"
                    disabled={disabledCell}
                    aria-label={date.toDateString()}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => handleSelect(date)}
                    className={`aspect-square rounded-full text-[13px] tabular-nums transition-colors
                      ${disabledCell ? "cursor-not-allowed text-ink-subtle opacity-40" : "cursor-pointer"}
                      ${
                        isSelected
                          ? "bg-accent font-bold text-white"
                          : !disabledCell && inMonth
                            ? "font-medium text-ink hover:bg-nav-hover"
                            : !disabledCell
                              ? "text-ink-subtle hover:bg-nav-hover"
                              : ""
                      }
                      ${isToday && !isSelected ? "bg-chip font-bold text-[color:var(--color-chip-fg)]" : ""}
                    `}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-2 flex justify-between border-t border-line-soft pt-2">
              <button type="button" onClick={goToday} className="sl-chip sl-chip-sm">
                Today
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="sl-btn-ghost !px-3 !py-1 text-[13px]"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/* ---------------- Demo wrapper ---------------- */
export function Demo() {
  const [date, setDate] = useState<Date | null>(null);
  return (
    <div className="flex min-h-[480px] items-start justify-center bg-page pt-16">
      <div>
        <DatePickerCalendar
          label="Invoice date"
          value={date}
          onChange={(e) => setDate(e.target.value ? new Date(e.target.value) : null)}
        />
      </div>
    </div>
  );
}
