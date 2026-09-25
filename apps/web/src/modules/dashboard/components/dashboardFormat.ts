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
