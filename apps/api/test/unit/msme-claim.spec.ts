import { describe, expect, it } from "vitest";

import {
  addMonths,
  asDate,
  canTransition,
  computeClaim,
  dueDateFor,
  interestRateFor,
  iso,
  limitDaysFor,
  tredsFlag,
} from "../../src/modules/msme-claims/msme-claim.calc";

/**
 * MSMED Act sections 15–16 (TN-05), worked by hand. Bank rate 6.75% gives 20.25% a year, so
 * one month's rest is 1.6875% of the balance.
 */
const base = {
  amount: 100_000,
  invoiceDate: "2026-01-01",
  agreedDays: null as number | null,
  payments: [] as { date: string; amount: number }[],
  bankRate: 6.75,
};

describe("section 15 due date", () => {
  it("caps an agreed term at 45 days", () => {
    expect(limitDaysFor(60)).toBe(45);
    expect(iso(dueDateFor(asDate("2026-01-01"), 60))).toBe("2026-02-15");
  });

  it("uses 15 days when nothing was agreed", () => {
    expect(limitDaysFor(null)).toBe(15);
    expect(limitDaysFor(undefined)).toBe(15);
    expect(iso(dueDateFor(asDate("2026-01-01"), null))).toBe("2026-01-16");
  });

  it("keeps a shorter agreed term", () => {
    expect(limitDaysFor(30)).toBe(30);
    expect(limitDaysFor(0)).toBe(0);
    expect(iso(dueDateFor(asDate("2026-01-01"), 30))).toBe("2026-01-31");
  });

  it("counts from acceptance when it is later than the invoice", () => {
    const r = computeClaim({ ...base, acceptedOn: "2026-01-10", asOf: "2026-01-20" });
    expect(r.acceptedOn).toBe("2026-01-10");
    expect(r.dueDate).toBe("2026-01-25");
    expect(r.interest).toBe(0);
    expect(r.late).toBe(false);
  });
});

describe("section 16 interest (monthly rests at 3x bank rate)", () => {
  it("is three times the bank rate", () => {
    expect(interestRateFor(6.75)).toBe(20.25);
    expect(interestRateFor(6.5)).toBe(19.5);
  });

  it("nothing before the due date", () => {
    const r = computeClaim({ ...base, asOf: "2026-01-16" });
    expect(r.dueDate).toBe("2026-01-16");
    expect(r.daysLate).toBe(0);
    expect(r.interest).toBe(0);
  });

  it("one full month earns exactly annual/12: 100000 x 1.6875% = 1687.50", () => {
    // Interest runs from 17 Jan; the first rest falls on 17 Feb.
    const r = computeClaim({ ...base, asOf: "2026-02-16" });
    expect(r.interestFrom).toBe("2026-01-17");
    expect(r.daysLate).toBe(31);
    expect(r.rests).toBe(0);
    expect(r.interest).toBe(1687.5);
  });

  it("compounds at the rest: two months = 100000 x (1.016875^2 - 1) = 3403.48", () => {
    const r = computeClaim({ ...base, asOf: "2026-03-16" });
    expect(r.rests).toBe(1);
    expect(r.interest).toBe(3403.48);
    // Simple interest would have been 3375.00: the difference is interest on interest.
    expect(r.interest).toBeGreaterThan(3375);
  });

  it("twelve months compound to 100000 x (1.016875^12 - 1)", () => {
    const r = computeClaim({ ...base, asOf: "2027-01-16" });
    expect(r.rests).toBe(11);
    expect(r.interest).toBeCloseTo(100_000 * (1.016875 ** 12 - 1), 1);
    expect(r.interest).toBe(22239.3);
  });

  it("a part month earns its share of the month: 15 of 31 days = 816.53", () => {
    const r = computeClaim({ ...base, asOf: "2026-01-31" });
    expect(r.interest).toBe(816.53);
  });

  it("applies the 45-day cap to the interest clock too", () => {
    // Agreed 90 days, but the clock stops at 45: due 15 Feb, interest from 16 Feb, one month to 15 Mar.
    const r = computeClaim({ ...base, agreedDays: 90, asOf: "2026-03-15" });
    expect(r.limitDays).toBe(45);
    expect(r.dueDate).toBe("2026-02-15");
    expect(r.interest).toBe(1687.5);
  });
});

describe("part payments", () => {
  it("a payment before the due date never bears interest", () => {
    const r = computeClaim({
      ...base,
      payments: [{ date: "2026-01-10", amount: 30_000 }],
      asOf: "2026-02-16",
    });
    expect(r.principalOutstanding).toBe(70_000);
    expect(r.interest).toBe(1181.25); // 70000 x 1.6875%
  });

  it("a late part payment reduces the principal from the next day", () => {
    // 40000 paid on 16 Feb, the last day of the first month: that month earns on 100000
    // (1687.50, capitalised on 17 Feb); the second month earns on 60000 + 1687.50.
    const r = computeClaim({
      ...base,
      payments: [{ date: "2026-02-16", amount: 40_000 }],
      asOf: "2026-03-16",
    });
    expect(r.paid).toBe(40_000);
    expect(r.principalOutstanding).toBe(60_000);
    expect(r.interest).toBe(round2(1687.5 + 61_687.5 * 0.016875)); // 2728.48
    expect(r.interest).toBe(2728.48);
  });

  it("interest stops when the principal is paid in full, late", () => {
    const paidLate = {
      ...base,
      payments: [{ date: "2026-01-31", amount: 100_000 }],
    };
    const atPayment = computeClaim({ ...paidLate, asOf: "2026-01-31" });
    const later = computeClaim({ ...paidLate, asOf: "2026-06-30" });
    expect(atPayment.interest).toBe(816.53);
    expect(later.interest).toBe(816.53);
    expect(later.principalOutstanding).toBe(0);
    expect(later.late).toBe(true);
  });

  it("ignores payments after the as-of date", () => {
    const r = computeClaim({
      ...base,
      payments: [{ date: "2026-05-01", amount: 100_000 }],
      asOf: "2026-02-16",
    });
    expect(r.paid).toBe(0);
    expect(r.principalOutstanding).toBe(100_000);
    expect(r.interest).toBe(1687.5);
  });
});

describe("helpers", () => {
  it("rests fall on the monthly anniversary, clamped at month end", () => {
    expect(iso(addMonths(asDate("2026-01-31"), 1))).toBe("2026-02-28");
    expect(iso(addMonths(asDate("2026-01-31"), 2))).toBe("2026-03-31");
    expect(iso(addMonths(asDate("2026-11-15"), 3))).toBe("2027-02-15");
  });

  it("claim status only moves forward", () => {
    expect(canTransition("DRAFT", "FILED")).toBe(true);
    expect(canTransition("FILED", "HEARING")).toBe(true);
    expect(canTransition("HEARING", "SETTLED")).toBe(true);
    expect(canTransition("FILED", "WITHDRAWN")).toBe(true);
    expect(canTransition("FILED", "DRAFT")).toBe(false);
    expect(canTransition("HEARING", "FILED")).toBe(false);
    expect(canTransition("SETTLED", "WITHDRAWN")).toBe(false);
    expect(canTransition("WITHDRAWN", "FILED")).toBe(false);
    expect(canTransition("DRAFT", "DRAFT")).toBe(false);
  });

  it("TReDS: check within 180 days, no when older or not accepted", () => {
    const ok = tredsFlag({
      invoiceDate: "2026-01-01",
      asOf: "2026-06-30",
      accepted: true,
      principalOutstanding: 10,
    });
    expect(ok.flag).toBe("CHECK");
    expect(
      tredsFlag({
        invoiceDate: "2026-01-01",
        asOf: "2026-07-01",
        accepted: true,
        principalOutstanding: 10,
      }).flag
    ).toBe("NO");
    expect(
      tredsFlag({
        invoiceDate: "2026-01-01",
        asOf: "2026-02-01",
        accepted: false,
        principalOutstanding: 10,
      }).flag
    ).toBe("NO");
  });
});

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
