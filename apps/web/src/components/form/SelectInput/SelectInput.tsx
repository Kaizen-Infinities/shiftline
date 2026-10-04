import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import {
  FieldError,
  RequiredMark,
  fieldControlClasses,
  fieldLabelClass,
  optionClasses,
} from "../fieldStyles";

interface Option {
  label: string | React.ReactNode;
  value: string | number;
  disabled?: boolean;
  selectedLabel?: string | React.ReactNode;
  badge?: React.ReactNode;
}

interface SelectInputProps {
  label?: string;
  name?: string;
  value: string | number;
  options: Option[];
  required?: boolean;
  hideLabel?: boolean;
  defaultOptionLabel?: string;
  error?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  noMargin?: boolean;
  searchable?: boolean;
  /** Place label and input side by side in one row */
  horizontal?: boolean;
  /** Accessible name when the visible label is hidden; falls back to `label`, then the default option text. */
  ariaLabel?: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

/** Searchable single select: `.sl-input` trigger, popover list, keyboard navigation. */
const SelectInput: React.FC<SelectInputProps> = ({
  label,
  name,
  value,
  options,
  required = false,
  hideLabel = false,
  defaultOptionLabel,
  error,
  icon,
  disabled,
  noMargin = false,
  searchable = true,
  horizontal = false,
  ariaLabel,
  onChange,
}) => {
  const accessibleName = hideLabel ? ariaLabel || label || defaultOptionLabel || name : undefined;
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<any>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const listId = `${baseId}-list`;
  const errorId = `${baseId}-error`;

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !listRef.current) return;
    const items = listRef.current.children;
    const offset = defaultOptionLabel && !searchTerm ? 1 : 0; // account for default option element
    const el = items[highlightedIndex + offset] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, isOpen]);

  // Calculate dropdown position for portal rendering (auto-flip upwards if near bottom of viewport)
  const updateDropdownPosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownEstHeight = 240;

      let style: React.CSSProperties = {
        position: "fixed",
        left: `${rect.left}px`,
        width: `${Math.max(rect.width, 180)}px`,
        zIndex: 100000,
      };

      if (spaceBelow < dropdownEstHeight && spaceAbove > spaceBelow) {
        // Open UPWARDS
        const maxH = Math.min(240, spaceAbove - 16);
        style = {
          ...style,
          bottom: `${viewportHeight - rect.top + 4}px`,
          maxHeight: `${Math.max(120, maxH)}px`,
        };
      } else {
        // Open DOWNWARDS
        const maxH = Math.min(240, spaceBelow - 16);
        style = {
          ...style,
          top: `${rect.bottom + 4}px`,
          maxHeight: `${Math.max(120, maxH)}px`,
        };
      }

      setDropdownStyle(style);
    }
  }, []);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsideWrapper = wrapperRef.current && !wrapperRef.current.contains(target);
      const isOutsidePortal = portalRef.current && !portalRef.current.contains(target);
      if (isOutsideWrapper && isOutsidePortal) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      setSearchTerm(""); // reset search on close
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);
    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  const handleSelect = (optionValue: string | number, optionDisabled?: boolean) => {
    if (optionDisabled) return;

    // Create a synthetic event matching React.ChangeEvent<HTMLSelectElement>
    const event = {
      target: { name, value: String(optionValue) },
    } as unknown as React.ChangeEvent<HTMLSelectElement>;

    onChange(event);
    setIsOpen(false);
  };

  const selectedOption = options.find((o) => String(o.value) === String(value ?? ""));
  const displayLabel = selectedOption
    ? selectedOption.selectedLabel || selectedOption.label
    : defaultOptionLabel || "Select an option";

  const toPlainText = (v: any): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (React.isValidElement(v)) {
      const props = v.props as any;
      if (props?.children) {
        if (Array.isArray(props.children)) {
          return props.children.map(toPlainText).join(" ");
        }
        return toPlainText(props.children);
      }
    }
    return "";
  };

  const filteredOptions = searchable
    ? options.filter((opt) =>
        toPlainText(opt.selectedLabel || opt.label)
          .toLowerCase()
          .includes(searchTerm.toLowerCase())
      )
    : options;

  // Reset highlighted index when filtered options change
  useEffect(() => {
    if (isOpen) {
      const currentIndex = filteredOptions.findIndex(
        (o) => String(o.value) === String(value ?? "")
      );
      setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [isOpen, searchTerm]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        updateDropdownPosition();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => {
          let next = prev + 1;
          while (next < filteredOptions.length && filteredOptions[next]?.disabled) next++;
          return next < filteredOptions.length ? next : prev;
        });
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => {
          let next = prev - 1;
          while (next >= 0 && filteredOptions[next]?.disabled) next--;
          return next >= 0 ? next : prev;
        });
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          const opt = filteredOptions[highlightedIndex];
          if (!opt.disabled) handleSelect(opt.value, opt.disabled);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  const triggerClass = fieldControlClasses({
    invalid: Boolean(error),
    open: isOpen,
    disabled,
    className: `flex h-11 items-center justify-between pl-4 text-left ${
      selectedOption?.badge && !isOpen ? "pr-24 sm:pr-28" : "pr-10"
    } ${selectedOption ? "text-ink" : "text-ink-subtle"}`,
  });

  return (
    <div
      className={`${noMargin ? "" : "mb-0.5 "}group ${horizontal ? "flex flex-col sm:flex-row sm:items-start sm:gap-3" : "flex flex-col"} w-full min-w-0`}
      ref={wrapperRef}
    >
      {!hideLabel && (
        <label htmlFor={triggerId} className={fieldLabelClass(horizontal)}>
          {icon && <span className="sl-label-icon">{icon}</span>}
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      {/* Wrap trigger + error together so error always sits below the input,
          even when the outer container is a horizontal flex row. */}
      <div className={`flex min-w-0 flex-col ${horizontal ? "flex-1" : ""}`}>
        <div className="relative">
          {/* Hidden native select for form serialization if needed */}
          <select
            name={name}
            value={value}
            className="hidden"
            onChange={() => {}}
            tabIndex={-1}
            aria-hidden="true"
          >
            {defaultOptionLabel && <option value="">{defaultOptionLabel}</option>}
            {options.map((opt, i) => (
              <option key={i} value={opt.value}>
                {toPlainText(opt.label)}
              </option>
            ))}
          </select>

          {searchable ? (
            <input
              id={triggerId}
              aria-label={accessibleName}
              type="text"
              autoComplete="off"
              ref={triggerRef}
              disabled={disabled}
              value={isOpen ? searchTerm : toPlainText(displayLabel)}
              placeholder={toPlainText(displayLabel)}
              aria-expanded={isOpen}
              aria-haspopup="listbox"
              aria-controls={isOpen ? listId : undefined}
              aria-invalid={Boolean(error)}
              aria-required={required || undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (!isOpen) {
                  updateDropdownPosition();
                  setIsOpen(true);
                }
              }}
              onFocus={() => {
                if (!disabled) {
                  updateDropdownPosition();
                  setIsOpen(true);
                }
              }}
              onKeyDown={handleKeyDown}
              className={`${triggerClass} [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_var(--color-card)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-ink)] ${
                selectedOption ? "" : "placeholder:!text-ink-subtle"
              }`}
            />
          ) : (
            <button
              id={triggerId}
              aria-label={accessibleName}
              type="button"
              ref={triggerRef}
              disabled={disabled}
              aria-expanded={isOpen}
              aria-haspopup="listbox"
              aria-controls={isOpen ? listId : undefined}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onClick={() => {
                if (!disabled) {
                  if (!isOpen) updateDropdownPosition();
                  setIsOpen(!isOpen);
                }
              }}
              onKeyDown={handleKeyDown}
              className={triggerClass}
            >
              <span className="truncate">{displayLabel}</span>
            </button>
          )}

          {selectedOption?.badge && !isOpen && (
            <div className="pointer-events-none absolute right-9 top-1/2 z-10 flex -translate-y-1/2 items-center">
              {selectedOption.badge}
            </div>
          )}

          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-subtle">
            <ChevronDown
              size={17}
              aria-hidden="true"
              className={`transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
            />
          </span>

          {/* Custom Dropdown Menu (portal to avoid overflow clipping) */}
          {isOpen &&
            createPortal(
              <div
                data-select-portal="true"
                ref={portalRef}
                className="sl-popover flex max-h-60 flex-col overflow-hidden"
                style={dropdownStyle}
              >
                <div
                  ref={listRef}
                  id={listId}
                  role="listbox"
                  aria-label={label || undefined}
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  {defaultOptionLabel && !searchTerm && (
                    <div
                      role="option"
                      aria-selected={!value}
                      onClick={() => handleSelect("")}
                      className={optionClasses({ className: value ? "text-ink-muted" : "" })}
                    >
                      {defaultOptionLabel}
                    </div>
                  )}
                  {filteredOptions.length === 0 ? (
                    <div className="sl-popover-empty">No results found</div>
                  ) : (
                    filteredOptions.map((option, index) => (
                      <div
                        key={index}
                        role="option"
                        aria-selected={String(value) === String(option.value)}
                        aria-disabled={option.disabled || undefined}
                        onClick={() => handleSelect(option.value, option.disabled)}
                        className={optionClasses({
                          highlighted: !option.disabled && index === highlightedIndex,
                          disabled: option.disabled,
                          className: option.disabled ? "select-none" : "",
                        })}
                      >
                        {option.label}
                      </div>
                    ))
                  )}
                </div>
              </div>,
              document.body
            )}
        </div>

        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </div>
  );
};

export default SelectInput;
