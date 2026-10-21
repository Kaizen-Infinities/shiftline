import { describe, expect, it } from "vitest";

import {
  BOM_QTY_HEADER,
  bomPayloadRows,
  bomPercentTotalError,
  bomRowError,
  bomRowUom,
  isPercentRecipe,
} from "./productBom";

/**
 * H03: the BOM had one hard-coded "(kg)" header, two inputs per row, and a grade rate that was
 * always required. A counted box (base UOM "Nos") was then consumed as if it were a length.
 */
describe("product BOM rows (H03)", () => {
  const qtyRows = [
    { rawMaterialId: "10", percentage: "", requiredQuantity: "0.5" },
    { rawMaterialId: "11", percentage: "", requiredQuantity: "1" },
  ];

  it("uses a neutral header; the unit comes from each raw material, not the header", () => {
    expect(BOM_QTY_HEADER).toBe("Qty per piece");
    expect(BOM_QTY_HEADER).not.toMatch(/kg/i);
    const materials = [
      { rawMaterialId: 10, baseUom: "kg" },
      { rawMaterialId: "11", baseUom: "Nos" },
    ];
    expect(bomRowUom("10", materials)).toBe("kg");
    expect(bomRowUom("11", materials)).toBe("Nos");
    expect(bomRowUom("99", materials)).toBe("");
  });

  it("is a quantity recipe unless a row carries a percentage", () => {
    expect(isPercentRecipe(qtyRows)).toBe(false);
    expect(
      isPercentRecipe([{ rawMaterialId: "10", percentage: "60", requiredQuantity: "0" }])
    ).toBe(true);
  });

  it("requires a quantity on every row of a quantity recipe", () => {
    expect(bomRowError(qtyRows[0], false)).toBeUndefined();
    expect(
      bomRowError({ rawMaterialId: "10", percentage: "50", requiredQuantity: "" }, false)
    ).toBe("Enter quantity");
  });

  it("requires a percentage on every row of a percentage recipe", () => {
    expect(
      bomRowError({ rawMaterialId: "10", percentage: "60", requiredQuantity: "" }, true)
    ).toBeUndefined();
    expect(bomRowError({ rawMaterialId: "10", percentage: "", requiredQuantity: "2" }, true)).toBe(
      "Enter %"
    );
  });

  it("checks percentages total 100 only for percentage recipes", () => {
    const pct = [
      { rawMaterialId: "10", percentage: "60", requiredQuantity: "" },
      { rawMaterialId: "11", percentage: "30", requiredQuantity: "" },
    ];
    expect(bomPercentTotalError(pct)).toBe("Total percentage must be exactly 100%");
    expect(
      bomPercentTotalError([
        ...pct.slice(0, 1),
        { rawMaterialId: "11", percentage: "40", requiredQuantity: "" },
      ])
    ).toBeUndefined();
    expect(bomPercentTotalError(qtyRows)).toBeUndefined();
  });

  it("sends quantities only for a quantity recipe and never a stray percentage", () => {
    expect(bomPayloadRows(qtyRows, false)).toEqual([
      { rawMaterialId: "10", percentage: "", requiredQuantity: 0.5 },
      { rawMaterialId: "11", percentage: "", requiredQuantity: 1 },
    ]);
  });

  it("sends percentages alongside quantities only when the owner chose a percentage recipe", () => {
    const mixed = [{ rawMaterialId: "10", percentage: "100", requiredQuantity: "2" }];
    expect(bomPayloadRows(mixed, true)).toEqual([
      { rawMaterialId: "10", percentage: "100", requiredQuantity: 2 },
    ]);
  });
});
