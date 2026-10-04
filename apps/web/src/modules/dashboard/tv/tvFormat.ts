/* Formatting helpers shared by the TV scenes.
   Mirrors the compact Indian notation the backend already emits, so
   values sourced from either endpoint render identically. */

export const inrCompact = (v: number | null | undefined): string => {
  const n = Number(v || 0);
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
  return `${sign}₹${a.toFixed(0)}`;
};

export const minutesLabel = (m: number): string => {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
};
