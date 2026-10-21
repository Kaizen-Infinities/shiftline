import { describe, expect, it } from "vitest";

import { wastageUomLabel } from "./wastageUom";

describe("wastage quantity unit (H36)", () => {
  it("shows the unit the log was recorded in, never a fixed kg", () => {
    expect(wastageUomLabel({ uom: "PCS" })).toBe("pcs");
    expect(wastageUomLabel({ uom: "kg" })).toBe("kg");
    expect(wastageUomLabel({ uom: "NOS" })).toBe("nos");
  });

  it("uses the first unit of a comma-separated UOM list", () => {
    expect(wastageUomLabel({ uom: "KG,G" })).toBe("kg");
  });

  it("returns nothing when the log has no unit", () => {
    expect(wastageUomLabel({ uom: null })).toBe("");
    expect(wastageUomLabel({})).toBe("");
  });
});
