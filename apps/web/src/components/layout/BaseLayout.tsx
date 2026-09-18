import { useState, useEffect, useCallback, useRef } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";

import { useAppSelector } from "../../hooks/reduxHooks";
import Navbar from "../common/Navbar";
import ImpersonationBanner from "../common/ImpersonationBanner";
import Sidebar from "../common/sidebar/Sidebar";
import HorizontalNav from "../common/sidebar/HorizontalNav";
import Footer from "../common/Footer";
import ShortcutPanel from "../ui/ShortcutPanel/ShortcutPanel";
import Calculator from "../ui/Calculator/Calculator";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";

const BaseLayout = () => {
  const [showSidebar, setShowSidebar] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAppSelector((state) => state.auth);
  const { data: company } = useAppSelector((state) => state.company);

  // ── Shortcut panel: persistent in localStorage across all page navigation & reloads ──
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("shortcut_panel_open");
      if (saved !== null) return saved === "true";
    } catch (_) {}
    return false; // Keep the workspace wide until the user asks for the shortcut reference.
  });

  const handleTogglePanel = useCallback(() => {
    setPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("shortcut_panel_open", String(next));
      } catch (_) {}
      return next;
    });
  }, []);

  // ── Calculator ──────────────────────────────────────────────────
  const [calcOpen, setCalcOpen] = useState(false);
  const handleOpenCalculator = useCallback(() => setCalcOpen(true), []);

  // ── Global keyboard shortcuts ───────────────────────────────────
  const handleToggleSidebar = useCallback(() => {
    if (window.innerWidth < 1024) {
      setShowSidebar((prev) => !prev);
    } else {
      handleTogglePanel();
    }
  }, [handleTogglePanel]);

  const { activeKey } = useGlobalShortcuts({
    onTogglePanel: handleTogglePanel,
    onToggleSidebar: handleToggleSidebar,
    onOpenCalculator: handleOpenCalculator,
  });

  // ── Company favicon ─────────────────────────────────────────────
  useEffect(() => {
    if (company?.faviconUrl) {
      let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = company.faviconUrl;
    }
  }, [company?.faviconUrl]);

  useEffect(() => {
    setShowSidebar(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!showSidebar) return;

    const previousOverflow = document.body.style.overflow;
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSidebar(false);
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      menuButtonRef.current?.focus();
    };
  }, [showSidebar]);

  return (
    <div className="flex h-screen overflow-hidden">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-accent px-4 py-2.5 font-semibold text-white shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-4 focus:ring-accent/30"
      >
        Skip to main content
      </a>
      {/* Mobile Sidebar Overlay */}
      {showSidebar && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        aria-hidden={!showSidebar}
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out lg:hidden ${
          showSidebar ? "visible translate-x-0" : "invisible -translate-x-full pointer-events-none"
        }`}
      >
        <Sidebar onNavigate={() => setShowSidebar(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Navbar (Mobile only) */}
        <div className="lg:hidden">
          <Navbar
            menuButtonRef={menuButtonRef}
            onMenuClick={() => setShowSidebar(true)}
            user={user}
            onProfileClick={() => navigate("/company/view")}
          />
        </div>

        <ImpersonationBanner />

        {/* Horizontal Navigation (Large screens) */}
        <HorizontalNav />

        {/* Content row: main + shortcut panel side by side */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main Content */}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 w-full min-w-0 overflow-y-auto bg-page"
          >
            <div className="w-full max-w-[1920px] mx-auto px-3 sm:px-4 lg:px-5 py-3 min-h-full flex flex-col">
              <Outlet />
            </div>
          </main>

          {/* Shortcut Panel — right side */}
          <ShortcutPanel
            activeKey={activeKey}
            isOpen={panelOpen}
            onToggle={handleTogglePanel}
            onOpenCalculator={handleOpenCalculator}
          />
        </div>

        <Footer />
      </div>

      {/* Floating Calculator (F10) */}
      {calcOpen && <Calculator onClose={() => setCalcOpen(false)} />}
    </div>
  );
};

export default BaseLayout;
