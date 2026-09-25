import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { usePermission } from "../hooks/usePermission";
import { NAV_AREAS } from "./nav.config";
import type { NavArea, NavViewer } from "./nav.types";
import { breadcrumbsFor, filterAreas, findAreaByPath, sidebarSections } from "./nav.utils";

/** The signed-in viewer in the shape the nav helpers expect (same rules as ProtectedRoute). */
export const useNavViewer = (): NavViewer => {
  const { can, isSuperAdmin } = usePermission();
  return useMemo(() => ({ can, isSuperAdmin }), [can, isSuperAdmin]);
};

/** Areas, groups and screens the signed-in user may open. */
export const useVisibleAreas = (): NavArea[] => {
  const viewer = useNavViewer();
  return useMemo(() => filterAreas(viewer), [viewer]);
};

/** The visible areas grouped for the sidebar, plus the active area for the current URL. */
export const useSidebarNav = () => {
  const areas = useVisibleAreas();
  const { pathname } = useLocation();
  const sections = useMemo(() => sidebarSections(areas), [areas]);
  // Match against the full config so a page reached through a wider route guard still lights
  // up its area, then use the viewer's (filtered) copy of that area.
  const activeArea = useMemo(() => {
    const id = findAreaByPath(pathname, NAV_AREAS)?.id;
    return id ? areas.find((a) => a.id === id) : undefined;
  }, [pathname, areas]);
  return { areas, sections, activeArea, pathname };
};

/** Breadcrumbs for the current URL, from the full config (the route guard decides access). */
export const useBreadcrumbs = () => {
  const { pathname } = useLocation();
  return useMemo(() => breadcrumbsFor(pathname, NAV_AREAS), [pathname]);
};
