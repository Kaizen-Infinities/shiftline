import { useState, useEffect, useCallback, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { getCurrentUser } from "../../features/auth/authSlice";
import { useSocketSync } from "../../hooks/useSocketSync";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import ImpersonationBanner from "../common/ImpersonationBanner";
import BetaNotice from "./BetaNotice";
import ShortcutPanel from "../ui/ShortcutPanel/ShortcutPanel";
import Calculator from "../ui/Calculator/Calculator";
import PrefetchProgressBar from "../../providers/PrefetchProgressBar";
import CommandPaletteProvider from "../command-palette/CommandPaletteProvider";
import { STORAGE_KEYS, readJSON, writeJSON } from "../../navigation/storage";
import AppSidebar from "./AppSidebar";
import TopBar from "./TopBar";
import MobileTabBar from "./MobileTabBar";

/** Legacy "open the header menu" shortcuts (Alt+T, Alt+A, Alt+D, Alt+P) now open area hubs. */
const MENU_TO_HUB: Record<string, string> = {
  Transactions: "/hub/sales",
  Administration: "/hub/settings",
  Display: "/hub/reports",
  Payroll: "/hub/payroll",
};

/**
 * The app shell (docs/specs/UI-v2.md): a left sidebar (collapsible to an icon rail) on desktop,
 * a top bar with breadcrumb, search, theme, notifications and account, and on phones a drawer
 * plus a bottom tab bar. The command palette (Ctrl/⌘+K) lives here too.
 */
const BaseLayout = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAppSelector((state) => state.auth);
  const { data: company } = useAppSelector((state) => state.company);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(
    () => readJSON<boolean>(STORAGE_KEYS.sidebarCollapsed, false) === true
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      writeJSON(STORAGE_KEYS.sidebarCollapsed, !prev);
      return !prev;
    });
  }, []);
  const toggleShortcuts = useCallback(() => setShortcutsOpen((o) => !o), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const openCalculator = useCallback(() => setCalcOpen(true), []);

  // F1: the drawer on phones, the shortcut sheet on desktop (as before).
  const handleF1 = useCallback(() => {
    if (window.innerWidth < 1024) setDrawerOpen((o) => !o);
    else toggleShortcuts();
  }, [toggleShortcuts]);

  const { activeKey } = useGlobalShortcuts({
    onTogglePanel: toggleShortcuts,
    onToggleSidebar: handleF1,
    onOpenCalculator: openCalculator,
  });

  useEffect(() => {
    const onMenu = (event: Event) => {
      const title = (event as CustomEvent<{ menuTitle?: string }>).detail?.menuTitle;
      const hub = title ? MENU_TO_HUB[title] : undefined;
      if (hub) navigate(hub);
    };
    window.addEventListener("nav-open-menu", onMenu);
    return () => window.removeEventListener("nav-open-menu", onMenu);
  }, [navigate]);

  // Live permission sync: when roles change anywhere, reload what this user may see.
  useSocketSync("rolePermission", undefined, () => {
    dispatch(getCurrentUser());
  });
  useSocketSync("role", undefined, () => {
    dispatch(getCurrentUser());
  });
  useEffect(() => {
    const onFocus = () => {
      if (!user) dispatch(getCurrentUser());
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dispatch, user]);

  // Tenant favicon.
  useEffect(() => {
    if (!company?.faviconUrl) return;
    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = company.faviconUrl;
  }, [company?.faviconUrl]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  // Drawer: trap focus, close on Escape, lock page scroll, give focus back to the menu button.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const button = menuButtonRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      button?.focus();
    };
  }, [drawerOpen]);

  return (
    <CommandPaletteProvider onOpenShortcuts={openShortcuts} onOpenCalculator={openCalculator}>
      <div className="flex h-screen overflow-hidden bg-page text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-full focus:border focus:border-line focus:bg-card focus:px-5 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-md"
        >
          Skip to main content
        </a>

        {/* Desktop sidebar */}
        <aside className="hidden shrink-0 lg:block" aria-label="Sidebar">
          <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </aside>

        {/* Mobile drawer: only rendered while open */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="sl-backdrop sl-anim-fade absolute inset-0"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Main navigation"
              className="sl-anim-drawer absolute inset-y-0 left-0 shadow-[var(--shadow-md)]"
            >
              <AppSidebar variant="drawer" onClose={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <ImpersonationBanner />
          <BetaNotice />
          <TopBar
            onOpenMenu={() => setDrawerOpen(true)}
            menuButtonRef={menuButtonRef}
            onOpenShortcuts={openShortcuts}
          />
          <div className="flex justify-center empty:hidden">
            <PrefetchProgressBar />
          </div>

          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto focus:outline-none"
          >
            <div className="mx-auto flex min-h-full w-full max-w-[1920px] flex-col px-4 pt-2 pb-24 sm:px-5 lg:px-8 lg:pb-10">
              <Outlet />
            </div>
          </main>
        </div>

        <MobileTabBar />

        <ShortcutPanel
          activeKey={activeKey}
          isOpen={shortcutsOpen}
          onToggle={toggleShortcuts}
          onOpenCalculator={openCalculator}
        />
        {calcOpen && <Calculator onClose={() => setCalcOpen(false)} />}
      </div>
    </CommandPaletteProvider>
  );
};

export default BaseLayout;
