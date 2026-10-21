import { describe, expect, it } from "vitest";
import { getUomMultiplier } from "../../src/modules/grn-invoice/uom-multiplier";

/**
 * H10 (INV-B11): an unknown unit pair fell back to a multiplier of 1, so 2 MT received into a
 * kg item added 2 kg (a 1000x error). Known pairs convert; anything else is refused.
 */
describe("getUomMultiplier", () => {
  it("keeps the existing conversions", () => {
    expect(getUomMultiplier("g", "kg")).toBe(0.001);
    expect(getUomMultiplier("kg", "g")).toBe(1000);
    expect(getUomMultiplier("ml", "l")).toBe(0.001);
    expect(getUomMultiplier("cm", "m")).toBe(0.01);
    expect(getUomMultiplier("mm", "m")).toBe(0.001);
    expect(getUomMultiplier("kg", "kg")).toBe(1);
    expect(getUomMultiplier("", "kg")).toBe(1);
  });

  it("converts metric tonnes and dozens", () => {
    expect(getUomMultiplier("mt", "kg")).toBe(1000);
    expect(getUomMultiplier("kg", "mt")).toBe(0.001);
    expect(getUomMultiplier("dz", "ea")).toBe(12);
    expect(getUomMultiplier("ea", "dz")).toBeCloseTo(1 / 12, 12);
  });

  it("treats the count names as one unit", () => {
    expect(getUomMultiplier("pcs", "ea")).toBe(1);
    expect(getUomMultiplier("Nos", "ea")).toBe(1);
  });

  it("uses the primary unit of a multi-unit base list", () => {
    expect(getUomMultiplier("mt", "kg,g")).toBe(1000);
  });

  it("uses the family base when the material has no base unit", () => {
    expect(getUomMultiplier("g", "")).toBe(0.001);
    expect(getUomMultiplier("mt", "")).toBe(1000);
  });

  it("refuses a unit from another family", () => {
    expect(() => getUomMultiplier("ea", "kg")).toThrow(/No unit conversion from ea to kg/);
    expect(() => getUomMultiplier("l", "kg")).toThrow(/No unit conversion/);
  });

  it("refuses a unit it does not know", () => {
    expect(() => getUomMultiplier("bag", "kg")).toThrow(/No unit conversion from bag to kg/);
  });
});
