import { describe, expect, it } from "vitest";
import { createStockAdjustmentSchema } from "../../src/modules/stock-adjustment/stock-adjustment.validation";

/**
 * R2P-B15: a zero-difference stock adjustment could be created and approved, posting nothing
 * but still a document. An item must change the quantity.
 */
const body = (difference: number) => ({
  body: {
    adjustmentNumber: "ADJ-1",
    adjustmentDate: "2026-10-01",
    items: [
      {
        itemType: "RAW_MATERIAL",
        rawMaterialId: "RM-1",
        storeId: "ST-RM",
        currentQty: 5,
        adjustedQty: 5 + difference,
        difference,
      },
    ],
  },
});

describe("createStockAdjustmentSchema", () => {
  it("accepts an item that changes the quantity", () => {
    expect(createStockAdjustmentSchema.safeParse(body(2)).success).toBe(true);
    expect(createStockAdjustmentSchema.safeParse(body(-5)).success).toBe(true);
  });

  it("rejects an item with no difference", () => {
    const result = createStockAdjustmentSchema.safeParse(body(0));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues ?? [])).toContain("must differ");
  });
});
