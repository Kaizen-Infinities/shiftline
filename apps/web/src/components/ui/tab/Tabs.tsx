import React, { useId, useRef, useState } from "react";

export interface TabItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: TabItem[];
  defaultActiveKey?: string;
  /** Controlled mode (optional) */
  activeKey?: string;
  onChange?: (key: string) => void;
  className?: string;
  align?: "left" | "center" | "right";
  /** primary = pale-blue chips with a blue active chip; secondary = quiet text chips. */
  variant?: "primary" | "secondary";
  /** Kept for compatibility; every variant is now a row of pill chips. */
  pill?: boolean;
}

const alignClasses: Record<NonNullable<TabsProps["align"]>, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

/** Tabs as a chip row (concept detail screens) with its panel underneath; arrow keys move between tabs. */
const Tabs: React.FC<TabsProps> = ({
  tabs,
  defaultActiveKey,
  activeKey: controlledKey,
  onChange,
  className = "",
  align = "left",
  variant = "primary",
  pill = false,
}) => {
  const [internalKey, setInternalKey] = useState(defaultActiveKey || tabs[0]?.key);
  const isControlled = controlledKey !== undefined;
  const activeKey = isControlled ? controlledKey : internalKey;
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const handleSelect = (key: string) => {
    if (!isControlled) setInternalKey(key);
    onChange?.(key);
  };

  const activeTab = tabs.find((t) => t.key === activeKey);
  const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);

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
    handleSelect(tabs[target].key);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  };

  const quiet = variant === "secondary";
  void pill;

  return (
    <div className={`w-full ${className}`}>
      <div
        className={`mb-5 mt-1 flex w-full overflow-x-auto py-1 [scrollbar-width:none] ${alignClasses[align]}`}
      >
        <div
          ref={listRef}
          role="tablist"
          className={`flex min-w-max items-center gap-2 ${quiet ? "rounded-full border border-line-soft bg-card p-1" : ""}`}
        >
          {tabs.map((tab, index) => {
            const isActive = activeKey === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab.key}`}
                aria-controls={`${baseId}-panel`}
                data-key={tab.key}
                aria-selected={isActive}
                tabIndex={isActive || (!activeTab && index === 0) ? 0 : -1}
                disabled={tab.disabled}
                onClick={() => handleSelect(tab.key)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={`sl-chip sl-chip-lg shrink-0 ${quiet ? "sl-chip-ghost" : ""}`}
              >
                {tab.icon && (
                  <span className="inline-flex items-center text-[15px]" aria-hidden="true">
                    {tab.icon}
                  </span>
                )}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={activeTab ? `${baseId}-tab-${activeTab.key}` : undefined}
        className="animate-[sl-fade-in_0.2s_ease] motion-reduce:animate-none"
      >
        {activeTab?.content}
      </div>
    </div>
  );
};

export default Tabs;
