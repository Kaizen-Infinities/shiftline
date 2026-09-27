/**
 * Display formatting shared by the inventory screens (stock, products, raw materials,
 * wastage, dispatch, reports). Presentation only: never feed these strings back into maths.
 */

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Rupees in en-IN grouping: ₹12,34,567.5. Returns "—" for empty values. */
export const inr = (value: unknown, maxDecimals = 2, minDecimals = 0): string => {
  const n = toNumber(value);
  if (n === null) return "—";
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  })}`;
};

/** Quantities in en-IN grouping with up to three decimals: 1,20,000.5. */
export const qty = (value: unknown, maxDecimals = 3): string => {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: maxDecimals });
};

/** Short date in en-IN: 24 Sep 2026. */
export const shortDate = (value: unknown): string => {
  if (!value) return "—";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
