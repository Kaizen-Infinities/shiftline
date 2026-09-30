import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  FieldError,
  RequiredMark,
  fieldControlClasses,
  fieldLabelClass,
  optionClasses,
} from "../fieldStyles";

export interface AutocompleteOption {
  value: string;
  label: string;
  /** Extra info shown on the right side of the dropdown row */
  info?: React.ReactNode;
  /** Text shown in input when selected (defaults to label) */
  selectedLabel?: string;
  disabled?: boolean;
}

interface AutocompleteInputProps {
  label?: string;
  name: string;
  value: string;
  options: AutocompleteOption[];
  placeholder?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  horizontal?: boolean;
  /** Compact inline mode for use inside table cells — no label, no border, minimal padding */
  inline?: boolean;
  /** Accessible name when no visible `label` is rendered (inline table cells). */
  ariaLabel?: string;
  onChange: (value: string) => void;
}

/** Type-to-filter picker; `inline` mode is a borderless cell editor for item tables. */
const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
  label,
  name,
  value,
  options,
  placeholder = "",
  required = false,
  error,
  disabled = false,
  horizontal = false,
  inline = false,
  ariaLabel,
  onChange,
}) => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);
  const displayText = selectedOption?.selectedLabel || selectedOption?.label || "";

  // When not focused, show selected text; when focused, show search
  const [isFocused, setIsFocused] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return options.filter((o) => !o.disabled);
    const term = search.toLowerCase();
    return options.filter(
      (o) =>
        !o.disabled &&
        (o.label.toLowerCase().includes(term) ||
          (o.selectedLabel || "").toLowerCase().includes(term))
    );
  }, [options, search]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [filtered.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current || highlightIdx < 0) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  // Position dropdown
  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    const maxH = 260;

    const base: React.CSSProperties = {
      position: "fixed",
      left: rect.left,
      width: inline ? Math.max(rect.width, 280) : rect.width,
      zIndex: 100000,
    };

    if (spaceBelow < maxH && spaceAbove > spaceBelow) {
      setDropdownStyle({
        ...base,
        bottom: viewportH - rect.top + 4,
        maxHeight: Math.min(maxH, spaceAbove - 16),
      });
    } else {
      setDropdownStyle({
        ...base,
        top: rect.bottom + 4,
        maxHeight: Math.min(maxH, spaceBelow - 16),
      });
    }
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setOpen(false);
        setIsFocused(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  const select = (val: string) => {
    onChange(val);
    setOpen(false);
    setIsFocused(false);
    setSearch("");
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (inline) {
        // Inline mode: only Enter/F2 opens dropdown, arrows move between table cells
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          e.stopPropagation();
          updatePosition();
          setOpen(true);
        }
      } else {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          updatePosition();
          setOpen(true);
        }
      }
      return;
    }
    // Dropdown is open — prevent events from reaching the table
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIdx]) select(filtered[highlightIdx].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setSearch("");
    }
  };

  return (
    <div
      className={`group ${inline ? "relative w-full" : horizontal ? "flex flex-col sm:flex-row sm:items-start sm:gap-3" : "min-w-0"}`}
      ref={wrapperRef}
      {...(inline
        ? { "data-autocomplete": true, ...(open ? { "data-dropdown-open": true } : {}) }
        : {})}
    >
      {!inline && label && (
        <label htmlFor={name} className={fieldLabelClass(horizontal)}>
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <div className={`flex flex-col ${inline ? "" : horizontal ? "flex-1" : ""}`}>
        <div className="relative">
          {/* Inline: show rich display when not focused and has value */}
          {inline && !isFocused && value && selectedOption ? (
            <div
              tabIndex={0}
              className="w-full text-[13px] truncate cursor-text h-full flex items-center justify-between gap-2 outline-none text-ink"
              onClick={() => {
                setIsFocused(true);
                setSearch("");
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              onFocus={() => {
                setIsFocused(true);
                setSearch("");
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "F2") {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsFocused(true);
                  setSearch("");
                  updatePosition();
                  setOpen(true);
                  setTimeout(() => inputRef.current?.focus(), 0);
                }
              }}
            >
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.info && <div className="shrink-0">{selectedOption.info}</div>}
            </div>
          ) : (
            <input
              ref={inputRef}
              id={name}
              aria-label={inline || !label ? ariaLabel || label || undefined : undefined}
              type="text"
              autoComplete="off"
              disabled={disabled}
              value={isFocused ? search : displayText}
              placeholder={isFocused ? displayText || placeholder : placeholder}
              onFocus={() => {
                if (disabled) return;
                setIsFocused(true);
                setSearch("");
                if (inline) {
                  if (!value) {
                    updatePosition();
                    setOpen(true);
                  }
                } else {
                  updatePosition();
                  setOpen(true);
                }
              }}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!open) {
                  updatePosition();
                  setOpen(true);
                }
              }}
              onKeyDown={handleKeyDown}
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-invalid={Boolean(error)}
              aria-required={required || undefined}
              aria-describedby={error && !inline ? `${name}-error` : undefined}
              className={
                inline
                  ? "w-full bg-transparent text-[13px] text-ink outline-none border-none p-0 h-full placeholder:text-ink-subtle/80 placeholder:font-normal"
                  : fieldControlClasses({
                      invalid: Boolean(error),
                      open,
                      className:
                        "h-11 px-4 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_var(--color-card)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-ink)]",
                    })
              }
            />
          )}
        </div>

        {error &&
          (inline ? (
            <div className="absolute -bottom-3 left-0 text-[10px] leading-none text-[color:var(--color-danger)]">
              {error}
            </div>
          ) : (
            <FieldError id={`${name}-error`}>{error}</FieldError>
          ))}
      </div>

      {/* Dropdown */}
      {open &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            className="sl-popover flex flex-col overflow-y-auto"
            style={dropdownStyle}
          >
            {filtered.length === 0 ? (
              <div className="sl-popover-empty">{search ? "No match found" : "No options"}</div>
            ) : (
              filtered.map((opt, idx) => (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={value === opt.value}
                  className={optionClasses({
                    highlighted: idx === highlightIdx,
                    selected: value === opt.value,
                    className: "shrink-0 justify-between",
                  })}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(opt.value);
                  }}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.info && <div className="shrink-0">{opt.info}</div>}
                </div>
              ))
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

export default AutocompleteInput;
