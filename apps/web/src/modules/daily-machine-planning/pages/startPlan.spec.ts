import { describe, expect, it } from "vitest";

import { hasMaterialsToIssue, isStartBlocked } from "./startPlan";

/** H37: Start Production on an order without raw materials opened an empty modal. */
describe("start production gate (H37)", () => {
  it("has nothing to issue when the order carries no raw materials", () => {
    expect(hasMaterialsToIssue({ draftRawMaterials: null })).toBe(false);
    expect(hasMaterialsToIssue({ draftRawMaterials: [] })).toBe(false);
    expect(hasMaterialsToIssue({})).toBe(false);
    expect(hasMaterialsToIssue(undefined)).toBe(false);
  });

  it("has materials to issue when the order or its BOM lists any", () => {
    expect(hasMaterialsToIssue({ draftRawMaterials: [{ rawMaterialId: "10" }] })).toBe(true);
    expect(hasMaterialsToIssue({ rawMaterials: [{ rawMaterialId: "10" }] })).toBe(true);
  });

  it("blocks starting a planned plan with no materials, and nothing else", () => {
    const empty = { draftRawMaterials: [] };
    expect(isStartBlocked({ status: "PLANNED" }, empty)).toBe(true);
    expect(
      isStartBlocked({ status: "PLANNED" }, { draftRawMaterials: [{ rawMaterialId: "1" }] })
    ).toBe(false);
    expect(isStartBlocked({ status: "IN_PROGRESS" }, empty)).toBe(false);
  });
});
