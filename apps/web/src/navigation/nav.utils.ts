import { NAV_AREAS, NAV_SECTIONS } from "./nav.config";
import type {
  Crumb,
  HubLink,
  NavAccess,
  NavAction,
  NavArea,
  NavScreen,
  NavSection,
  NavViewer,
} from "./nav.types";

/**
 * Pure helpers over the navigation config: permission filtering, path lookup and
 * breadcrumbs. No React here, so the unit tests and any non-React code can use them.
 */

/** The legacy sidebar's rule, unchanged: super-admin flag, single permission, then "any of". */
export const canSee = (entry: NavAccess, viewer: NavViewer): boolean => {
  if (entry.superAdminOnly && !viewer.isSuperAdmin) return false;
  if (entry.permission && !viewer.can(entry.permission)) return false;
  if (entry.permissionAny && entry.permissionAny.length > 0) {
    if (!entry.permissionAny.some((p) => viewer.can(p))) return false;
  }
  return true;
};

/**
 * The areas the viewer may open, with only the groups, screens and actions they may see.
 * An area without a single visible screen disappears.
 */
export const filterAreas = (viewer: NavViewer, areas: NavArea[] = NAV_AREAS): NavArea[] =>
  areas
    .filter((area) => canSee(area, viewer))
    .map((area) => {
      const inherited = { superAdminOnly: area.superAdminOnly };
      const groups = area.groups
        .map((group) => ({
          ...group,
          screens: group.screens
            .filter((s) => canSee(s, viewer) && canSee(inherited, viewer))
            .map((s) => ({ ...s, actions: s.actions?.filter((a) => canSee(a, viewer)) })),
        }))
        .filter((group) => group.screens.length > 0);
      const hub = area.hub && {
        ctas: area.hub.ctas?.filter((l) => canSee(l, viewer)),
        chips: area.hub.chips?.filter((l) => canSee(l, viewer)),
      };
      return { ...area, groups, hub };
    })
    .filter((area) => area.groups.length > 0);

/** Areas that belong in the sidebar, grouped under their section labels. */
export const sidebarSections = (
  areas: NavArea[],
  sections: NavSection[] = NAV_SECTIONS
): { section: NavSection; areas: NavArea[] }[] =>
  sections
    .map((section) => ({
      section,
      areas: areas.filter((a) => a.section === section.id && !a.hidden),
    }))
    .filter((s) => s.areas.length > 0);

export const screensOf = (area: NavArea): NavScreen[] => area.groups.flatMap((g) => g.screens);

export const allScreens = (areas: NavArea[] = NAV_AREAS): NavScreen[] => areas.flatMap(screensOf);

/** Where the sidebar row for an area goes. */
export const areaHome = (area: NavArea): string => area.home ?? `/hub/${area.id}`;

/** Drops the query string and a trailing slash so `/roles?action=add` compares as `/roles`. */
export const cleanPath = (path: string): string => {
  const bare = path.split("?")[0].split("#")[0];
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
};

/** True when `path` is `root` or sits below it at a segment boundary. */
export const isUnder = (path: string, root: string): boolean => {
  const p = cleanPath(path);
  const r = cleanPath(root);
  return p === r || p.startsWith(`${r}/`);
};

export interface PathMatch {
  area: NavArea;
  screen: NavScreen;
  /** Set when the path is one of the screen's "create" flows. */
  action?: NavAction;
  /** True when the path is exactly the screen (or action) path. */
  exact: boolean;
}

/**
 * The screen a URL belongs to. Exact screen and action paths win; otherwise the screen
 * whose path (or one of its `matchPaths`) is the longest segment-aligned prefix, so
 * `/sales-invoices/details/42` belongs to Sales invoices and `/machines/assignments/edit/7`
 * to Machine assignments rather than Machines.
 */
export const matchPath = (pathname: string, areas: NavArea[] = NAV_AREAS): PathMatch | null => {
  const path = cleanPath(pathname);
  let best: { area: NavArea; screen: NavScreen; length: number } | null = null;

  for (const area of areas) {
    for (const screen of screensOf(area)) {
      if (cleanPath(screen.path) === path) return { area, screen, exact: true };
      for (const action of screen.actions ?? []) {
        // `/roles?action=add` would otherwise claim the Roles list itself.
        if (action.path.includes("?")) continue;
        if (cleanPath(action.path) === path) return { area, screen, action, exact: true };
      }
      for (const root of [screen.path, ...(screen.matchPaths ?? [])]) {
        if (isUnder(path, root)) {
          const length = cleanPath(root).length;
          if (!best || length > best.length) best = { area, screen, length };
        }
      }
    }
  }
  return best ? { area: best.area, screen: best.screen, exact: false } : null;
};

/** The area a URL belongs to: `/hub/<id>`, `/` (the dashboard) or any screen inside it. */
export const findAreaByPath = (
  pathname: string,
  areas: NavArea[] = NAV_AREAS
): NavArea | undefined => {
  const path = cleanPath(pathname);
  const hub = /^\/hub\/([^/]+)$/.exec(path);
  if (hub) return areas.find((a) => a.id === hub[1]);
  if (path === "/") return areas.find((a) => a.id === "dashboard");
  return matchPath(path, areas)?.area;
};

/** Human label for the last segment of a detail URL ("edit", "view", "create"). */
const detailLabel = (path: string, root: string): string | null => {
  const rest = cleanPath(path).slice(cleanPath(root).length).split("/").filter(Boolean);
  if (rest.length === 0) return null;
  const words: Record<string, string> = {
    create: "New",
    add: "New",
    edit: "Edit",
    view: "Details",
    details: "Details",
    detail: "Details",
    history: "History",
    report: "Report",
    "gate-approval": "Gate approval",
    "store-approval": "Store approval",
    "material-prices": "Material prices",
  };
  for (const segment of rest) {
    if (words[segment]) return words[segment];
  }
  return "Details";
};

/**
 * Breadcrumbs for a URL: the area (linking to its hub), the screen, and a last crumb for
 * create/edit/detail pages. The dashboard is a single crumb.
 */
export const breadcrumbsFor = (pathname: string, areas: NavArea[] = NAV_AREAS): Crumb[] => {
  const path = cleanPath(pathname);
  const hub = /^\/hub\/([^/]+)$/.exec(path);
  if (hub) {
    const area = areas.find((a) => a.id === hub[1]);
    return area ? [{ label: area.title }] : [];
  }
  const match = path === "/" ? matchPath("/dashboard", areas) : matchPath(path, areas);
  if (!match) return [];
  const { area, screen, action, exact } = match;
  const areaCrumb: Crumb = { label: area.title, path: area.hidden ? undefined : areaHome(area) };
  // An area with a single screen of the same name (Dashboard) needs one crumb.
  const single = screensOf(area).length === 1 && screen.title === area.title;
  const crumbs: Crumb[] = single ? [] : [areaCrumb];

  if (action) {
    crumbs.push({ label: screen.title, path: screen.path }, { label: action.title });
    return crumbs;
  }
  if (exact) {
    crumbs.push({ label: screen.title });
    return crumbs;
  }
  const root = [screen.path, ...(screen.matchPaths ?? [])].find((r) => isUnder(path, r));
  crumbs.push({ label: screen.title, path: screen.path });
  const last = root ? detailLabel(path, root) : null;
  if (last) crumbs.push({ label: last });
  return crumbs;
};

/** Every path the config links to: screens and their create flows. */
export const allNavPaths = (areas: NavArea[] = NAV_AREAS): string[] =>
  allScreens(areas).flatMap((s) => [s.path, ...(s.actions ?? []).map((a) => a.path)]);

/** Hub CTAs and chips, for integrity checks. */
export const allHubLinks = (areas: NavArea[] = NAV_AREAS): HubLink[] =>
  areas.flatMap((a) => [...(a.hub?.ctas ?? []), ...(a.hub?.chips ?? [])]);
