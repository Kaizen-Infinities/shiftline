import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaFilter, FaTimes } from "react-icons/fa";
import CustomButton from "../Button/Button";

interface FilterPopoverProps {
  activeFilterCount: number;
  onApply: () => void;
  onClear: () => void;
  onClose?: () => void;
  onOpen?: () => void;
  children: React.ReactNode;
  hasActiveFilters: boolean;
}

/** "Filters" pill that opens a floating panel with the filter fields and Clear / Apply pills. */
const FilterPopover: React.FC<FilterPopoverProps> = ({
  activeFilterCount,
  onApply,
  onClear,
  onClose,
  onOpen,
  children,
  hasActiveFilters,
}) => {
  const [show, setShow] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const filterBtnRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (filterBtnRef.current) {
      const rect = filterBtnRef.current.getBoundingClientRect();
      setPopoverStyle({
        position: "fixed",
        top: `${rect.bottom + 8}px`,
        right: `${window.innerWidth - rect.right}px`,
        zIndex: 99999,
      });
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.closest("[data-select-portal]") ||
          target.closest(".react-select__menu") ||
          target.closest("[class*='select-menu']"))
      ) {
        return;
      }

      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        filterBtnRef.current &&
        !filterBtnRef.current.contains(target)
      ) {
        setShow(false);
        if (onClose) onClose();
      }
    };
    if (show) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [show, onClose]);

  const handleToggle = () => {
    if (!show) {
      updatePosition();
      if (onOpen) onOpen();
    } else {
      if (onClose) onClose();
    }
    setShow(!show);
  };

  const handleApply = () => {
    onApply();
    setShow(false);
  };

  const handleClear = () => {
    onClear();
    setShow(false);
  };

  return (
    <div ref={filterBtnRef} className="relative">
      <CustomButton
        text={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
        variant="secondary"
        icon={FaFilter}
        onClick={handleToggle}
        className={
          hasActiveFilters
            ? "!border-transparent !bg-nav-active !text-[color:var(--color-nav-active-fg)]"
            : ""
        }
      />

      {show &&
        createPortal(
          <div
            ref={popoverRef}
            style={popoverStyle}
            role="dialog"
            aria-label="Filters"
            className="sl-popover w-[320px] max-w-[calc(100vw-1.5rem)] !p-0"
          >
            <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <span className="sl-h2 !text-base">Filters</span>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => {
                  setShow(false);
                  if (onClose) onClose();
                }}
                className="sl-icon-btn sl-icon-btn-ghost -mr-1.5"
              >
                <FaTimes aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>

            <div className="flex gap-2 rounded-b-[16px] border-t border-line-soft bg-card-2/60 px-4 py-3">
              <div className="flex-1">
                <CustomButton
                  text="Clear"
                  variant="secondary"
                  onClick={handleClear}
                  width="100%"
                  size="md"
                />
              </div>
              <div className="flex-1">
                <CustomButton
                  text="Apply"
                  variant="primary"
                  onClick={handleApply}
                  width="100%"
                  size="md"
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default FilterPopover;
