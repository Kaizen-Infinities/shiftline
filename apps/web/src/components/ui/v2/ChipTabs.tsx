import React, { useRef } from "react";
import { cx } from "./cx";

export interface ChipTabItem<K extends string = string> {
  key: K;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional count shown in a small badge after the label. */
  count?: React.ReactNode;
  disabled?: boolean;
}

export interface ChipTabsProps<K extends string = string> {
  items: ChipTabItem<K>[];
  /** The selected key (controlled). */
  value: K;
  onChange: (key: K) => void;
  /** Accessible name for the tab list, e.g. "Invoice status". */
  ariaLabel?: string;
  /** `chip` = pale-blue chips with a blue active chip; `ghost` = quiet text chips. */
  variant?: "chip" | "ghost";
  size?: "sm" | "md" | "lg";
  /** When set, tabs get ids `${idPrefix}-tab-${key}` and point at `${idPrefix}-panel-${key}`. */
  idPrefix?: string;
  className?: string;
}

/** A row of chips acting as tabs (controlled), with roving focus and arrow-key navigation. */
export function ChipTabs<K extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  variant = "chip",
  size = "md",
  idPrefix,
  className,
}: ChipTabsProps<K>) {
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[index]?.focus();
  };

  const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);

  const select = (index: number | undefined) => {
    if (index === undefined) return;
    onChange(items[index].key);
    focusTab(index);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!enabled.length) return;
    const pos = enabled.indexOf(index);
    let target: number | undefined;
    if (event.key === "ArrowRight") target = enabled[(pos + 1) % enabled.length];
    else if (event.key === "ArrowLeft")
      target = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") target = enabled[0];
    else if (event.key === "End") target = enabled[enabled.length - 1];
    else return;
    event.preventDefault();
    select(target);
  };

  const hasSelection = items.some((item) => item.key === value);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cx(
        "flex max-w-full items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none]",
        className
      )}
    >
      {items.map((item, index) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${item.key}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${item.key}` : undefined}
            aria-selected={selected}
            tabIndex={selected || (!hasSelection && index === 0) ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              "sl-chip shrink-0",
              variant === "ghost" && "sl-chip-ghost",
              size === "sm" && "sl-chip-sm",
              size === "lg" && "sl-chip-lg"
            )}
          >
            {item.icon && (
              <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span>{item.label}</span>
            {item.count !== undefined && item.count !== null && (
              <span className="sl-chip-count">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ChipTabs;
