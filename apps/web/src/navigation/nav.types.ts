import type { LucideIcon } from "lucide-react";

/**
 * Types for the information architecture (docs/specs/UI-v2.md, "Shell and information
 * architecture"). One config file (`nav.config.ts`) describes every area, group and screen;
 * the sidebar, area hubs, command palette and breadcrumbs all read from it.
 */

export type NavIcon = LucideIcon;

/** Who may see an entry. Mirrors the legacy sidebar and `ProtectedRoute` props exactly. */
export interface NavAccess {
  /** The user must hold this permission (and the plan must include its feature). */
  permission?: string;
  /** The user must hold at least one of these. */
  permissionAny?: string[];
  /** Platform console entries: super admins only. */
  superAdminOnly?: boolean;
}

/** A "create" flow that belongs to a screen, such as "New sales invoice". */
export interface NavAction extends NavAccess {
  title: string;
  path: string;
  keywords?: string[];
  /** Legacy keyboard shortcut shown next to the entry, e.g. "Ctrl+1". */
  badge?: string;
}

export interface NavScreen extends NavAccess {
  /** Stable id, `<area>.<screen>`; used for recent items. */
  id: string;
  title: string;
  path: string;
  icon: NavIcon;
  /** One line for the hub tile. */
  description: string;
  /** Extra words the command palette matches ("GRN", "credit note", "ITC-04"). */
  keywords?: string[];
  actions?: NavAction[];
  /**
   * Path roots outside `path` that still belong to this screen (detail and edit pages that
   * live under another prefix, e.g. `/draft-order/edit/:id` for sales orders).
   */
  matchPaths?: string[];
  badge?: string;
}

export interface NavGroup {
  id: string;
  title: string;
  screens: NavScreen[];
}

/** A primary action or chip on an area hub. Paths must exist in the config. */
export interface HubLink extends NavAccess {
  label: string;
  path: string;
}

export type SectionId = "home" | "operate" | "money" | "people" | "admin";

export interface NavSection {
  id: SectionId;
  title: string;
}

export interface NavArea extends NavAccess {
  /** Slug used by `/hub/:area`. */
  id: string;
  title: string;
  section: SectionId;
  icon: NavIcon;
  /** One line under the hub title. */
  description: string;
  /** Where the sidebar row goes; defaults to the area hub. */
  home?: string;
  keywords?: string[];
  groups: NavGroup[];
  hub?: {
    /** One to three green `.sl-cta` actions. */
    ctas?: HubLink[];
    /** Pale-blue `.sl-chip` shortcuts under the actions. */
    chips?: HubLink[];
  };
  /** Kept out of the sidebar; still searchable and used for breadcrumbs. */
  hidden?: boolean;
}

/** What `canSee` needs to know about the signed-in user. */
export interface NavViewer {
  can: (permission: string) => boolean;
  isSuperAdmin: boolean;
}

export interface Crumb {
  label: string;
  path?: string;
}
