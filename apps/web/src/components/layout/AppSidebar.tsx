import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

import { BrandLockup, BrandMark } from "../brand/BrandMark";
import type { NavArea } from "../../navigation/nav.types";
import { areaHome, cleanPath, matchPath, screensOf } from "../../navigation/nav.utils";
import { useSidebarNav } from "../../navigation/useNav";

interface AppSidebarProps {
  /** Icon rail (desktop only). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Rendered inside the mobile drawer: full width, with a close button. */
  variant?: "desktop" | "drawer";
  onClose?: () => void;
}

interface Tip {
  label: string;
  top: number;
  left: number;
}

/**
 * The left navigation (docs/specs/UI-v2.md): the brand tile, then white pill rows grouped under
 * section labels. The active area is pale blue and opens in place into its screens. Collapsed,
 * it becomes a 76px rail of icon tiles whose names show in a tooltip.
 */
const AppSidebar: React.FC<AppSidebarProps> = ({
  collapsed = false,
  onToggleCollapsed,
  variant = "desktop",
  onClose,
}) => {
  const { sections, activeArea, pathname } = useSidebarNav();
  const rail = collapsed && variant === "desktop";
  const [tip, setTip] = useState<Tip | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLAnchorElement>(null);

  const current = cleanPath(pathname);
  const currentScreenId = matchPath(pathname)?.screen.id;

  // Keep the active area in view when the page loads deep in a long menu.
  useEffect(() => {
    const row = activeRowRef.current;
    const box = scrollRef.current;
    if (!row || !box) return;
    const rowBox = row.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    if (rowBox.top < boxRect.top || rowBox.bottom > boxRect.bottom - 80) {
      box.scrollTop += rowBox.top - boxRect.top - 96;
    }
  }, [activeArea?.id]);

  const showTip = useCallback(
    (label: string) => (event: React.SyntheticEvent<HTMLElement>) => {
      if (!rail) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 12 });
    },
    [rail]
  );
  const hideTip = useCallback(() => setTip(null), []);

  const renderSubLinks = (area: NavArea) => {
    const multiGroup = area.groups.length > 1;
    return (
      <div className="mt-1.5 mb-2 ml-3 flex flex-col gap-0.5 border-l border-line pl-3">
        {area.groups.map((group) => (
          <React.Fragment key={group.id}>
            {multiGroup && (
              <div className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {group.title}
              </div>
            )}
            {group.screens.map((screen) => {
              const exact = cleanPath(screen.path) === current;
              const inside = !exact && currentScreenId === screen.id;
              return (
                <Link
                  key={screen.id}
                  to={screen.path}
                  onClick={onClose}
                  aria-current={exact ? "page" : inside ? "true" : undefined}
                  className="sl-subnav-item"
                >
                  <span className="truncate">{screen.title}</span>
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <nav
      aria-label="Main"
      className={`flex h-full flex-col ${
        variant === "drawer" ? "w-[min(88vw,320px)] bg-page" : rail ? "w-[76px]" : "w-[272px]"
      }`}
    >
      {/* Brand */}
      <div
        className={`flex shrink-0 items-center ${
          rail ? "justify-center px-2 pt-5 pb-4" : "justify-between px-5 pt-5 pb-4"
        }`}
      >
        <Link
          to="/dashboard"
          onClick={onClose}
          aria-label="Shiftline home"
          className="rounded-[14px] focus-visible:outline-offset-4"
        >
          {rail ? <BrandMark size={40} /> : <BrandLockup size={40} />}
        </Link>
        {variant === "drawer" && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="sl-icon-btn sl-icon-btn-plain"
          >
            <X size={20} aria-hidden />
          </button>
        )}
      </div>

      {/* Areas */}
      <div
        ref={scrollRef}
        onScroll={hideTip}
        className={`sl-scroll flex-1 overflow-y-auto overflow-x-hidden pb-4 ${rail ? "px-3" : "px-4"}`}
      >
        {sections.map(({ section, areas }, sectionIndex) => (
          <div key={section.id} className={sectionIndex === 0 ? "" : "mt-4"}>
            {rail ? (
              sectionIndex > 0 && <div className="mx-3 mb-3 h-px bg-line" aria-hidden />
            ) : (
              <div className="sl-section-label mb-2 px-1">{section.title}</div>
            )}
            <ul className="flex flex-col gap-2">
              {areas.map((area) => {
                const Icon = area.icon;
                const home = areaHome(area);
                const isActive = activeArea?.id === area.id;
                const expand = isActive && !rail && screensOf(area).length > 1;
                return (
                  <li key={area.id}>
                    <Link
                      ref={isActive ? activeRowRef : undefined}
                      to={home}
                      onClick={onClose}
                      aria-current={current === cleanPath(home) ? "page" : undefined}
                      aria-label={rail ? area.title : undefined}
                      onMouseEnter={showTip(area.title)}
                      onMouseLeave={hideTip}
                      onFocus={showTip(area.title)}
                      onBlur={hideTip}
                      className={`sl-nav-item ${isActive ? "is-active" : ""} ${
                        rail ? "h-12 w-12 justify-center !p-0 mx-auto" : "min-h-12"
                      }`}
                    >
                      <Icon
                        size={20}
                        strokeWidth={isActive ? 2.25 : 1.9}
                        aria-hidden
                        className={isActive ? "text-accent" : "text-ink-muted"}
                      />
                      {!rail && <span className="truncate">{area.title}</span>}
                    </Link>
                    {expand && renderSubLinks(area)}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Collapse toggle (desktop) */}
      {variant === "desktop" && onToggleCollapsed && (
        <div className={`shrink-0 pb-4 pt-2 ${rail ? "px-3" : "px-4"}`}>
          <button
            type="button"
            onClick={() => {
              hideTip();
              onToggleCollapsed();
            }}
            aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!rail}
            onMouseEnter={showTip("Expand sidebar")}
            onMouseLeave={hideTip}
            className={`flex items-center gap-3 rounded-[14px] text-sm font-medium text-ink-subtle transition-colors hover:bg-card hover:text-ink ${
              rail ? "mx-auto h-11 w-11 justify-center" : "h-11 w-full px-4"
            }`}
          >
            {rail ? (
              <PanelLeftOpen size={19} aria-hidden />
            ) : (
              <>
                <PanelLeftClose size={19} aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      )}

      {tip && (
        <div
          role="tooltip"
          className="sl-tooltip sl-anim-fade fixed z-[90] -translate-y-1/2"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </div>
      )}
    </nav>
  );
};

export default AppSidebar;
