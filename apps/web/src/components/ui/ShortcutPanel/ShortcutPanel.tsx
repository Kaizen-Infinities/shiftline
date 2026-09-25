import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator, Keyboard, X } from "lucide-react";

import {
  SHORTCUTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ShortcutCategory,
  type ShortcutItem,
} from "../../../config/shortcuts";
import { usePermission } from "../../../hooks/usePermission";
import { OPEN_PALETTE_EVENT } from "../../command-palette/paletteContext";

interface ShortcutPanelProps {
  /** Label of the key just pressed, flashed in the list. */
  activeKey: string | null;
  isOpen: boolean;
  /** Closes the panel (F1 toggles it from the keyboard). */
  onToggle: () => void;
  onOpenCalculator: () => void;
}

/** The v2 shell turned the old header menus into area hubs; the keys now open those. */
const RELABEL: Record<string, string> = {
  "nav-trans": "Sales hub",
  "nav-admin": "Settings hub",
  "nav-display": "Reports hub",
  "nav-payroll": "Payroll hub",
};
const CATEGORY_TITLE: Record<ShortcutCategory, string> = {
  ...CATEGORY_LABELS,
  nav: "Area hubs",
};

/** Ctrl+K opens search in the v2 shell; it replaces the old Ctrl+K → Stock jump. */
const PALETTE_ROW: ShortcutItem = {
  id: "palette",
  keyLabel: "Ctrl+K",
  key: "k",
  ctrl: true,
  label: "Search screens and actions",
  category: "system",
  action: "palette",
};

/**
 * Keyboard reference, opened with F1 or the keyboard button in the top bar: a side sheet over
 * the page instead of a docked strip, so it never narrows the work area.
 */
const ShortcutPanel: React.FC<ShortcutPanelProps> = ({
  activeKey,
  isOpen,
  onToggle,
  onOpenCalculator,
}) => {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const { can, isSuperAdmin } = usePermission();

  const visible = useMemo(
    () => [
      PALETTE_ROW,
      ...SHORTCUTS.filter(
        (s) => s.id !== "ctrl-k" && (!s.permission || isSuperAdmin || can(s.permission))
      ),
    ],
    [can, isSuperAdmin]
  );

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onToggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [isOpen, onToggle]);

  const run = useCallback(
    (sc: ShortcutItem) => {
      if (sc.route) return navigate(sc.route);
      const events: Record<string, string> = {
        save: "fkey-save",
        submit: "fkey-submit",
        delete: "fkey-delete",
        refresh: "fkey-refresh",
        new: "fkey-new",
        export: "fkey-export",
      };
      const menus: Record<string, string> = {
        "open-admin": "Administration",
        "open-trans": "Transactions",
        "open-display": "Display",
        "open-payroll": "Payroll",
      };
      switch (sc.action) {
        case "palette":
          onToggle();
          window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
          return;
        case "back":
          return navigate(-1);
        case "dashboard":
          return navigate("/dashboard");
        case "toggle-panel":
          return onToggle();
        case "calculator":
          return onOpenCalculator();
        case "reports":
          return navigate("/reports/sales");
        case "print":
          return window.print();
        case "fullscreen":
          if (!document.fullscreenElement)
            document.documentElement.requestFullscreen().catch(() => {});
          else document.exitFullscreen().catch(() => {});
          return;
        case "search":
          document.querySelector<HTMLElement>("[data-search-input]")?.focus();
          return;
        default:
      }
      if (sc.action && events[sc.action]) {
        window.dispatchEvent(new CustomEvent(events[sc.action]));
      } else if (sc.action && menus[sc.action]) {
        window.dispatchEvent(
          new CustomEvent("nav-open-menu", { detail: { menuTitle: menus[sc.action] } })
        );
      }
    },
    [navigate, onToggle, onOpenCalculator]
  );

  if (!isOpen) return null;

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="sl-popover sl-anim-sheet fixed inset-y-3 right-3 z-[70] flex w-[min(calc(100vw-1.5rem),22rem)] flex-col overflow-hidden !rounded-[24px]"
    >
      <div className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
        <span className="sl-icon-tile !h-9 !w-9 !rounded-[11px]">
          <Keyboard size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="sl-h2 text-base">Keyboard shortcuts</h2>
          <p className="text-xs text-ink-subtle">Press F1 to open or close</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close keyboard shortcuts"
          className="sl-icon-btn sl-icon-btn-plain !h-10 !w-10"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="sl-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {CATEGORY_ORDER.map((cat) => {
          const rows = visible.filter((s) => s.category === cat);
          if (!rows.length) return null;
          return (
            <section key={cat} className="py-2" aria-label={CATEGORY_TITLE[cat]}>
              <h3 className="sl-section-label px-2 pb-1.5 !text-xs">{CATEGORY_TITLE[cat]}</h3>
              <ul className="flex flex-col gap-0.5">
                {rows.map((sc) => {
                  const flashing = activeKey === sc.keyLabel;
                  return (
                    <li key={sc.id}>
                      <button
                        type="button"
                        onClick={() => run(sc)}
                        className={`flex min-h-10 w-full items-center gap-3 rounded-[12px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-nav-hover ${
                          flashing ? "bg-nav-active font-semibold text-nav-active-fg" : "text-ink"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {RELABEL[sc.id] ?? sc.label}
                        </span>
                        <span className="sl-kbd">{sc.keyLabel}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="border-t border-line-soft p-3">
        <button type="button" onClick={onOpenCalculator} className="sl-btn w-full !justify-between">
          <span className="flex items-center gap-2">
            <Calculator size={16} aria-hidden className="text-accent" />
            Calculator
          </span>
          <span className="sl-kbd">Alt+C</span>
        </button>
      </div>
    </aside>
  );
};

export default ShortcutPanel;
