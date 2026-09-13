import React, { useRef, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  SHORTCUTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ShortcutCategory,
} from "../../../config/shortcuts";
import { usePermission } from "../../../hooks/usePermission";
import { FaKeyboard, FaChevronRight, FaChevronLeft, FaCalculator } from "react-icons/fa";

interface ShortcutPanelProps {
  activeKey: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onOpenCalculator: () => void;
}

/* Category badges read from the shared tokens (bg-card-2/border-line) so they
   stay correct across themes without a parallel dark: variant to drift out
   of sync; each category keeps a fixed, accessible mid-tone hue for its label. */
const CATEGORY_ACCENT: Record<ShortcutCategory, { text: string }> = {
  nav: { text: "text-amber-600" },
  system: { text: "text-rose-600" },
  create: { text: "text-emerald-600" },
  reports: { text: "text-sky-600" },
  ctrl: { text: "text-violet-600" },
};

/* Single shortcut row — ultra compact & perfectly aligned */
const ShortcutRow = ({
  sc,
  isActive,
  globalIdx,
  focusedIndexRef,
  onClickFn,
}: {
  sc: (typeof SHORTCUTS)[number];
  isActive: boolean;
  globalIdx: number;
  focusedIndexRef: { current: number };
  onClickFn: (sc: (typeof SHORTCUTS)[number]) => void;
}) => {
  const accent = CATEGORY_ACCENT[sc.category];
  return (
    <button
      data-shortcut-btn
      data-idx={globalIdx}
      type="button"
      onClick={() => onClickFn(sc)}
      onFocus={() => {
        focusedIndexRef.current = globalIdx;
      }}
      className={`
        w-full flex items-center gap-2 px-1.5 py-[3px] text-left
        cursor-pointer transition-colors duration-100 outline-none rounded-sm
        focus-visible:bg-card-2
        ${isActive ? "bg-card-2 text-ink" : "hover:bg-card-2 text-ink"}
      `}
    >
      <span
        className={`
        inline-flex items-center justify-center shrink-0
        w-[64px] min-w-[64px] px-1 py-[2px] rounded-sm text-[7.5px]
        font-extrabold font-mono tracking-tight border text-center whitespace-nowrap
        ${isActive ? "bg-accent text-white border-accent" : `bg-card border-line ${accent.text}`}
      `}
      >
        {sc.keyLabel}
      </span>
      <span
        className={`text-[10px] leading-tight truncate flex-1 ${
          isActive ? "text-ink font-bold" : "text-ink-muted font-medium"
        }`}
      >
        {sc.label}
      </span>
    </button>
  );
};

const ShortcutPanel: React.FC<ShortcutPanelProps> = ({
  activeKey,
  isOpen,
  onToggle,
  onOpenCalculator,
}) => {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef<number>(-1);
  const { can, isSuperAdmin } = usePermission();

  // Filter shortcuts by permission — hide entries the current user cannot access.
  // Shortcuts without a `permission` field are always visible (system / nav keys).
  const visibleShortcuts = useMemo(
    () => SHORTCUTS.filter((s) => !s.permission || isSuperAdmin || can(s.permission)),
    [can, isSuperAdmin]
  );

  const allItems = useMemo(
    () => CATEGORY_ORDER.flatMap((cat) => visibleShortcuts.filter((s) => s.category === cat)),
    [visibleShortcuts]
  );

  const handleClick = useCallback(
    (sc: (typeof SHORTCUTS)[number]) => {
      if (sc.route) {
        navigate(sc.route);
        return;
      }
      if (sc.action === "back") {
        navigate(-1);
        return;
      }
      if (sc.action === "dashboard") {
        navigate("/dashboard");
        return;
      }
      if (sc.action === "toggle-panel") {
        onToggle();
        return;
      }
      if (sc.action === "calculator") {
        onOpenCalculator();
        return;
      }
      if (sc.action === "help") {
        navigate("/help");
        return;
      }
      if (sc.action === "reports") {
        navigate("/reports/sales");
        return;
      }
      if (sc.action === "print") {
        window.print();
        return;
      }
      if (sc.action === "fullscreen") {
        if (!document.fullscreenElement)
          document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
        return;
      }
      // F-key events — dispatch so active form/page handles them
      if (sc.action === "save") {
        window.dispatchEvent(new CustomEvent("fkey-save"));
        return;
      }
      if (sc.action === "submit") {
        window.dispatchEvent(new CustomEvent("fkey-submit"));
        return;
      }
      if (sc.action === "delete") {
        window.dispatchEvent(new CustomEvent("fkey-delete"));
        return;
      }
      if (sc.action === "refresh") {
        window.dispatchEvent(new CustomEvent("fkey-refresh"));
        return;
      }
      if (sc.action === "new") {
        window.dispatchEvent(new CustomEvent("fkey-new"));
        return;
      }
      if (sc.action === "export") {
        window.dispatchEvent(new CustomEvent("fkey-export"));
        return;
      }
      if (sc.action === "search") {
        document.querySelector<HTMLElement>("[data-search-input]")?.focus();
        return;
      }
      // Navigation menu actions
      if (sc.action === "open-admin") {
        window.dispatchEvent(
          new CustomEvent("nav-open-menu", { detail: { menuTitle: "Administration" } })
        );
        return;
      }
      if (sc.action === "open-trans") {
        window.dispatchEvent(
          new CustomEvent("nav-open-menu", { detail: { menuTitle: "Transactions" } })
        );
        return;
      }
      if (sc.action === "open-display") {
        window.dispatchEvent(
          new CustomEvent("nav-open-menu", { detail: { menuTitle: "Display" } })
        );
        return;
      }
      if (sc.action === "open-payroll") {
        window.dispatchEvent(
          new CustomEvent("nav-open-menu", { detail: { menuTitle: "Payroll" } })
        );
        return;
      }
    },
    [navigate, onToggle, onOpenCalculator]
  );

  return (
    <div
      className={`relative flex flex-row h-full shrink-0 transition-all duration-300 ease-in-out ${
        isOpen ? "w-[240px]" : "w-[28px]"
      }`}
      style={{ zIndex: 30 }}
    >
      {/* ── Pull-tab ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onToggle}
        title={isOpen ? "Close Shortcuts  F1" : "Open Shortcuts  F1"}
        className="flex items-center justify-center w-[28px] shrink-0 h-full cursor-pointer select-none transition-colors duration-200 border-l border-line bg-card-2 hover:bg-card text-ink-muted hover:text-ink"
      >
        <span className="flex flex-col items-center gap-1">
          <FaKeyboard className="text-[10px]" />
          <span
            className="text-[7px] font-extrabold uppercase"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              letterSpacing: "0.12em",
            }}
          >
            Shortcuts
          </span>
          {isOpen ? (
            <FaChevronRight className="text-[7px]" />
          ) : (
            <FaChevronLeft className="text-[7px]" />
          )}
        </span>
      </button>

      {/* ── Panel body ───────────────────────────────────────── */}
      <div
        ref={panelRef}
        className={`
          flex-1 bg-card border-l border-line
          flex flex-col overflow-hidden
          transition-all duration-300 ease-in-out
          ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none w-0"}
        `}
        style={{ minWidth: isOpen ? 212 : 0 }}
      >
        {/* Header */}
        <div className="px-2.5 py-1.5 border-b border-line flex items-center gap-1.5 shrink-0 bg-card-2">
          <FaKeyboard className="text-accent text-[11px] shrink-0" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink">
            Shortcut Keys
          </span>
          <span className="ml-auto text-[8px] font-bold text-ink-muted border border-line bg-card rounded-sm px-1">
            F1
          </span>
        </div>

        {/* Sections — scrollable but scrollbar hidden */}
        <div
          className="flex-1 flex flex-col min-h-0 overflow-y-auto px-1.5 py-1 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {CATEGORY_ORDER.map((cat) => {
            const items = visibleShortcuts.filter((s) => s.category === cat);
            if (!items.length) return null;
            const accent = CATEGORY_ACCENT[cat];

            return (
              <div key={cat} className="shrink-0 mb-1">
                {/* Section label */}
                <div className="px-1.5 pt-1.5 pb-0.5 flex items-center justify-between">
                  <span
                    className={`text-[8px] font-black uppercase tracking-widest ${accent.text}`}
                  >
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <span className="text-[7.5px] text-ink-subtle font-mono font-semibold">
                    {items.length}
                  </span>
                </div>

                <div className="flex flex-col gap-[1px]">
                  {items.map((sc) => {
                    const globalIdx = allItems.findIndex((x) => x.id === sc.id);
                    return (
                      <ShortcutRow
                        key={sc.id}
                        sc={sc}
                        isActive={activeKey === sc.keyLabel}
                        globalIdx={globalIdx}
                        focusedIndexRef={focusedIndexRef}
                        onClickFn={handleClick}
                      />
                    );
                  })}
                </div>

                {/* Thin divider */}
                <div className="mx-1 mt-1 border-t border-line-soft" />
              </div>
            );
          })}

          {/* Footer: calculator button */}
          <div className="mt-auto pt-1 px-1 flex flex-col gap-1 pb-1">
            <button
              type="button"
              onClick={onOpenCalculator}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-sm bg-card-2 hover:bg-card border border-line transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <FaCalculator className="text-[11px] text-accent shrink-0" />
                <span className="text-[11px] font-bold text-ink-muted group-hover:text-ink">
                  Calculator
                </span>
              </div>
              <span className="text-[9px] font-black text-ink-muted bg-card border border-line px-1.5 py-0.5 rounded-sm font-mono">
                Alt+C
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShortcutPanel;
