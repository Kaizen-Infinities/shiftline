import { describe, expect, it } from "vitest";

import {
  STAGE_PLANS,
  billingTotals,
  canMoveStatus,
  costByType,
  lineAmount,
  marginBandFor,
  percentComplete,
  reorderSeqs,
  summariseJob,
} from "../../src/modules/project-jobs/project-jobs.calc";

describe("job costing calc (TN-09)", () => {
  it("offers the body-building plan from chassis inward to delivery", () => {
    expect(STAGE_PLANS.BODY_BUILDING.stages[0]).toBe("Chassis inward");
    expect(STAGE_PLANS.BODY_BUILDING.stages.at(-1)).toBe("Delivery");
    expect(STAGE_PLANS.BODY_BUILDING.stages).toHaveLength(7);
    expect(STAGE_PLANS.FABRICATION.stages).toHaveLength(7);
    expect(STAGE_PLANS.NONE.stages).toEqual([]);
  });

  it("rounds a line to the paisa (labour: hours x rate)", () => {
    expect(lineAmount(7.5, 180)).toBe(1350);
    expect(lineAmount(0.333, 10)).toBe(3.33);
    expect(lineAmount(3, 0.1)).toBe(0.3);
  });

  it("sums cost by type without float drift", () => {
    const byType = costByType([
      { type: "MATERIAL", amount: 0.1 },
      { type: "MATERIAL", amount: 0.2 },
      { type: "LABOUR", amount: 1350 },
      { type: "SUBCONTRACT", amount: 5000 },
    ]);
    expect(byType).toEqual({ MATERIAL: 0.3, LABOUR: 1350, SUBCONTRACT: 5000, OVERHEAD: 0 });
  });

  it("computes % complete from weighted stages, skipping SKIPPED and halving IN_PROGRESS", () => {
    expect(percentComplete([])).toBe(0);
    expect(
      percentComplete([
        { status: "DONE", weight: 1 },
        { status: "DONE", weight: 1 },
        { status: "PENDING", weight: 1 },
        { status: "PENDING", weight: 1 },
      ])
    ).toBe(50);
    expect(
      percentComplete([
        { status: "DONE", weight: 3 },
        { status: "IN_PROGRESS", weight: 2 },
        { status: "SKIPPED", weight: 5 },
        { status: "PENDING", weight: 1 },
      ])
    ).toBe(66.7);
    expect(percentComplete([{ status: "SKIPPED", weight: 1 }])).toBe(100);
  });

  it("totals billing and the advance balance", () => {
    const t = billingTotals([
      { kind: "ADVANCE", amount: 100000, advanceAdjusted: 0 },
      { kind: "ADVANCE", amount: 50000, advanceAdjusted: 0 },
      { kind: "STAGE_INVOICE", amount: 200000, advanceAdjusted: 120000 },
      { kind: "FINAL", amount: 150000, advanceAdjusted: 10000 },
    ]);
    expect(t).toEqual({
      advancesReceived: 150000,
      billed: 350000,
      advanceAdjusted: 130000,
      advanceBalance: 20000,
    });
  });

  it("summarises margin vs quote, billed vs cost and what is left to bill", () => {
    const s = summariseJob({
      quoted: 500000,
      costs: [
        { type: "MATERIAL", amount: 250000, status: "POSTED" },
        { type: "LABOUR", amount: 60000, status: "POSTED" },
        { type: "OVERHEAD", amount: 15000, status: "DRAFT" },
      ],
      stages: [
        { status: "DONE", weight: 1 },
        { status: "PENDING", weight: 1 },
      ],
      billings: [
        { kind: "ADVANCE", amount: 100000, advanceAdjusted: 0 },
        { kind: "STAGE_INVOICE", amount: 200000, advanceAdjusted: 100000 },
      ],
    });
    expect(s.costToDate).toBe(325000);
    expect(s.draftCost).toBe(15000);
    expect(s.margin).toBe(175000);
    expect(s.marginPct).toBe(35);
    expect(s.marginBand).toBe("HEALTHY");
    expect(s.percentComplete).toBe(50);
    expect(s.billed).toBe(200000);
    expect(s.billedVsCost).toBe(-125000);
    expect(s.toBill).toBe(300000);
    expect(s.advanceBalance).toBe(0);
    expect(s.overQuote).toBe(false);
  });

  it("flags a job whose cost has run past the quote", () => {
    const s = summariseJob({
      quoted: 1000,
      costs: [{ type: "MATERIAL", amount: 1200 }],
      stages: [],
      billings: [],
    });
    expect(s.margin).toBe(-200);
    expect(s.marginPct).toBe(-20);
    expect(s.overQuote).toBe(true);
    expect(s.marginBand).toBe("LOSS");
    const zero = summariseJob({ quoted: 0, costs: [], stages: [], billings: [] });
    expect(zero.marginPct).toBeNull();
    expect(zero.marginBand).toBe("THIN");
  });

  it("bands the margin", () => {
    expect(marginBandFor(25, 100)).toBe("HEALTHY");
    expect(marginBandFor(10, 100)).toBe("HEALTHY");
    expect(marginBandFor(9.9, 100)).toBe("THIN");
    expect(marginBandFor(-1, -1)).toBe("LOSS");
  });

  it("reorders only a full permutation of the stages", () => {
    expect([...reorderSeqs(["a", "b", "c"], ["c", "a", "b"])]).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
    expect(() => reorderSeqs(["a", "b"], ["a"])).toThrow();
    expect(() => reorderSeqs(["a", "b"], ["a", "a"])).toThrow();
    expect(() => reorderSeqs(["a", "b"], ["a", "x"])).toThrow();
  });

  it("allows forward moves, one step back and cancel, but nothing out of CANCELLED or DELIVERED", () => {
    expect(canMoveStatus("QUOTED", "IN_PROGRESS")).toBe(true);
    expect(canMoveStatus("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canMoveStatus("COMPLETED", "IN_PROGRESS")).toBe(true);
    expect(canMoveStatus("COMPLETED", "QUOTED")).toBe(false);
    expect(canMoveStatus("QUOTED", "CANCELLED")).toBe(true);
    expect(canMoveStatus("CANCELLED", "IN_PROGRESS")).toBe(false);
    expect(canMoveStatus("DELIVERED", "COMPLETED")).toBe(false);
  });
});
