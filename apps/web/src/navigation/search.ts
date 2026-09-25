import type { NavArea, NavIcon } from "./nav.types";
import { areaHome, cleanPath } from "./nav.utils";

/**
 * What the command palette searches: every screen and create flow the viewer may open, each
 * area hub, the hubs' primary actions ("Run Payroll") and a few shell commands.
 */

export type PaletteKind = "area" | "screen" | "action" | "command";

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  title: string;
  /** Where it lives, shown on the right and matched with a low weight ("Sales · Delivery"). */
  hint: string;
  keywords: string[];
  icon: NavIcon;
  path?: string;
  /** For `kind: "command"`: what the palette should do. */
  command?: string;
  badge?: string;
}

/** Builds the searchable items from already permission-filtered areas. */
export const buildPaletteItems = (areas: NavArea[]): PaletteItem[] => {
  const items: PaletteItem[] = [];
  const actionByPath = new Map<string, PaletteItem>();
  const screenByPath = new Map<string, PaletteItem>();

  for (const area of areas) {
    if (!area.hidden) {
      items.push({
        id: `area.${area.id}`,
        kind: "area",
        title: area.title,
        hint: "Area",
        keywords: [...(area.keywords ?? []), "hub"],
        icon: area.icon,
        path: areaHome(area),
      });
    }
    for (const group of area.groups) {
      for (const screen of group.screens) {
        const hint =
          group.title === area.title || area.groups.length === 1
            ? area.title
            : `${area.title} · ${group.title}`;
        const item: PaletteItem = {
          id: screen.id,
          kind: "screen",
          title: screen.title,
          hint,
          keywords: screen.keywords ?? [],
          icon: screen.icon,
          path: screen.path,
          badge: screen.badge,
        };
        items.push(item);
        screenByPath.set(cleanPath(screen.path), item);
        for (const action of screen.actions ?? []) {
          const actionItem: PaletteItem = {
            id: `action:${action.path}`,
            kind: "action",
            title: action.title,
            hint: area.title,
            keywords: [...(action.keywords ?? []), screen.title, "new", "add", "create"],
            icon: screen.icon,
            path: action.path,
            badge: action.badge,
          };
          items.push(actionItem);
          actionByPath.set(action.path, actionItem);
        }
      }
    }
  }

  // Hub actions become quick actions unless they repeat a create flow or a screen.
  for (const area of areas) {
    for (const cta of area.hub?.ctas ?? []) {
      const existingAction = actionByPath.get(cta.path);
      if (existingAction) {
        existingAction.keywords = [...existingAction.keywords, cta.label];
        continue;
      }
      const screen = screenByPath.get(cleanPath(cta.path));
      if (screen && screen.title.toLowerCase() === cta.label.toLowerCase()) continue;
      items.push({
        id: `cta:${area.id}:${cta.path}`,
        kind: "action",
        title: cta.label,
        hint: area.title,
        keywords: screen ? [screen.title, ...screen.keywords] : [],
        icon: screen?.icon ?? area.icon,
        path: cta.path,
      });
    }
  }

  return items;
};

// ── Fuzzy matching ─────────────────────────────────────────────────────────

export const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** 0 (no match) up to ~1.2 for how well one query token matches one field. */
const tokenScore = (token: string, text: string): number => {
  if (!token || !text) return 0;
  if (text === token) return 1.2;
  if (text.startsWith(token)) return 1;
  const words = text.split(" ");
  if (words.some((w) => w.startsWith(token))) return 0.85;
  const initials = words.map((w) => w[0]).join("");
  if (token.length >= 2 && initials.startsWith(token)) return 0.8;
  if (text.includes(token)) return 0.6;
  if (token.length < 2) return 0;
  // Characters in order ("gdisp" → "goods dispatch"), scored by how tightly they sit.
  const compact = text.replace(/ /g, "");
  let from = 0;
  let first = -1;
  for (const ch of token) {
    const at = compact.indexOf(ch, from);
    if (at === -1) return 0;
    if (first === -1) first = at;
    from = at + 1;
  }
  const span = from - first;
  // Letters scattered across a long title are noise, not a match.
  if (span > token.length * 2.5) return 0;
  return 0.4 * (token.length / span);
};

const WEIGHTS = { title: 3, keywords: 2, hint: 1 } as const;

/** Relevance of an item for a query; 0 means it does not match every word. */
export const scoreItem = (item: PaletteItem, query: string): number => {
  const q = normalise(query);
  if (!q) return 0;
  const title = normalise(item.title);
  const keywords = item.keywords.map(normalise);
  const hint = normalise(item.hint);
  let total = 0;
  for (const token of q.split(" ")) {
    const best = Math.max(
      tokenScore(token, title) * WEIGHTS.title,
      ...keywords.map((k) => tokenScore(token, k) * WEIGHTS.keywords),
      tokenScore(token, hint) * WEIGHTS.hint
    );
    if (best <= 0) return 0;
    total += best;
  }
  if (title.startsWith(q)) total += 2;
  if (title === q) total += 2;
  return total;
};

/** Items matching the query, best first. */
export const searchPalette = (items: PaletteItem[], query: string, limit = 40): PaletteItem[] =>
  items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length)
    .slice(0, limit)
    .map((r) => r.item);
