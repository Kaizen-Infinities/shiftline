import { describe, expect, it } from "vitest";

import { hasGreyedComponents, isSelectableComponent } from "./componentPicker";

/**
 * H40 (E2E-B13): production items were greyed out in the kit picker with no explanation at the
 * field, so a kit could not be built and the cause was not visible. The form now explains the
 * greyed items whenever there are some.
 */
describe("sales product component picker", () => {
  it("selects only Sales Production items", () => {
    expect(isSelectableComponent({ productType: "SALES_PRODUCTION" })).toBe(true);
    expect(isSelectableComponent({ productType: "PRODUCTION" })).toBe(false);
  });

  it("reports greyed items when an active production item is listed", () => {
    expect(
      hasGreyedComponents([
        { productType: "SALES_PRODUCTION", isActive: true },
        { productType: "PRODUCTION", isActive: true },
      ])
    ).toBe(true);
  });

  it("reports nothing greyed when every active item is a sales product", () => {
    expect(
      hasGreyedComponents([
        { productType: "SALES_PRODUCTION", isActive: true },
        { productType: "PRODUCTION", isActive: false },
      ])
    ).toBe(false);
  });
});
