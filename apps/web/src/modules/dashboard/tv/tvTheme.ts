/* ══════════════════════════════════════════════════════════════════
   MANAGEMENT TV DASHBOARD — THEME (UI v2)
   ------------------------------------------------------------------
   The wall display wears the product's own tokens (docs/specs/UI-v2.md):
   every colour below is a CSS variable, so the same references resolve to
   the airy light theme or the deep-navy dark theme. TvDashboard sets the
   document's data-theme to the wall's own light/dark choice while it is
   mounted and puts the app's theme back when it leaves.
   ══════════════════════════════════════════════════════════════════ */

export interface TvPalette {
  bg: string;
  panel: string;
  panelBorder: string;
  panelShadow: string;
  tile: string;
  track: string;
  text: string;
  textDim: string;
  textMute: string;
  badgeBg: string;
  badgeText: string;
  dotInactive: string;
  headerBorder: string;
}

export interface TvAccents {
  green: string;
  amber: string;
  red: string;
  blue: string;
  accentBg: string;
  accentText: string;
  critTint: string;
  lowTint: string;
  okTint: string;
}

const PALETTE: TvPalette = {
  bg: "var(--color-page)",
  panel: "var(--color-card)",
  panelBorder: "var(--color-line-soft)",
  panelShadow: "var(--shadow-sm)",
  tile: "var(--color-card-2)",
  track: "var(--color-line-soft)",
  text: "var(--color-ink)",
  textDim: "var(--color-ink-muted)",
  textMute: "var(--color-ink-subtle)",
  badgeBg: "var(--color-chip)",
  badgeText: "var(--color-chip-fg)",
  dotInactive: "var(--color-line)",
  headerBorder: "var(--color-line-soft)",
};

const ACCENTS: TvAccents = {
  green: "var(--color-success)",
  amber: "var(--color-warning)",
  red: "var(--color-danger)",
  blue: "var(--color-primary)",
  accentBg: "var(--color-primary)",
  accentText: "var(--color-white)",
  critTint: "color-mix(in srgb, var(--color-danger) 14%, var(--color-card))",
  lowTint: "color-mix(in srgb, var(--color-warning) 16%, var(--color-card))",
  okTint: "color-mix(in srgb, var(--color-success) 14%, var(--color-card))",
};

export type TvMode = "dark" | "light";

export const getTvTheme = (mode: TvMode) => ({
  T: PALETTE,
  A: ACCENTS,
  isDark: mode === "dark",
});

export type TvTheme = ReturnType<typeof getTvTheme>;

/* ── Fluid unit ───────────────────────────────────────────────────
   Every measurement in the design was authored against a 1920×1080
   board. `u(n)` converts one of those pixel values into a length that
   scales with the display, so the same layout holds on a 4K wall panel,
   a 32:9 ultrawide, or a portrait screen without ever overflowing.
   ------------------------------------------------------------------ */
export const u = (n: number) => `calc(${n} * var(--tv-u))`;

/** Ring/donut background used for the circular percentage gauges. */
export const ring = (pct: number, color: string, track: string) =>
  `conic-gradient(${color} 0% ${pct}%, ${track} ${pct}% 100%)`;

/** Threshold colouring shared by production lines and achievement gauges. */
export const pctColor = (pct: number, A: TvAccents) =>
  pct >= 85 ? A.green : pct >= 75 ? A.amber : A.red;

/** Signed trend rendered as an arrow + magnitude, e.g. "↑ 12%". */
export const trendText = (pct: number | null | undefined) => {
  if (pct == null || !isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  if (rounded === 0) return "→ 0%";
  return `${rounded > 0 ? "↑" : "↓"} ${Math.abs(rounded)}%`;
};

/** Green for a rise, red for a fall, blue for flat/unknown. */
export const trendColor = (pct: number | null | undefined, A: TvAccents, invert = false) => {
  if (pct == null || !isFinite(pct) || Math.round(pct) === 0) return A.blue;
  const good = invert ? pct < 0 : pct > 0;
  return good ? A.green : A.red;
};
