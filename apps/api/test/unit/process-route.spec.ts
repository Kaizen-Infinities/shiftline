import { describe, expect, it } from "vitest";

import {
  GAIN_TOLERANCE_PCT,
  ROUTE_TEMPLATES,
  checkMovement,
  checkRouteSteps,
  computeLot,
  convertQty,
  effectiveFactor,
  lossPct,
  type Movement,
  type RouteStep,
} from "../../src/modules/process-routes/process-route.calc";

const S = (
  seq: number,
  name: string,
  mode: "IN_HOUSE" | "JOB_WORK",
  uomIn: string,
  uomOut: string,
  factor: number | null,
  lossNormPct: number
): RouteStep => ({ id: `s${seq}`, seq, name, mode, uomIn, uomOut, factor, lossNormPct });

/** Knitting (JW) → dyeing (JW) → compacting (in-house) → stitching KG→PCS ×4 (in-house). */
const ROUTE: RouteStep[] = [
  S(1, "KNITTING", "JOB_WORK", "KG", "KG", null, 2),
  S(2, "DYEING", "JOB_WORK", "KG", "KG", null, 8),
  S(3, "COMPACTING", "IN_HOUSE", "KG", "KG", null, 1),
  S(4, "STITCHING", "IN_HOUSE", "KG", "PCS", 4, 3),
];

const out = (stepSeq: number, qty: number, jw: string | null, date = "2026-09-01"): Movement => ({
  stepSeq,
  direction: "OUT",
  qty,
  jobWorkerId: jw,
  date,
});
const back = (
  stepSeq: number,
  qty: number,
  jw: string | null,
  closesStep = true,
  date = "2026-09-05"
): Movement => ({ stepSeq, direction: "IN", qty, jobWorkerId: jw, date, closesStep });

describe("process route calc (TN-06)", () => {
  it("converts KG to PCS with the step's factor, and keeps the unit at factor 1", () => {
    expect(effectiveFactor({ uomIn: "KG", uomOut: "PCS", factor: 4 })).toBe(4);
    expect(effectiveFactor({ uomIn: "kg", uomOut: "KG", factor: null })).toBe(1);
    expect(effectiveFactor({ uomIn: "KG", uomOut: "PCS", factor: null })).toBeNull();
    expect(convertQty(250.5, 4)).toBe(1002);
    expect(convertQty(0.333, 3)).toBe(0.999);
    expect(convertQty(10, null)).toBeNull();
  });

  it("works out loss % against what should have come back", () => {
    expect(lossPct(1000, 920)).toBe(8);
    expect(lossPct(1000, 1010)).toBe(-1);
    expect(lossPct(0, 0)).toBeNull();
  });

  it("checks that step units chain and in-house steps have no job worker", () => {
    expect(checkRouteSteps([])).toMatch(/at least one step/);
    expect(
      checkRouteSteps([
        { name: "A", mode: "JOB_WORK", uomIn: "KG", uomOut: "KG" },
        { name: "B", mode: "IN_HOUSE", uomIn: "PCS", uomOut: "PCS" },
      ])
    ).toMatch(/units must chain/);
    expect(
      checkRouteSteps([
        { name: "A", mode: "IN_HOUSE", uomIn: "KG", uomOut: "KG", defaultJobWorkerId: "x" },
      ])
    ).toMatch(/in-house/);
    expect(
      checkRouteSteps([
        { name: "A", mode: "IN_HOUSE", uomIn: "KG", uomOut: "KG", conversionFactor: 2 },
      ])
    ).toMatch(/factor must be 1/);
    for (const t of ROUTE_TEMPLATES) expect(checkRouteSteps(t.steps)).toBeNull();
  });

  it("follows a lot through four steps: loss vs norm, KG→PCS, cumulative yield", () => {
    const mv = [
      out(1, 1000, "K"),
      back(1, 985, "K"), // 1.5% loss, norm 2
      out(2, 985, "D"),
      back(2, 896.35, "D"), // 9% loss, norm 8 → over
      out(3, 896.35, null),
      back(3, 887.386, null), // 1%
      out(4, 887.386, null),
      back(4, 3443, null), // expected 3549.544 → 3.0% loss
    ];
    const lot = computeLot(ROUTE, { qty: 1000 }, mv);
    expect(lot.steps.map((s) => s.state)).toEqual(["DONE", "DONE", "DONE", "DONE"]);
    expect(lot.steps[0]).toMatchObject({ lossPct: 1.5, overNorm: false, yieldPct: 98.5 });
    expect(lot.steps[1]).toMatchObject({ lossPct: 9, overNorm: true });
    expect(lot.steps[2]).toMatchObject({ lossPct: 1, overNorm: false });
    expect(lot.steps[3]).toMatchObject({ expectedOut: 3549.544, received: 3443, uomOut: "PCS" });
    expect(lot.steps[3].lossPct).toBe(3);
    expect(lot.steps[3].overNorm).toBe(false);
    expect(lot.overNormSteps).toBe(1);
    expect(lot.currentSeq).toBe(5);
    expect(lot.finalOutput).toBe(3443);
    // 0.985 × 0.91 × 0.99 × 0.97
    expect(lot.cumulativeYieldPct).toBe(86.08);
    expect(lot.normYieldPct).toBe(86.58);
    expect(lot.closeBlockers).toEqual([]);
    expect(lot.locations).toEqual([
      {
        kind: "FINISHED",
        stepSeq: 4,
        stepName: "STITCHING",
        jobWorkerId: null,
        qty: 3443,
        uom: "PCS",
      },
    ]);
  });

  it("shows where the lot is: WIP at the job worker and what waits in hand", () => {
    const lot = computeLot(ROUTE, { qty: 1000 }, [
      out(1, 1000, "K"),
      back(1, 600, "K", false),
      out(2, 500, "D"),
    ]);
    expect(lot.currentSeq).toBe(1);
    expect(lot.steps[0].state).toBe("IN_PROCESS");
    expect(lot.steps[0].overNorm).toBe(false); // not judged until done
    expect(lot.locations).toEqual([
      {
        kind: "JOB_WORKER",
        stepSeq: 1,
        stepName: "KNITTING",
        jobWorkerId: "K",
        qty: 400,
        uom: "KG",
      },
      { kind: "IN_HAND", stepSeq: 2, stepName: "DYEING", jobWorkerId: null, qty: 100, uom: "KG" },
      { kind: "JOB_WORKER", stepSeq: 2, stepName: "DYEING", jobWorkerId: "D", qty: 500, uom: "KG" },
    ]);
    expect(lot.closeBlockers).toHaveLength(4);
    expect(lot.cumulativeYieldPct).toBeNull();
  });

  it("keeps WIP in the unit sent when some PCS came back from a KG step", () => {
    const route = [S(1, "CASTING", "JOB_WORK", "KG", "PCS", 0.4, 0)];
    const lot = computeLot(route, { qty: 500 }, [out(1, 500, "F"), back(1, 100, "F", false)]);
    expect(lot.steps[0].holders[0].wip).toBe(250);
    expect(lot.steps[0].expectedOut).toBe(200);
  });

  describe("movement rules", () => {
    const start = { startDate: "2026-09-01" };
    const lotAfter = (mv: Movement[]) => computeLot(ROUTE, { qty: 1000 }, mv);

    it("refuses to send to a step before the previous one returned anything", () => {
      const r = checkMovement(lotAfter([out(1, 1000, "K")]), start, {
        stepSeq: 2,
        direction: "OUT",
        qty: 10,
        jobWorkerId: "D",
        date: "2026-09-02",
      });
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/steps run in order/) });
    });

    it("refuses to send more than is available", () => {
      const r = checkMovement(lotAfter([]), start, {
        stepSeq: 1,
        direction: "OUT",
        qty: 1000.001,
        jobWorkerId: "K",
        date: "2026-09-01",
      });
      expect(r).toMatchObject({
        ok: false,
        message: "Only 1000 KG is available to send to KNITTING",
      });
    });

    it("refuses a return beyond the gain tolerance but accepts one inside it", () => {
      const lot = lotAfter([out(1, 1000, "K")]);
      const ok = checkMovement(lot, start, {
        stepSeq: 1,
        direction: "IN",
        qty: 1000 * (1 + GAIN_TOLERANCE_PCT / 100),
        jobWorkerId: null,
        date: "2026-09-03",
      });
      expect(ok).toEqual({ ok: true, jobWorkerId: "K" });
      const bad = checkMovement(lot, start, {
        stepSeq: 1,
        direction: "IN",
        qty: 1020.001,
        jobWorkerId: "K",
        date: "2026-09-03",
      });
      expect(bad).toMatchObject({
        ok: false,
        message: expect.stringMatching(/more than was sent/),
      });
    });

    it("applies the KG→PCS factor to the return cap", () => {
      const lot = computeLot(ROUTE, { qty: 100 }, [
        out(1, 100, "K"),
        back(1, 100, "K"),
        out(2, 100, "D"),
        back(2, 100, "D"),
        out(3, 100, null),
        back(3, 100, null),
        out(4, 100, null),
      ]);
      const mv = { stepSeq: 4, direction: "IN" as const, jobWorkerId: null, date: "2026-09-06" };
      expect(checkMovement(lot, start, { ...mv, qty: 408 }).ok).toBe(true);
      expect(checkMovement(lot, start, { ...mv, qty: 408.001 }).ok).toBe(false);
    });

    it("refuses anything on a finished step, a job worker on an in-house step and early dates", () => {
      const lot = lotAfter([out(1, 1000, "K"), back(1, 980, "K")]);
      expect(
        checkMovement(lot, start, {
          stepSeq: 1,
          direction: "IN",
          qty: 1,
          jobWorkerId: "K",
          date: "2026-09-09",
        })
      ).toMatchObject({ ok: false, status: 409 });
      expect(
        checkMovement(lot, start, {
          stepSeq: 3,
          direction: "OUT",
          qty: 1,
          jobWorkerId: "X",
          date: "2026-09-09",
        })
      ).toMatchObject({ ok: false, message: expect.stringMatching(/in-house/) });
      expect(
        checkMovement(lot, start, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          jobWorkerId: "D",
          date: "2026-09-04",
        })
      ).toMatchObject({ ok: false, message: expect.stringMatching(/before it came back/) });
      expect(
        checkMovement(lot, start, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          jobWorkerId: "D",
          date: "2026-08-01",
        })
      ).toMatchObject({ ok: false, message: expect.stringMatching(/before the lot started/) });
      expect(
        checkMovement(lot, start, {
          stepSeq: 9,
          direction: "OUT",
          qty: 1,
          jobWorkerId: null,
          date: "2026-09-09",
        })
      ).toMatchObject({ ok: false, message: expect.stringMatching(/not on this lot's route/) });
    });

    it("needs a job worker on a job-work step and asks which one when two hold it", () => {
      expect(
        checkMovement(lotAfter([]), start, {
          stepSeq: 1,
          direction: "OUT",
          qty: 1,
          jobWorkerId: null,
          date: "2026-09-01",
        })
      ).toMatchObject({ ok: false, message: "Pick the job worker doing KNITTING" });
      const two = lotAfter([out(1, 500, "K"), out(1, 500, "K2")]);
      expect(
        checkMovement(two, start, {
          stepSeq: 1,
          direction: "IN",
          qty: 1,
          jobWorkerId: null,
          date: "2026-09-02",
        })
      ).toMatchObject({ ok: false, message: "Pick which job worker returned it" });
      expect(
        checkMovement(two, start, {
          stepSeq: 1,
          direction: "IN",
          qty: 1,
          jobWorkerId: "Z",
          date: "2026-09-02",
        })
      ).toMatchObject({
        ok: false,
        message: expect.stringMatching(/Nothing was sent to that job worker/),
      });
      expect(
        checkMovement(lotAfter([]), start, {
          stepSeq: 1,
          direction: "IN",
          qty: 1,
          jobWorkerId: null,
          date: "2026-09-02",
        })
      ).toMatchObject({ ok: false, message: expect.stringMatching(/Nothing has been sent/) });
      expect(
        checkMovement(two, start, {
          stepSeq: 1,
          direction: "IN",
          qty: 1,
          jobWorkerId: "K",
          date: "2026-08-31",
        })
      ).toMatchObject({ ok: false });
    });
  });
});
