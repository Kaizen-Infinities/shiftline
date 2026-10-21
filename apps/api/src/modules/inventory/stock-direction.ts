/**
 * Direction of a stock transaction, from its txnType. Known types are listed explicitly so a
 * name such as PURCHASE_RETURN_OUT (a goods return to a supplier) cannot read as an inflow
 * because it contains "RETURN". Unknown types fall back to the word patterns, outbound first.
 */
const KNOWN_STOCK_SIGN: Record<string, 1 | -1> = {
  OPENING_STOCK: 1,
  RECEIPT: 1,
  PRODUCTION_RECEIPT: 1,
  WASTAGE_RECEIPT: 1,
  RETURN: 1,
  STOCK_ADJUSTMENT_IN: 1,
  MATERIAL_ISSUE: -1,
  RAW_MATERIAL_ISSUE: -1,
  PURCHASE_RETURN_OUT: -1,
  STOCK_ADJUSTMENT_OUT: -1,
};

/** Signed change to stock for one transaction: +qty in, -qty out, 0 when the direction is unknown. */
export function stockDelta(txnType: string, qty: number): number {
  const typ = (txnType || "").toUpperCase();
  const known = KNOWN_STOCK_SIGN[typ];
  if (known !== undefined) return known * qty;

  const isOut =
    typ.includes("OUT") ||
    typ.includes("ISSUE") ||
    typ.includes("CONSUMPTION") ||
    typ.includes("DISPATCH");
  if (isOut) return -qty;

  const isIn =
    typ.includes("IN") ||
    typ.includes("RECEIPT") ||
    typ.includes("OPENING") ||
    typ.includes("RETURN");
  return isIn ? qty : 0;
}
