/* Formatting helpers shared by the dashboard widgets. */

/** Rupees without paise, Indian grouping. */
export const inr = (n: number | string | null | undefined) =>
  `₹${Math.abs(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** "1 account", "2 accounts". */
export const plural = (n: number | null | undefined, one: string, many = `${one}s`) =>
  `${Number(n) || 0} ${Number(n) === 1 ? one : many}`;

/** Status → chip tone used by order and plan rows. */
export const statusChipClass = (status: string) => {
  const s = status.toUpperCase();
  if (["COMPLETED", "INVOICED", "DELIVERED", "APPROVED", "PAID", "DONE"].includes(s))
    return "sl-chip-success";
  if (["CANCELLED", "REJECTED", "OVERDUE", "BREAKDOWN"].includes(s)) return "sl-chip-danger";
  if (["DRAFT", "PENDING", "PARTIAL", "ON_HOLD"].includes(s)) return "sl-chip-warning";
  return "sl-chip-muted";
};

/**
 * Voucher type → the tone of its domain: money in reads as sales (chart
 * series 1), money out as purchase (series 2); contra and journal stay grey.
 */
export const voucherTypeTone = (type: string) => {
  const t = String(type).toUpperCase();
  if (t === "SALES" || t === "RECEIPT") return "sl-tone-sales";
  if (t === "PURCHASE" || t === "PAYMENT") return "sl-tone-purchase";
  return "sl-chip-muted";
};

/**
 * OEE-style percentage → status colour token. One scale for every
 * production screen: world-class at 85% and up, watch from 60%, act below.
 */
export const oeeTone = (value: number | null | undefined) =>
  value == null
    ? "var(--color-ink-subtle)"
    : value >= 85
      ? "var(--color-success)"
      : value >= 60
        ? "var(--color-warning)"
        : "var(--color-danger)";

/** The same scale as a chip class, for labels that carry the percentage. */
export const oeeChipClass = (value: number | null | undefined) =>
  value == null
    ? "sl-chip-muted"
    : value >= 85
      ? "sl-chip-success"
      : value >= 60
        ? "sl-chip-warning"
        : "sl-chip-danger";

/**
 * Colour of an icon square. Domain tones match that domain's chart series
 * (sales = series 1, purchase = 2, cash = 3, production = 4); status tones
 * reuse the status chips. "accent" is the plain pale-blue default.
 */
export type TileTone =
  | "accent"
  | "sales"
  | "purchase"
  | "cash"
  | "production"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export const toneClass = (tone: TileTone = "accent") =>
  tone === "accent"
    ? "bg-chip text-accent"
    : ["success", "warning", "danger", "muted"].includes(tone)
      ? `sl-chip-${tone}`
      : `sl-tone-${tone}`;
