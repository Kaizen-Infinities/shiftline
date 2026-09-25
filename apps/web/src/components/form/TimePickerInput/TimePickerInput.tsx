import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import ReactDOM from "react-dom";
import { Clock } from "lucide-react";
import { FieldError, RequiredMark, fieldControlClasses, fieldLabelClass } from "../fieldStyles";

interface TimePickerInputProps {
  label?: string;
  name: string;
  value: string; // Expected in "HH:mm" format (24-hour)
  required?: boolean;
  error?: string;
  disabled?: boolean;
  /** Place label and input side by side in one row */
  horizontal?: boolean;
  onChange: (value: string) => void;
}

/** 12-hour time field: `.sl-input` trigger and a popover with hour, minute and AM/PM columns. */
const TimePickerInput: React.FC<TimePickerInputProps> = ({
  label,
  name: _name,
  value,
  required = false,
  error,
  disabled = false,
  horizontal = false,
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const errorId = `${baseId}-error`;

  // Parse 24h (HH:mm) into 12h components
  const parseTime = (timeStr: string) => {
    if (!timeStr) return { hour: "", minute: "", period: "AM" };
    const [hStr, mStr] = timeStr.split(":");
    const h24 = parseInt(hStr, 10);
    const minute = mStr || "00";

    let hour = h24;
    let period = "AM";

    if (h24 === 0) {
      hour = 12;
      period = "AM";
    } else if (h24 === 12) {
      hour = 12;
      period = "PM";
    } else if (h24 > 12) {
      hour = h24 - 12;
      period = "PM";
    } else {
      hour = h24;
      period = "AM";
    }

    return {
      hour: String(hour).padStart(2, "0"),
      minute: minute.padStart(2, "0"),
      period,
    };
  };

  const { hour, minute, period } = parseTime(value);

  // Format 12h components into 24h (HH:mm)
  const formatTime = (h12: string, min: string, pmAm: string) => {
    if (!h12 || !min) return "";
    let h24 = parseInt(h12, 10);
    if (pmAm === "PM") {
      if (h24 !== 12) h24 += 12;
    } else {
      if (h24 === 12) h24 = 0;
    }
    const hStr = String(h24).padStart(2, "0");
    const mStr = String(min).padStart(2, "0");
    return `${hStr}:${mStr}`;
  };

  // Calculate fixed position for portal dropdown
  const checkPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 290;
    const dropdownWidth = 320;
    const spaceBelow = window.innerHeight - rect.bottom;

    const left = Math.min(rect.left, window.innerWidth - dropdownWidth - 8);

    if (spaceBelow < dropdownHeight) {
      // Open upward
      setDropdownStyle({
        position: "fixed",
        bottom: window.innerHeight - rect.top + 4,
        left,
        width: dropdownWidth,
        zIndex: 99999,
      });
    } else {
      // Open downward
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left,
        width: dropdownWidth,
        zIndex: 99999,
      });
    }
  }, []);

  // Close dropdown on click outside; reposition on scroll/resize
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideContainer = containerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideContainer && !insideDropdown) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", checkPosition, true);
    window.addEventListener("resize", checkPosition);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", checkPosition, true);
      window.removeEventListener("resize", checkPosition);
    };
  }, [checkPosition]);

  const handleSelectHour = (h: string) => {
    const newTime = formatTime(h, minute || "00", period);
    onChange(newTime);
  };

  const handleSelectMinute = (m: string) => {
    const newTime = formatTime(hour || "12", m, period);
    onChange(newTime);
  };

  const handleTogglePeriod = (p: string) => {
    const newTime = formatTime(hour || "12", minute || "00", p);
    onChange(newTime);
  };

  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")); // Full 00-59 minutes for exact selection

  const displayValue = value ? `${hour}:${minute} ${period}` : "";

  const column = (
    title: string,
    items: string[],
    selected: string,
    onPick: (v: string) => void,
    scroll = true
  ) => (
    <div className="flex-1">
      <div className="px-2 pb-1.5 pt-1 text-center text-[12px] font-semibold text-ink-subtle">
        {title}
      </div>
      <div
        role="listbox"
        aria-label={title}
        className={`flex flex-col gap-0.5 px-1 ${scroll ? "h-[200px] overflow-y-auto overflow-x-hidden" : ""}`}
        style={{ scrollbarWidth: "thin" }}
      >
        {items.map((item) => (
          <button
            key={item}
            type="button"
            role="option"
            aria-selected={selected === item}
            className={`rounded-[10px] py-2 text-center text-sm tabular-nums transition-colors ${
              selected === item ? "bg-accent font-bold text-white" : "text-ink hover:bg-nav-hover"
            }`}
            onClick={() => onPick(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className={`group min-w-0 ${horizontal ? "flex flex-col sm:flex-row sm:items-center sm:gap-3" : ""}`}
      ref={containerRef}
    >
      {label && (
        <label id={labelId} className={fieldLabelClass(horizontal, horizontal ? "sm:pt-0" : "")}>
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <div className={`relative ${horizontal ? "flex-1" : ""}`}>
        <div
          ref={triggerRef}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-labelledby={label ? labelId : undefined}
          aria-disabled={disabled || undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={fieldControlClasses({
            invalid: Boolean(error),
            open: isOpen,
            disabled,
            className: `flex h-11 items-center justify-between px-4 ${disabled ? "" : "cursor-pointer"}`,
          })}
          onClick={() => {
            if (!disabled) {
              checkPosition();
              setIsOpen(!isOpen);
            }
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              checkPosition();
              setIsOpen((o) => !o);
            } else if (e.key === "Escape") {
              setIsOpen(false);
            }
          }}
        >
          <span
            className={`truncate tabular-nums ${!displayValue ? "font-normal text-ink-subtle" : ""}`}
          >
            {displayValue || "hh:mm AM/PM"}
          </span>
          <Clock size={17} className="shrink-0 text-ink-subtle" aria-hidden="true" />
        </div>

        {isOpen &&
          !disabled &&
          ReactDOM.createPortal(
            <div
              ref={dropdownRef}
              role="dialog"
              aria-label={label ? `Pick ${label}` : "Pick a time"}
              className="sl-popover !p-0"
              style={dropdownStyle}
            >
              <div className="flex gap-1 px-2 pt-2">
                {column("Hour", hours, hour, handleSelectHour)}
                {column("Min", minutes, minute, handleSelectMinute)}
                {column("AM/PM", ["AM", "PM"], period, handleTogglePeriod, false)}
              </div>

              <div className="mt-2 flex justify-end border-t border-line-soft px-3 py-2.5">
                <button
                  type="button"
                  className="sl-btn sl-pill-sm"
                  onClick={() => setIsOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>,
            document.body
          )}
      </div>

      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
};

export default TimePickerInput;
