/**
 * Unit shown next to a wastage quantity: the unit the log was recorded in. A log for 3 pcs must
 * read "3 pcs", not "3 kg" (H36). Only a log with no unit at all falls back to nothing.
 */
export const wastageUomLabel = (item: { uom?: string | null }): string =>
  item.uom ? String(item.uom).split(",")[0].trim().toLowerCase() : "";
