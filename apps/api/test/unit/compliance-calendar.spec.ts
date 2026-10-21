import { describe, expect, it } from "vitest";
import { DUE_RULES, periodCovered } from "../../src/modules/gst-returns/compliance.service";
import { FILINGS } from "@shiftline/shared";

/**
 * The compliance calendar's date arithmetic (P1-13d). The period a filing covers is not the
 * month it is due in — a return for August is filed in September — and getting that off by one
 * turns a warning into an apology, so it is pinned here rather than left to the integration
 * test to notice.
 */
describe("compliance due dates", () => {
  it("covers the month before a monthly filing's due date", () => {
    const rule = DUE_RULES.GSTR3B;
    expect(rule).toEqual({ day: 20, monthsAfter: 1 });
    // GSTR-3B due 20 September 2026 is the return for August.
    expect(periodCovered("MONTHLY", new Date(Date.UTC(2026, 8, 20)), rule)).toBe("2026-08");
    // And in January it is December of the year before, not of the same one.
    expect(periodCovered("MONTHLY", new Date(Date.UTC(2027, 0, 20)), rule)).toBe("2026-12");
  });

  it("covers the quarter that closed before a quarterly filing", () => {
    const rule = DUE_RULES.TDS_26Q;
    // Due 31 July 2026 is April–June, Q1 of FY 2026-27 (the TDS screens use the same keys).
    expect(periodCovered("QUARTERLY", new Date(Date.UTC(2026, 6, 31)), rule)).toBe("2026-Q1");
    expect(periodCovered("QUARTERLY", new Date(Date.UTC(2026, 9, 31)), rule)).toBe("2026-Q2");
    expect(periodCovered("QUARTERLY", new Date(Date.UTC(2027, 0, 31)), rule)).toBe("2026-Q3");
    // January–March is due 31 May, not 30 April (CMP-B04).
    expect(periodCovered("QUARTERLY", new Date(Date.UTC(2027, 4, 31)), rule)).toBe("2026-Q4");
  });

  it("dates TDS quarterly returns and MSME Form 1 on their statutory days", () => {
    for (const key of ["TDS_26Q", "TDS_27Q", "TDS_24Q"]) {
      expect(DUE_RULES[key].dues?.map((d) => [d.month, d.day])).toEqual([
        [6, 31],
        [9, 31],
        [0, 31],
        [4, 31],
      ]);
    }
    // 31 October and 30 April
    expect(DUE_RULES.MSME_1.dues?.map((d) => [d.month, d.day])).toEqual([
      [9, 31],
      [3, 30],
    ]);
  });

  it("covers the financial year that ended before an annual filing", () => {
    const rule = DUE_RULES.GSTR9;
    expect(rule.monthsAfter).toBe(9);
    // GSTR-9 due 31 December 2027 is the year to 31 March 2027.
    expect(periodCovered("ANNUAL", new Date(Date.UTC(2027, 11, 31)), rule)).toBe("2026-27");
  });

  it("covers the half-year for a half-yearly filing", () => {
    // ITC-04 due 25 October covers April–September (H1 of the FY); due 25 April covers H2.
    expect(periodCovered("HALF_YEARLY", new Date(Date.UTC(2026, 9, 25)), DUE_RULES.ITC04)).toBe(
      "2026-H1"
    );
    expect(periodCovered("HALF_YEARLY", new Date(Date.UTC(2027, 3, 25)), DUE_RULES.ITC04)).toBe(
      "2026-H2"
    );
    expect(periodCovered("HALF_YEARLY", new Date(Date.UTC(2026, 9, 31)), DUE_RULES.MSME_1)).toBe(
      "2026-H1"
    );
  });

  it("has a due date for every filing in the registry", () => {
    // A filing added to the shared registry without a date here would never be warned about,
    // and nothing else would notice.
    const missing = FILINGS.filter((f) => !DUE_RULES[f.key]).map((f) => f.key);
    expect(missing).toEqual([]);
  });
});
