import React, { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  FieldError,
  RequiredMark,
  fieldControlClasses,
  fieldLabelClass,
  optionClasses,
} from "../fieldStyles";

interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label: string;
  name: string;
  options: Option[];
  value: string[];
  onChange: (name: string, values: string[]) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
}

/** Multi-pick field: chosen values show as chips in the box; the list has checkboxes. */
const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  name,
  options,
  value,
  onChange,
  placeholder = "-- Select --",
  error,
  required = false,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const errorId = `${baseId}-error`;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggle = (optionValue: string) => {
    const already = value.includes(optionValue);
    const updated = already ? value.filter((v) => v !== optionValue) : [...value, optionValue];
    onChange(name, updated);
  };

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  return (
    <div className="group relative w-full min-w-0" ref={ref}>
      <label id={labelId} className={fieldLabelClass()}>
        <span>{label}</span>
        {required && <RequiredMark />}
      </label>

      <div
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={fieldControlClasses({
          invalid: Boolean(error),
          open,
          className:
            "flex min-h-11 cursor-pointer items-center justify-between gap-2 py-1.5 pl-3 pr-3",
        })}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <div className="flex flex-1 flex-wrap gap-1.5">
          {selectedLabels.length === 0 ? (
            <span className="px-1 py-1 text-[15px] font-normal text-ink-subtle">{placeholder}</span>
          ) : (
            selectedLabels.map((label, i) => (
              <span key={i} className="sl-chip sl-chip-sm gap-1 pr-1">
                {label}
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-card/70 focus:outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(options.find((o) => o.label === label)!.value);
                  }}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronDown
          size={17}
          aria-hidden="true"
          className={`shrink-0 text-ink-subtle transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelId}
          className="sl-popover absolute z-50 mt-1.5 max-h-60 w-full overflow-y-auto"
        >
          {options.length === 0 ? (
            <div className="sl-popover-empty">No options available</div>
          ) : (
            options.map((option) => {
              const checked = value.includes(option.value);
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={checked}
                  className={optionClasses({ selected: checked })}
                  onClick={() => handleToggle(option.value)}
                >
                  <input
                    type="checkbox"
                    className="sl-check pointer-events-none"
                    checked={checked}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option.label}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
};

export default MultiSelect;
