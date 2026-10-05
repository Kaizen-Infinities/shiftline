import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { X } from "lucide-react";
import { RequiredMark, fieldLabelClass } from "../fieldStyles";
import { createPortal } from "react-dom";
import type { AccountLedger } from "../../../services/accountService";

interface LedgerSearchInputProps {
  label?: string;
  value: string; // ledger ID as string
  ledgers: AccountLedger[];
  onChange: (ledgerId: string) => void;
  placeholder?: string;
  required?: boolean;
  filterType?: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY";
  /** Custom predicate to restrict selectable ledgers (e.g. bank/cash only). */
  filterFn?: (ledger: AccountLedger) => boolean;
  accentColor?: string; // tailwind ring color class e.g. "red-500"
  /** "default" = bordered rounded input; "cell" = borderless flush input for spreadsheet-like tables */
  variant?: "default" | "cell";
  /** Called after a ledger is selected (via keyboard or click). Use to auto-advance focus. */
  onSelected?: (ledger: AccountLedger) => void;
  disabled?: boolean;
  /** Accessible name when no visible `label` is rendered (e.g. voucher grid cells). */
  ariaLabel?: string;
}

/** True if a ledger's group looks like a bank or cash account. */
export function isBankOrCashLedger(l: AccountLedger): boolean {
  const g = (l.group || "").toLowerCase();
  return g.includes("cash") || g.includes("bank");
}

/** Account (ledger) picker grouped by account group; `cell` variant fits voucher grids. */
const LedgerSearchInput: React.FC<LedgerSearchInputProps> = ({
  label,
  value,
  ledgers,
  onChange,
  placeholder = "Search account...",
  required,
  filterType,
  filterFn,
  accentColor = "primary",
  variant = "default",
  onSelected,
  disabled,
  ariaLabel,
}) => {
  const [searchText, setSearchText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const baseId = useId();
  const inputId = `${baseId}-ledger`;
  const listId = `${baseId}-list`;

  // Find selected ledger name for display
  const selectedLedger = ledgers.find((l) => String(l.id) === value);

  // Filter ledgers by search text, optional type, and optional custom predicate
  const filtered = ledgers.filter((l) => {
    if (filterType && l.type !== filterType) return false;
    if (filterFn && !filterFn(l)) return false;
    if (!searchText) return true;
    const term = searchText.toLowerCase();
    return (
      l.name.toLowerCase().includes(term) ||
      l.code.toLowerCase().includes(term) ||
      l.group.toLowerCase().includes(term) ||
      (l.customer?.firmName || "").toLowerCase().includes(term) ||
      (l.customer?.displayName || "").toLowerCase().includes(term) ||
      (l.customer?.customerCode || "").toLowerCase().includes(term) ||
      (l.supplier?.displayName || "").toLowerCase().includes(term) ||
      (l.supplier?.supplierCode || "").toLowerCase().includes(term) ||
      (l.supplier?.legalName || "").toLowerCase().includes(term)
    );
  });

  // Group by group name for organized display
  const grouped: Record<string, AccountLedger[]> = {};
  for (const l of filtered) {
    const grp = l.group || "Other";
    if (!grouped[grp]) grouped[grp] = [];
    grouped[grp].push(l);
  }
  const groupNames = Object.keys(grouped).sort();
  const flatFiltered = groupNames.flatMap((g) => grouped[g]);

  const updatePosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 2,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        // Restore display text
        if (selectedLedger) {
          setSearchText("");
        }
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectedLedger]);

  const handleSelect = (ledger: AccountLedger) => {
    onChange(String(ledger.id));
    setSearchText("");
    setIsOpen(false);
    setHighlightIndex(-1);
    if (onSelected) {
      // Fire on next tick so parent can shift focus AFTER dropdown closes /
      // the current input finishes its blur/state transitions.
      setTimeout(() => onSelected(ledger), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Busy-style: Enter/Tab picks the highlighted item (or first filtered
      // match if nothing was highlighted) and fires onSelected so the parent
      // can advance focus. Tab keeps its default forward-focus behavior only
      // when the dropdown is empty.
      const idx = highlightIndex >= 0 ? highlightIndex : 0;
      if (flatFiltered.length > 0 && idx < flatFiltered.length) {
        e.preventDefault();
        handleSelect(flatFiltered[idx]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setSearchText("");
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (dropdownRef.current && highlightIndex >= 0) {
      const items = dropdownRef.current.querySelectorAll("[data-ledger-item]");
      if (items[highlightIndex]) {
        items[highlightIndex].scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightIndex]);

  const displayValue = isOpen
    ? searchText
    : selectedLedger
      ? `${selectedLedger.name} (${selectedLedger.group})`
      : "";

  // `accentColor` used to pick a Tailwind ring colour; the concept uses one focus ring.
  void accentColor;
  const inputClass =
    variant === "cell"
      ? `w-full px-2 py-1 bg-transparent border-0 text-xs text-ink focus:outline-none focus:bg-nav-hover`
      : `sl-input h-11 pl-4 ${value && !isOpen ? "pr-10" : "pr-4"} text-sm`;

  return (
    <div ref={containerRef} className="group relative min-w-0">
      {label && (
        <label htmlFor={inputId} className={fieldLabelClass()}>
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        aria-label={label ? undefined : (ariaLabel ?? "Account")}
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls={isOpen ? listId : undefined}
        value={displayValue}
        placeholder={placeholder}
        required={required && !value}
        disabled={disabled}
        onChange={(e) => {
          setSearchText(e.target.value);
          setIsOpen(true);
          setHighlightIndex(-1);
          if (!e.target.value && value) {
            onChange("");
          }
        }}
        onFocus={() => {
          if (disabled) return;
          setIsOpen(true);
          setSearchText("");
          updatePosition();
        }}
        onKeyDown={handleKeyDown}
        className={`${inputClass} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        autoComplete="off"
      />

      {/* Clear button */}
      {value && !isOpen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
            setSearchText("");
            inputRef.current?.focus();
          }}
          aria-label="Clear account"
          title="Clear"
          className={`absolute right-2 flex items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-nav-hover hover:text-ink ${
            variant === "cell" ? "top-1/2 h-6 w-6 -translate-y-1/2" : "bottom-1.5 h-8 w-8"
          }`}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}

      {/* Dropdown portal */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="sl-popover fixed z-[9999] overflow-hidden !p-0"
            style={{
              top: dropdownPos.top + 2,
              left: dropdownPos.left,
              width: Math.max(dropdownPos.width, 260),
              maxHeight: 320,
            }}
          >
            <div
              id={listId}
              role="listbox"
              className="overflow-y-auto p-1.5"
              style={{ maxHeight: 320 }}
            >
              {flatFiltered.length === 0 ? (
                <div className="sl-popover-empty">No accounts found</div>
              ) : (
                groupNames.map((groupName) => (
                  <div key={groupName} role="group" aria-label={groupName}>
                    <div className="sl-popover-label sticky top-0 z-[1] bg-card">
                      {groupName} ({grouped[groupName].length})
                    </div>
                    {grouped[groupName].map((ledger) => {
                      const globalIdx = flatFiltered.indexOf(ledger);
                      const isHighlighted = globalIdx === highlightIndex;
                      const isSelected = String(ledger.id) === value;

                      return (
                        <div
                          key={ledger.id}
                          data-ledger-item
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelect(ledger)}
                          className={`sl-option justify-between ${isHighlighted ? "is-highlighted" : ""} ${isSelected ? "is-selected" : ""}`}
                        >
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-ink truncate block">
                              {ledger.name}
                            </span>
                            {(ledger.customer || ledger.supplier) && (
                              <span className="text-[11px] font-normal text-ink-subtle">
                                {ledger.customer ? `Customer: ${ledger.customer.firmName}` : ""}
                                {ledger.supplier ? `Supplier: ${ledger.supplier.legalName}` : ""}
                              </span>
                            )}
                          </div>
                          <span className="ml-2 shrink-0 text-[11px] font-normal text-ink-subtle">
                            {ledger.group}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default LedgerSearchInput;
