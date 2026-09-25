import { describe, expect, it } from "vitest";

import {
  TNA_TEMPLATES,
  TNA_TEMPLATE_KEYS,
  asDate,
  delayDays,
  generateMilestones,
  iso,
  ragFor,
  shiftOpenMilestones,
  summarise,
} from "../../src/modules/order-tna/order-tna.calc";

const d = asDate;

describe("order T&A calc (TN-03)", () => {
  it("has the four templates, each ending at ex-factory (offset 0)", () => {
    expect(TNA_TEMPLATE_KEYS.sort()).toEqual(
      ["GARMENT_KNIT", "GENERIC", "HOME_TEXTILE", "LEATHER_FOOTWEAR"].sort()
    );
    for (const t of Object.values(TNA_TEMPLATES)) {
      expect(t.steps.at(-1)?.offsetDays).toBe(0);
    }
    expect(TNA_TEMPLATES.GARMENT_KNIT.steps).toHaveLength(13);
  });

  it("counts planned dates back from the ex-factory date", () => {
    const rows = generateMilestones("GENERIC", d("2026-01-01"), d("2026-03-31"));
    expect(rows.map((r) => [r.seq, r.name, iso(r.plannedDate)])).toEqual([
      [1, "Material in", "2026-03-01"],
      [2, "Production start", "2026-03-11"],
      [3, "Production done", "2026-03-26"],
      [4, "Inspection", "2026-03-29"],
      [5, "Dispatch", "2026-03-31"],
    ]);
  });

  it("clamps planned dates so none falls before the order date", () => {
    const rows = generateMilestones("GARMENT_KNIT", d("2026-03-01"), d("2026-03-31"));
    expect(iso(rows[0].plannedDate)).toBe("2026-03-01"); // −60 would be 2026-01-30
    expect(rows.every((r) => r.plannedDate >= d("2026-03-01"))).toBe(true);
    expect(iso(rows.at(-1)!.plannedDate)).toBe("2026-03-31");
  });

  it("shifts only PENDING milestones when the ex-factory date moves", () => {
    const ms = [
      {
        id: "a",
        status: "DONE" as const,
        plannedDate: d("2026-03-01"),
        actualDate: d("2026-03-02"),
      },
      { id: "b", status: "PENDING" as const, plannedDate: d("2026-03-10") },
      { id: "c", status: "SKIPPED" as const, plannedDate: d("2026-03-15") },
      { id: "d", status: "PENDING" as const, plannedDate: d("2026-03-31") },
    ];
    const moved = shiftOpenMilestones(ms, d("2026-03-31"), d("2026-04-07"));
    expect(moved.map((m) => [m.milestone.id, iso(m.plannedDate)])).toEqual([
      ["b", "2026-03-17"],
      ["d", "2026-04-07"],
    ]);
    expect(shiftOpenMilestones(ms, d("2026-03-31"), d("2026-03-31"))).toEqual([]);
    // Pulling the date in moves open milestones earlier by the same amount.
    expect(iso(shiftOpenMilestones(ms, d("2026-03-31"), d("2026-03-28"))[0].plannedDate)).toBe(
      "2026-03-07"
    );
  });

  it("computes delay days only for done milestones", () => {
    expect(
      delayDays({ status: "DONE", plannedDate: d("2026-03-01"), actualDate: d("2026-03-04") })
    ).toBe(3);
    expect(
      delayDays({ status: "DONE", plannedDate: d("2026-03-05"), actualDate: d("2026-03-04") })
    ).toBe(-1);
    expect(delayDays({ status: "PENDING", plannedDate: d("2026-03-01") })).toBeNull();
  });

  it("rates RED on an overdue pending milestone, AMBER within 3 days, else GREEN", () => {
    const today = d("2026-03-10");
    expect(ragFor([{ status: "PENDING", plannedDate: d("2026-03-09") }], today)).toBe("RED");
    expect(ragFor([{ status: "PENDING", plannedDate: d("2026-03-13") }], today)).toBe("AMBER");
    expect(ragFor([{ status: "PENDING", plannedDate: d("2026-03-10") }], today)).toBe("AMBER");
    expect(ragFor([{ status: "PENDING", plannedDate: d("2026-03-14") }], today)).toBe("GREEN");
    // A done or skipped milestone in the past never turns an order red.
    expect(
      ragFor(
        [
          { status: "DONE", plannedDate: d("2026-03-01"), actualDate: d("2026-03-08") },
          { status: "SKIPPED", plannedDate: d("2026-03-02") },
        ],
        today
      )
    ).toBe("GREEN");
  });

  it("summarises the next milestone and the overdue count", () => {
    const s = summarise(
      [
        { seq: 1, name: "A", status: "PENDING" as const, plannedDate: d("2026-03-01") },
        { seq: 2, name: "B", status: "PENDING" as const, plannedDate: d("2026-03-05") },
        { seq: 3, name: "C", status: "PENDING" as const, plannedDate: d("2026-03-20") },
      ],
      d("2026-03-10")
    );
    expect(s).toEqual({
      rag: "RED",
      nextMilestone: { name: "A", plannedDate: "2026-03-01" },
      overdueCount: 2,
    });
  });
});
