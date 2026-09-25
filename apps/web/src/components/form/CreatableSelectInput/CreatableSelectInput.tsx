import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Edit2, Trash2, Check, X, Plus } from "lucide-react";
import {
  FieldError,
  RequiredMark,
  fieldControlClasses,
  fieldLabelClass,
  optionClasses,
} from "../fieldStyles";

interface CreatableSelectInputProps {
  label: string;
  name: string;
  value: number | string | null;
  options: { label: string; value: number | string }[];
  onChange: (value: number | string | null) => void;
  onCreateOption?: (inputValue: string) => void;
  onEditOption?: (value: number | string, newLabel: string) => void;
  onDeleteOption?: (value: number | string) => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  isLoading?: boolean;
}

// ─── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({
  item,
  onSave,
  onClose,
}: {
  item: { value: number | string; label: string };
  onSave: (value: number | string, newLabel: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(item.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    if (text.trim()) {
      onSave(item.value, text.trim());
      onClose();
    }
  };

  return (
    <div className="sl-backdrop z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit item"
        className="sl-dialog w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h5 className="sl-dialog-title mb-4">Edit item</h5>
        <input
          ref={inputRef}
          aria-label="Item name"
          className="sl-input mb-5 h-11 px-4"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="sl-btn sl-pill-md">
            <X size={15} aria-hidden="true" /> Cancel
          </button>
          <button type="button" onClick={handleSave} className="sl-cta sl-pill-md">
            <Check size={15} aria-hidden="true" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
/** Select that can also create, rename and delete options inline. */
export default function CreatableSelectInput({
  label,
  name,
  value,
  options,
  onChange,
  onCreateOption,
  onEditOption,
  onDeleteOption,
  error,
  disabled,
  required,
  isLoading,
}: CreatableSelectInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [createInputValue, setCreateInputValue] = useState("");
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [editItem, setEditItem] = useState<{ value: number | string; label: string } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const errorId = `${baseId}-error`;

  const selectedOption = options.find((opt) => opt.value == value) || null;

  // While open: filter by typed text. While closed: show selected label.
  const filteredOptions = isOpen
    ? options.filter((opt) => opt.label.toString().toLowerCase().includes(inputText.toLowerCase()))
    : options;

  const updateDropdownPosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownEstHeight = 280;

      let style: React.CSSProperties = {
        position: "fixed",
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: 100000,
      };

      if (spaceBelow < dropdownEstHeight && spaceAbove > spaceBelow) {
        const maxH = Math.min(280, spaceAbove - 16);
        style = {
          ...style,
          bottom: `${viewportHeight - rect.top + 4}px`,
          maxHeight: `${Math.max(120, maxH)}px`,
        };
      } else {
        const maxH = Math.min(280, spaceBelow - 16);
        style = { ...style, top: `${rect.bottom + 4}px`, maxHeight: `${Math.max(120, maxH)}px` };
      }
      setDropdownStyle(style);
    }
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsideWrapper = wrapperRef.current && !wrapperRef.current.contains(target);
      const isOutsidePortal = portalRef.current && !portalRef.current.contains(target);
      if (isOutsideWrapper && isOutsidePortal) {
        closeDropdown();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Reposition on scroll/resize
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

  // Focus create input when shown
  useEffect(() => {
    if (showCreateInput) createInputRef.current?.focus();
  }, [showCreateInput]);

  const openDropdown = () => {
    if (disabled || isLoading) return;
    setInputText("");
    setShowCreateInput(false);
    setCreateInputValue("");
    const currentIdx = options.findIndex((o) => o.value == value);
    setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
    updateDropdownPosition();
    setIsOpen(true);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setInputText("");
    setShowCreateInput(false);
    setCreateInputValue("");
  };

  const handleSelect = (optValue: number | string) => {
    onChange(optValue);
    closeDropdown();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setInputText("");
    inputRef.current?.focus();
  };

  const handleCreate = () => {
    if (createInputValue.trim() && onCreateOption) {
      onCreateOption(createInputValue.trim());
      setCreateInputValue("");
      setShowCreateInput(false);
      closeDropdown();
    }
  };

  // Display value in the input box
  const inputDisplayValue = isOpen ? inputText : (selectedOption?.label.toString() ?? "");

  return (
    <div className="group mb-0.5 flex w-full min-w-0 flex-col" ref={wrapperRef}>
      {/* Label */}
      {label && (
        <label htmlFor={inputId} className={fieldLabelClass()}>
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <div className="relative">
        {/* Input box (acts as both trigger and search) */}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          name={name}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-invalid={Boolean(error)}
          aria-required={required || undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          disabled={disabled || isLoading}
          placeholder={isLoading ? "Loading..." : "Select or create..."}
          value={inputDisplayValue}
          onFocus={openDropdown}
          onClick={() => {
            if (!isOpen) openDropdown();
          }}
          onChange={(e) => {
            if (!isOpen) openDropdown();
            setInputText(e.target.value);
            setHighlightedIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              closeDropdown();
              return;
            }
            if (e.key === "Tab") {
              closeDropdown();
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!isOpen) {
                openDropdown();
                return;
              }
              setHighlightedIndex((prev) => (prev + 1 < filteredOptions.length ? prev + 1 : prev));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (!isOpen) {
                openDropdown();
                return;
              }
              setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                handleSelect(filteredOptions[highlightedIndex].value);
                return;
              }
              if (onCreateOption) {
                const trimmed = inputText.trim();
                const exactMatch = options.find(
                  (opt) => opt.label.toString().toLowerCase() === trimmed.toLowerCase()
                );
                if (trimmed && !exactMatch) {
                  onCreateOption(trimmed);
                  closeDropdown();
                } else if (exactMatch) {
                  handleSelect(exactMatch.value);
                }
              }
            }
          }}
          className={fieldControlClasses({
            invalid: Boolean(error),
            open: isOpen,
            disabled: disabled || isLoading,
            className: "h-11 pl-4 pr-14",
          })}
        />

        {/* Right icons */}
        <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-ink-subtle">
          {selectedOption && !disabled && (
            <span
              role="button"
              aria-label="Clear selection"
              className="pointer-events-auto cursor-pointer rounded-full p-1 text-ink-subtle transition-colors hover:bg-nav-hover hover:text-[color:var(--color-danger)]"
              title="Clear"
              onMouseDown={(e) => {
                e.preventDefault();
                handleClear(e);
              }}
            >
              <X size={13} aria-hidden="true" />
            </span>
          )}
          <ChevronDown
            size={17}
            aria-hidden="true"
            className={`transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
          />
        </span>

        {/* Dropdown Portal */}
        {isOpen &&
          createPortal(
            <div
              ref={portalRef}
              className="sl-popover flex flex-col overflow-hidden"
              style={dropdownStyle}
            >
              {/* Options list */}
              <div
                role="listbox"
                aria-label={label || undefined}
                className="min-h-0 flex-1 overflow-y-auto"
              >
                {/* Create hint when no results */}
                {filteredOptions.length === 0 && onCreateOption && inputText.trim() && (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-accent">
                    <Plus size={14} aria-hidden="true" />
                    <span>
                      Press <kbd className="sl-kbd">Enter</kbd> to create &ldquo;{inputText.trim()}
                      &rdquo;
                    </span>
                  </div>
                )}
                {filteredOptions.length === 0 && !onCreateOption && (
                  <div className="sl-popover-empty">No results found</div>
                )}
                {filteredOptions.map((option, index) => (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={value == option.value}
                    className={optionClasses({
                      highlighted: index === highlightedIndex,
                      selected: value == option.value,
                      className: "group/item justify-between",
                    })}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(option.value);
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                    <span className="flex items-center gap-0.5 ml-2 shrink-0">
                      {onEditOption && (
                        <button
                          type="button"
                          title="Edit"
                          aria-label={`Edit ${option.label}`}
                          className="rounded-full p-1 text-ink-subtle opacity-0 transition-all hover:bg-card hover:text-accent focus-visible:opacity-100 group-hover/item:opacity-100"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditItem({ value: option.value, label: option.label.toString() });
                            closeDropdown();
                          }}
                        >
                          <Edit2 size={13} />
                        </button>
                      )}
                      {onDeleteOption && (
                        <button
                          type="button"
                          title="Delete"
                          aria-label={`Delete ${option.label}`}
                          className="rounded-full p-1 text-ink-subtle opacity-0 transition-all hover:bg-card hover:text-[color:var(--color-danger)] focus-visible:opacity-100 group-hover/item:opacity-100"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDeleteOption(option.value);
                            closeDropdown();
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>,
            document.body
          )}
      </div>

      {/* Error */}
      {error && <FieldError id={errorId}>{error}</FieldError>}

      {/* Edit Modal */}
      {editItem && onEditOption && (
        <EditModal item={editItem} onSave={onEditOption} onClose={() => setEditItem(null)} />
      )}
    </div>
  );
}
