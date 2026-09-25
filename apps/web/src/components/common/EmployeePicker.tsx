import React, { useEffect, useRef, useState } from "react";

import { employeeService, type EmployeeSearchRow } from "../../services/employeeService";

/**
 * A typeahead over `GET /employees/search` (P2-15), used wherever a screen needs to pick an
 * employee without holding `employees.view` — the HR request forms on `/hr/leave` and `/hr/fines`
 * previously took a raw employee id typed by hand.
 */
export interface EmployeePickerProps {
  value: string;
  onChange: (employeeId: string, employee: EmployeeSearchRow | null) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}

const field = "sl-input h-11 px-4 text-sm";

export const EmployeePicker: React.FC<EmployeePickerProps> = ({
  value,
  onChange,
  placeholder = "Search employee by name or code",
  className,
  required,
  disabled,
}) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EmployeeSearchRow | null>(null);
  const [results, setResults] = useState<EmployeeSearchRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Cleared from outside (e.g. the form reset) — drop the picked employee and typed text too.
  useEffect(() => {
    if (!value) {
      setSelected(null);
      setQuery("");
    }
  }, [value]);

  useEffect(() => {
    if (selected || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      employeeService
        .search(query)
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, selected]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const pick = (row: EmployeeSearchRow) => {
    setSelected(row);
    setQuery(`${row.fullName} (${row.empCode})`);
    setOpen(false);
    onChange(row.id, row);
  };

  const clear = () => {
    setSelected(null);
    setQuery("");
    setResults([]);
    onChange("", null);
  };

  return (
    <div className={`relative ${className ?? ""}`} ref={boxRef}>
      <div className="flex items-center gap-1">
        <input
          className={`${field} w-full`}
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          required={required && !selected}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setSelected(null);
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {selected && (
          <button
            type="button"
            className="sl-icon-btn sl-icon-btn-ghost sl-icon-btn-md shrink-0"
            onClick={clear}
            aria-label="Clear employee"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>
      {open && !selected && query.trim() && (
        <ul className="sl-popover absolute z-10 mt-1.5 max-h-64 w-full overflow-y-auto">
          {loading && <li className="sl-popover-empty">Searching…</li>}
          {!loading && results.length === 0 && (
            <li className="sl-popover-empty">No matching employees.</li>
          )}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="sl-option block" onClick={() => pick(r)}>
                <span className="font-medium text-ink">{r.fullName}</span>{" "}
                <span className="text-ink-muted">({r.empCode})</span>
                {(r.department || r.businessPlace) && (
                  <div className="text-xs text-ink-muted">
                    {[r.department, r.businessPlace?.name].filter(Boolean).join(" · ")}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EmployeePicker;
