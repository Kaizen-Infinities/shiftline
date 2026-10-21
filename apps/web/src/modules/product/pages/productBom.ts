/**
 * Bill-of-materials row rules for the product form.
 *
 * A BOM row is either a quantity recipe ("qty of this material per piece", in the material's own
 * base UOM) or a percentage recipe (share of the piece, must total 100). Production consumes
 * `requiredQuantity * quantity`, so quantity is the default; the percentage column only appears
 * when the owner opts into a percentage recipe (or the product already has one).
 */

export type BomRow = { rawMaterialId: string; percentage: string; requiredQuantity: string };

/** A product is on a percentage recipe when any saved row carries a percentage. */
export const isPercentRecipe = (rows: BomRow[]): boolean =>
  rows.some((row) => String(row.percentage ?? "").trim() !== "");

/** Row-level rule: a quantity recipe needs a quantity, a percentage recipe needs a percentage. */
export const bomRowError = (row: BomRow, percentMode: boolean): string | undefined => {
  if (percentMode) {
    return Number(row.percentage || 0) > 0 ? undefined : "Enter %";
  }
  return Number(row.requiredQuantity || 0) > 0 ? undefined : "Enter quantity";
};

/** Percentage recipes must total exactly 100 (mirrors the API rule). */
export const bomPercentTotalError = (rows: BomRow[]): string | undefined => {
  const withPercent = rows.filter((row) => String(row.percentage ?? "").trim() !== "");
  if (withPercent.length === 0) return undefined;
  const total = withPercent.reduce((sum, row) => sum + Number(row.percentage), 0);
  return Math.abs(total - 100) > 0.01 ? "Total percentage must be exactly 100%" : undefined;
};

/** Rows as sent to the API. Percentages are only sent when the owner chose a percentage recipe. */
export const bomPayloadRows = (rows: BomRow[], percentMode: boolean) =>
  rows.map((row) => ({
    rawMaterialId: row.rawMaterialId,
    percentage: percentMode ? row.percentage : "",
    requiredQuantity: Number(row.requiredQuantity) || 0,
  }));

/** Column header for the quantity input: the unit is shown per row, not in the header. */
export const BOM_QTY_HEADER = "Qty per piece";

/** Unit label for a quantity row, taken from the raw material's base UOM. */
export const bomRowUom = (
  rawMaterialId: string,
  materials: Array<{ rawMaterialId: unknown; baseUom?: string | null }>
): string => {
  const match = materials.find((rm) => String(rm.rawMaterialId) === String(rawMaterialId));
  return match?.baseUom ?? "";
};
