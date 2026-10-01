import { describe, expect, it } from "vitest";

import {
  addMonthKey,
  canMoveClaim,
  canMoveScheme,
  capitalEntitlement,
  claimNext,
  claimTotals,
  interestSubvention,
  iso,
  ltptEntitlementFor,
  ltptSchedule,
  monthEnd,
  pendingTooLong,
  periodsOverlap,
  schemeTakesClaims,
  type ClaimLike,
} from "../../src/modules/subsidy-schemes/subsidy.calc";

/**
 * Subsidy arithmetic (TN-10), worked by hand. The rates used here are test inputs, not policy:
 * the product never asserts a G.O.'s numbers.
 */
describe("month keys", () => {
  it("adds months across years and ends February on the leap day", () => {
    expect(addMonthKey("2026-11", 3)).toBe("2027-02");
    expect(addMonthKey("2026-01", 35)).toBe("2028-12");
    expect(iso(monthEnd("2028-02"))).toBe("2028-02-29");
    expect(iso(monthEnd("2026-04"))).toBe("2026-04-30");
  });

  it("finds overlapping periods, touching ends included", () => {
    expect(
      periodsOverlap(
        { from: "2026-01-01", to: "2026-03-31" },
        { from: "2026-03-31", to: "2026-04-30" }
      )
    ).toBe(true);
    expect(
      periodsOverlap(
        { from: "2026-01-01", to: "2026-03-30" },
        { from: "2026-03-31", to: "2026-04-30" }
      )
    ).toBe(false);
  });
});

describe("capital subsidy", () => {
  it("is the rate on eligible plant and machinery below the cap", () => {
    expect(
      capitalEntitlement({ eligiblePlantMachinery: 4_000_000, ratePct: 25, cap: 15_000_000 })
    ).toEqual({ effectivePct: 25, gross: 1_000_000, entitlement: 1_000_000, capped: false });
  });

  it("stops at the cap", () => {
    expect(
      capitalEntitlement({ eligiblePlantMachinery: 80_000_000, ratePct: 25, cap: 15_000_000 })
    ).toEqual({ effectivePct: 25, gross: 20_000_000, entitlement: 15_000_000, capped: true });
  });

  it("adds the extra percentage and runs uncapped without a cap", () => {
    expect(
      capitalEntitlement({ eligiblePlantMachinery: 4_000_000, ratePct: 25, extraPct: 10 })
    ).toMatchObject({ effectivePct: 35, entitlement: 1_400_000, capped: false });
  });
});

describe("LTPT power subsidy schedule", () => {
  const ltpt = {
    startMonth: "2026-01",
    months: 36,
    ratePct: 20,
    monthlyBaseTariff: 50_000,
    tariffByMonth: { "2026-03": 60_000 },
  };
  const claims: ClaimLike[] = [
    {
      claimNo: "C1",
      periodFrom: "2026-01-01",
      periodTo: "2026-02-28",
      amountClaimed: 20_000,
      status: "DISBURSED",
    },
    {
      claimNo: "C2",
      periodFrom: "2026-04-01",
      periodTo: "2026-04-30",
      amountClaimed: 10_000,
      status: "FILED",
    },
    {
      claimNo: "C3",
      periodFrom: "2026-05-01",
      periodTo: "2026-05-31",
      amountClaimed: 10_000,
      status: "REJECTED",
    },
  ];

  it("marks each month received, claimed, missed, due or upcoming", () => {
    const s = ltptSchedule(ltpt, claims, "2026-06-15");
    expect(s.months).toHaveLength(36);
    expect(s.lastMonth).toBe("2028-12");
    const state = Object.fromEntries(s.months.slice(0, 7).map((m) => [m.month, m.state]));
    expect(state).toEqual({
      "2026-01": "RECEIVED",
      "2026-02": "RECEIVED",
      "2026-03": "MISSED", // skipped: April is already claimed
      "2026-04": "CLAIMED",
      "2026-05": "DUE", // its only claim was rejected
      "2026-06": "UPCOMING", // not over yet
      "2026-07": "UPCOMING",
    });
    expect(s.months[0]).toMatchObject({ entitlement: 10_000, claimNo: "C1", index: 1 });
    expect(s.months[2]).toMatchObject({ tariff: 60_000, entitlement: 12_000, claimNo: null });
    expect(s.totals).toEqual({
      entitlement: 362_000,
      claimed: 30_000,
      received: 20_000,
      due: 10_000,
      missed: 12_000,
      upcoming: 310_000,
      dueMonths: 1,
      missedMonths: 1,
    });
  });

  it("turns a due month into a missed one once the claim window runs out", () => {
    const withWindow = { ...ltpt, claimWindowDays: 30 };
    const june = ltptSchedule(withWindow, claims, "2026-06-15");
    expect(june.months[4]).toMatchObject({ state: "DUE", claimBy: "2026-06-30" });
    const july = ltptSchedule(withWindow, claims, "2026-07-05");
    expect(july.months[4].state).toBe("MISSED");
    expect(july.months[5]).toMatchObject({ month: "2026-06", state: "DUE", claimBy: "2026-07-30" });
  });

  it("works out the entitlement for the months a claim period touches", () => {
    expect(ltptEntitlementFor(ltpt, "2026-02-15", "2026-04-10")).toEqual({
      months: ["2026-02", "2026-03", "2026-04"],
      amount: 32_000,
    });
    expect(ltptEntitlementFor(ltpt, "2025-01-01", "2025-12-31")).toEqual({ months: [], amount: 0 });
  });
});

describe("interest subvention", () => {
  const loan = { sanctionedLoan: 1_000_000, subventionPct: 3 };

  it("is rate × principal × days / 365 on the sanctioned loan", () => {
    expect(interestSubvention(loan, "2026-04-01", "2026-06-30")).toEqual({
      days: 91,
      averagePrincipal: 1_000_000,
      gross: 7479.45,
      amount: 7479.45,
      capped: false,
    });
  });

  it("follows the recorded balances", () => {
    const r = interestSubvention(
      { ...loan, balances: [{ from: "2026-05-01", principal: 800_000 }] },
      "2026-04-01",
      "2026-06-30"
    );
    // 30 days at 10 lakh + 61 days at 8 lakh = 7.88 crore principal-days.
    expect(r).toMatchObject({ days: 91, averagePrincipal: 865_934.07, amount: 6476.71 });
    const before = interestSubvention(
      { ...loan, balances: [{ from: "2026-03-01", principal: 900_000 }] },
      "2026-04-01",
      "2026-06-30"
    );
    expect(before.amount).toBe(6731.51);
  });

  it("applies an annual cap pro rata", () => {
    expect(
      interestSubvention({ ...loan, annualCap: 20_000 }, "2026-04-01", "2026-06-30")
    ).toMatchObject({ gross: 7479.45, amount: 4986.3, capped: true });
  });

  it("is zero for an empty period", () => {
    expect(interestSubvention(loan, "2026-06-30", "2026-06-01").amount).toBe(0);
  });
});

describe("totals and reminders", () => {
  const claims: ClaimLike[] = [
    { periodFrom: "2026-01-01", periodTo: "2026-01-31", amountClaimed: 5_000, status: "DRAFT" },
    {
      periodFrom: "2026-02-01",
      periodTo: "2026-02-28",
      amountClaimed: 20_000,
      status: "FILED",
      filedOn: "2026-03-01",
    },
    {
      periodFrom: "2026-03-01",
      periodTo: "2026-03-31",
      amountClaimed: 10_000,
      status: "APPROVED",
      filedOn: "2026-04-20",
    },
    {
      periodFrom: "2026-04-01",
      periodTo: "2026-04-30",
      amountClaimed: 30_000,
      status: "DISBURSED",
      filedOn: "2026-01-01",
      disbursedAmount: 28_000,
    },
    { periodFrom: "2026-05-01", periodTo: "2026-05-31", amountClaimed: 7_000, status: "REJECTED" },
  ];

  it("splits sanctioned, claimed, received and pending", () => {
    expect(claimTotals(100_000, claims)).toEqual({
      sanctioned: 100_000,
      claimed: 60_000,
      drafted: 5_000,
      disbursed: 28_000,
      pending: 30_000,
      rejected: 7_000,
      shortfall: 2_000,
      unclaimed: 35_000,
    });
    expect(claimTotals(null, []).unclaimed).toBeNull();
  });

  it("flags claims waiting for money more than 90 days", () => {
    const late = pendingTooLong(claims, "2026-07-01");
    expect(late.map((c) => [c.status, c.daysPending])).toEqual([["FILED", 122]]);
  });
});

describe("status machines", () => {
  it("moves a claim forward only", () => {
    expect(claimNext("DRAFT")).toEqual(["FILED"]);
    expect(canMoveClaim("FILED", "DISBURSED")).toBe(true);
    expect(canMoveClaim("APPROVED", "FILED")).toBe(false);
    expect(canMoveClaim("DISBURSED", "REJECTED")).toBe(false);
    expect(canMoveClaim("DRAFT", "APPROVED")).toBe(false);
  });

  it("moves a scheme forward only and takes claims only once sanctioned", () => {
    expect(canMoveScheme("APPLIED", "SANCTIONED")).toBe(true);
    expect(canMoveScheme("ACTIVE", "SANCTIONED")).toBe(false);
    expect(canMoveScheme("CLOSED", "ACTIVE")).toBe(false);
    expect(schemeTakesClaims("APPLIED")).toBe(false);
    expect(schemeTakesClaims("ACTIVE")).toBe(true);
    expect(schemeTakesClaims("CLOSED")).toBe(false);
  });
});
