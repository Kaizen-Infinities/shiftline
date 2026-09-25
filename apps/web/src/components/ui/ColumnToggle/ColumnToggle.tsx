import React, { useState, useRef, useEffect } from "react";
import { FaCheck, FaColumns } from "react-icons/fa";
import Button from "../Button/Button";

interface ColumnToggleProps {
  columns: { header: string; accessor?: any }[];
  visibleColumns: string[];
  setVisibleColumns: (columns: string[]) => void;
  align?: "left" | "right";
}

/** "Columns" pill with a checklist popover to show or hide table columns. */
const ColumnToggle: React.FC<ColumnToggleProps> = ({
  columns,
  visibleColumns,
  setVisibleColumns,
  align = "left",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleColumn = (header: string) => {
    if (visibleColumns.includes(header)) {
      setVisibleColumns(visibleColumns.filter((c) => c !== header));
    } else {
      setVisibleColumns([...visibleColumns, header]);
    }
  };

  const selectAll = () => {
    setVisibleColumns(columns.map((c) => c.header));
  };

  const deselectAll = () => {
    setVisibleColumns([]);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <Button
        text="Columns"
        icon={FaColumns}
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
      />

      {isOpen && (
        <div
          role="dialog"
          aria-label="Show or hide columns"
          className={`sl-popover absolute ${align === "right" ? "right-0" : "left-0"} z-50 mt-2 w-64 !p-0`}
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <span className="text-[13px] font-semibold text-ink-muted">Show columns</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-nav-hover"
                onClick={selectAll}
              >
                All
              </button>
              <button
                type="button"
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-ink-subtle hover:bg-nav-hover hover:text-ink"
                onClick={deselectAll}
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto px-1.5 pb-1.5">
            {columns.map((col, index) => {
              const isVisible = visibleColumns.includes(col.header);
              return (
                <button
                  key={index}
                  type="button"
                  aria-pressed={isVisible}
                  onClick={() => toggleColumn(col.header)}
                  className="sl-option"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors ${isVisible ? "border-transparent bg-accent text-white" : "border-line bg-card"}`}
                  >
                    {isVisible && <FaCheck size={9} />}
                  </span>
                  <span className="truncate font-medium capitalize">
                    {col.header.toLowerCase()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ColumnToggle;
