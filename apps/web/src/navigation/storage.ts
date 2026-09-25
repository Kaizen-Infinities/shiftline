/**
 * Per-viewer conveniences kept in localStorage: the collapsed sidebar, recent palette items
 * and which areas a person opens most. Storage can be missing or throw (private windows,
 * blocked site data), so every read and write is guarded and the UI works without it.
 */

export const STORAGE_KEYS = {
  sidebarCollapsed: "shiftline-sidebar-collapsed",
  paletteRecent: "shiftline-palette-recent",
  areaVisits: "shiftline-area-visits",
} as const;

export const readJSON = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

export const writeJSON = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the preference simply is not remembered */
  }
};

const RECENT_LIMIT = 6;

export const readRecent = (): string[] => {
  const value = readJSON<unknown>(STORAGE_KEYS.paletteRecent, []);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
};

export const pushRecent = (id: string): string[] => {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
  writeJSON(STORAGE_KEYS.paletteRecent, next);
  return next;
};

export const recordAreaVisit = (areaId: string): void => {
  const visits = readJSON<Record<string, number>>(STORAGE_KEYS.areaVisits, {});
  const safe = visits && typeof visits === "object" ? visits : {};
  writeJSON(STORAGE_KEYS.areaVisits, { ...safe, [areaId]: (Number(safe[areaId]) || 0) + 1 });
};

/** The area id opened most often among `candidates`, or the first candidate. */
export const mostUsedArea = (candidates: string[]): string | undefined => {
  const visits = readJSON<Record<string, number>>(STORAGE_KEYS.areaVisits, {});
  let best: string | undefined = candidates[0];
  let bestCount = 0;
  for (const id of candidates) {
    const count = Number(visits?.[id]) || 0;
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
};
