import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { usePermission } from "../hooks/usePermission";
import { useT } from "../i18n/I18nProvider";
import { localizeAreas, localizeSections } from "../i18n/navI18n";
import { NAV_AREAS, NAV_SECTIONS } from "./nav.config";
import type { NavArea, NavViewer } from "./nav.types";
import {
  DETAIL_WORDS,
  breadcrumbsFor,
  filterAreas,
  findAreaByPath,
  sidebarSections,
} from "./nav.utils";

/** The signed-in viewer in the shape the nav helpers expect (same rules as ProtectedRoute). */
export const useNavViewer = (): NavViewer => {
  const { can, isSuperAdmin } = usePermission();
  return useMemo(() => ({ can, isSuperAdmin }), [can, isSuperAdmin]);
};

/** The full nav config with titles in the viewer's language (TN-04); ids and paths unchanged. */
export const useLocalizedNav = () => {
  const { locale, tDynamic } = useT();
  return useMemo(() => {
    if (locale === "en") return { areas: NAV_AREAS, sections: NAV_SECTIONS, words: DETAIL_WORDS };
    const words = Object.fromEntries(
      Object.entries(DETAIL_WORDS).map(([segment, label]) => [
        segment,
        tDynamic(`nav.crumb.${segment}`, label),
      ])
    );
    return {
      areas: localizeAreas(NAV_AREAS, tDynamic),
      sections: localizeSections(NAV_SECTIONS, tDynamic),
      words,
    };
  }, [locale, tDynamic]);
};

/** Areas, groups and screens the signed-in user may open. */
export const useVisibleAreas = (): NavArea[] => {
  const viewer = useNavViewer();
  const { areas } = useLocalizedNav();
  return useMemo(() => filterAreas(viewer, areas), [viewer, areas]);
};

/** The visible areas grouped for the sidebar, plus the active area for the current URL. */
export const useSidebarNav = () => {
  const areas = useVisibleAreas();
  const { sections: localizedSections } = useLocalizedNav();
  const { pathname } = useLocation();
  const sections = useMemo(
    () => sidebarSections(areas, localizedSections),
    [areas, localizedSections]
  );
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
  const { areas, words } = useLocalizedNav();
  return useMemo(() => breadcrumbsFor(pathname, areas, words), [pathname, areas, words]);
};
