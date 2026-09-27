/** Quantity and UOM display helpers for the goods-dispatch screens. */

export const formatUOM = (code: string | null | undefined) => {
  if (!code) return "PCS";
  const upper = code.toUpperCase();
  return upper === "EA" || upper === "EACH" ? "PCS" : upper;
};

export const fmtQty = (v: unknown) => Number(v || 0).toLocaleString("en-IN");
