import React, { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard, Search, UserRound } from "lucide-react";

import { useCommandPalette } from "../command-palette/paletteContext";
import { usePermission } from "../../hooks/usePermission";
import { useSidebarNav } from "../../navigation/useNav";
import { areaHome, cleanPath } from "../../navigation/nav.utils";
import { mostUsedArea, recordAreaVisit } from "../../navigation/storage";

/**
 * Phone bottom bar (below 1024px): Home, Search, the area this person opens most, and Profile.
 * Each tab is at least 44px square.
 */
const MobileTabBar: React.FC = () => {
  const { areas, activeArea, pathname } = useSidebarNav();
  const { openPalette, isOpen } = useCommandPalette();
  const { can } = usePermission();
  const activeId = activeArea?.id;

  // Count area visits so the third tab follows habit, not a fixed guess.
  useEffect(() => {
    if (activeId && activeId !== "dashboard" && activeId !== "you") recordAreaVisit(activeId);
  }, [activeId]);

  // Re-read the counts whenever the area changes (storage may be unavailable: then the first
  // area the person can open is used).
  const favourite = useMemo(() => {
    const candidates = areas.filter((a) => !a.hidden && a.id !== "dashboard");
    const id = mostUsedArea(candidates.map((a) => a.id));
    return candidates.find((a) => a.id === id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, activeId]);

  const current = cleanPath(pathname);
  const profilePath = can("profile.view") ? "/profile" : "/company/view";
  const FavIcon = favourite?.icon;

  return (
    <nav
      aria-label="Quick"
      className="sl-tabbar fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 gap-1 px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <Link
        to="/dashboard"
        className="sl-tab"
        aria-current={current === "/dashboard" || current === "/" ? "page" : undefined}
      >
        <span className="sl-tab-icon">
          <LayoutDashboard size={20} aria-hidden />
        </span>
        Home
      </Link>
      <button
        type="button"
        onClick={openPalette}
        className="sl-tab"
        aria-current={isOpen ? "page" : undefined}
      >
        <span className="sl-tab-icon">
          <Search size={20} aria-hidden />
        </span>
        Search
      </button>
      {favourite && FavIcon ? (
        <Link
          to={areaHome(favourite)}
          className="sl-tab"
          aria-current={activeArea?.id === favourite.id ? "page" : undefined}
        >
          <span className="sl-tab-icon">
            <FavIcon size={20} aria-hidden />
          </span>
          <span className="max-w-full truncate px-1">{favourite.title}</span>
        </Link>
      ) : (
        <span aria-hidden />
      )}
      <Link
        to={profilePath}
        className="sl-tab"
        aria-current={current === profilePath ? "page" : undefined}
      >
        <span className="sl-tab-icon">
          <UserRound size={20} aria-hidden />
        </span>
        Profile
      </Link>
    </nav>
  );
};

export default MobileTabBar;
