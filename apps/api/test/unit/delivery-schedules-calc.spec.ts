import { describe, expect, it } from "vitest";

import {
  adherence,
  adherenceBand,
  dueDateInWindow,
  lineMetrics,
  type CalcLine,
} from "../../src/modules/delivery-schedules/delivery-schedules.calc";

const d = (v: string) => new Date(`${v}T00:00:00Z`);
const line = (
  due: string,
  scheduledQty: number,
  dispatches: [string, number][] = [],
  firmness: "FIRM" | "TENTATIVE" = "FIRM"
): CalcLine => ({
  dueDate: d(due),
  firmness,
  scheduledQty,
  dispatches: dispatches.map(([date, qty]) => ({ dispatchDate: d(date), qty })),
});

describe("delivery schedule line metrics (TN-02)", () => {
  const asOf = d("2026-10-15");

  it("is PENDING when nothing is dispatched and the line is not yet due", () => {
    const m = lineMetrics(line("2026-10-20", 100), asOf);
    expect(m).toMatchObject({ status: "PENDING", dispatched: 0, short: 100, remaining: 100 });
  });

  it("is MET when the full quantity went on or before the due date", () => {
    const m = lineMetrics(
      line("2026-10-10", 100, [
        ["2026-10-05", 60],
        ["2026-10-10", 40],
      ]),
      asOf
    );
    expect(m).toMatchObject({ status: "MET", onTime: 100, late: 0, short: 0 });
  });

  it("is LATE when the full quantity arrived but part of it after the due date", () => {
    const m = lineMetrics(
      line("2026-10-10", 100, [
        ["2026-10-09", 70],
        ["2026-10-12", 30],
      ]),
      asOf
    );
    expect(m).toMatchObject({ status: "LATE", onTime: 70, late: 30, short: 0 });
  });

  it("is SHORT when past due and under-delivered", () => {
    const m = lineMetrics(line("2026-10-10", 100, [["2026-10-08", 40]]), asOf);
    expect(m).toMatchObject({ status: "SHORT", onTime: 40, short: 60, remaining: 60 });
  });

  it("is EXCESS above 110% of the scheduled quantity, and exactly 110% is still MET", () => {
    expect(lineMetrics(line("2026-10-10", 100, [["2026-10-01", 111]]), asOf).status).toBe("EXCESS");
    expect(lineMetrics(line("2026-10-10", 100, [["2026-10-01", 110]]), asOf).status).toBe("MET");
  });

  it("keeps decimal quantities exact to three places", () => {
    const m = lineMetrics(
      line("2026-10-10", 0.3, [
        ["2026-10-01", 0.1],
        ["2026-10-02", 0.2],
      ]),
      asOf
    );
    expect(m.dispatched).toBe(0.3);
    expect(m.status).toBe("MET");
  });
});

describe("adherence and OTIF (TN-02)", () => {
  const asOf = d("2026-10-31");

  it("counts FIRM lines only, credits on-time quantity up to the scheduled quantity", () => {
    const totals = adherence(
      [
        line("2026-10-05", 100, [["2026-10-05", 105]]), // MET, credit capped at 100
        line("2026-10-15", 100, [
          ["2026-10-14", 50],
          ["2026-10-20", 50],
        ]), // LATE, 50 credited
        line("2026-10-25", 100, [["2026-10-24", 50]]), // SHORT, 50 credited
        line("2026-10-28", 999, [], "TENTATIVE"), // ignored
      ],
      asOf
    );
    expect(totals.firmLines).toBe(3);
    expect(totals.scheduled).toBe(300);
    expect(totals.adherencePct).toBe(66.7); // 200 / 300
    expect(totals.dueLines).toBe(3);
    expect(totals.metLines).toBe(1);
    expect(totals.otifPct).toBe(33.3);
    expect(totals.late).toBe(50);
    expect(totals.short).toBe(50);
  });

  it("leaves OTIF empty when no FIRM line is due yet, and adherence empty with no FIRM lines", () => {
    const early = adherence([line("2026-11-20", 100)], asOf);
    expect(early.otifPct).toBeNull();
    expect(early.adherencePct).toBe(0);
    expect(adherence([line("2026-10-10", 5, [], "TENTATIVE")], asOf).adherencePct).toBeNull();
  });
});

describe("due date window and colour bands (TN-02)", () => {
  it("allows 45 days either side of the schedule month", () => {
    const month = d("2026-10-01");
    expect(dueDateInWindow(month, d("2026-08-17"))).toBe(true); // 45 days before 1 Oct
    expect(dueDateInWindow(month, d("2026-08-16"))).toBe(false);
    expect(dueDateInWindow(month, d("2026-12-15"))).toBe(true); // 45 days after 31 Oct
    expect(dueDateInWindow(month, d("2026-12-16"))).toBe(false);
  });

  it("bands ≥95 green, 85–95 amber, <85 red", () => {
    expect(adherenceBand(95)).toBe("good");
    expect(adherenceBand(94.9)).toBe("warn");
    expect(adherenceBand(85)).toBe("warn");
    expect(adherenceBand(84.9)).toBe("bad");
    expect(adherenceBand(null)).toBe("none");
  });
});
