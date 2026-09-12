import { describe, expect, it } from "vitest";

import {
  itBlockDepreciation,
  monthRange,
  monthlyCharge,
  wdvRate,
} from "../../src/modules/assets/depreciation.calc";

/**
 * Depreciation (P1-18). The two regimes are tested apart from the database and apart from each
 * other, because the mistake this package exists to prevent is making them agree.
 */
const SLM = "SLM" as const;
const WDV = "WDV" as const;

describe("Schedule II, straight line", () => {
  it("charges a full month for an asset in use all month", () => {
    const charge = monthlyCharge({
      cost: 120000,
      residualValue: 0,
      usefulLifeMonths: 120,
      method: SLM,
      accumulated: 0,
      capitalisedOn: new Date("2026-01-01T00:00:00Z"),
      period: monthRange("2026-06"),
    });
    expect(charge.daysInUse).toBe(30);
    expect(charge.amount).toBe(1000);
    expect(charge.closingWdv).toBe(119000);
  });

  it("pro-rates by days when the asset was put to use mid-month", () => {
    const charge = monthlyCharge({
      cost: 120000,
      residualValue: 0,
      usefulLifeMonths: 120,
      method: SLM,
      accumulated: 0,
      // Bought on the 20th: eleven days of June, not a month.
      capitalisedOn: new Date("2026-06-20T00:00:00Z"),
      period: monthRange("2026-06"),
    });
    expect(charge.daysInUse).toBe(11);
    expect(charge.amount).toBe(366.67);
  });

  it("charges nothing before the asset was put to use", () => {
    const charge = monthlyCharge({
      cost: 120000,
      residualValue: 0,
      usefulLifeMonths: 120,
      method: SLM,
      accumulated: 0,
      capitalisedOn: new Date("2026-08-01T00:00:00Z"),
      period: monthRange("2026-06"),
    });
    expect(charge.amount).toBe(0);
  });

  it("never takes the asset below its residual value", () => {
    // 95,000 of a 100,000 asset is already charged and the residual is 5,000: nothing is left.
    const charge = monthlyCharge({
      cost: 100000,
      residualValue: 5000,
      usefulLifeMonths: 120,
      method: SLM,
      accumulated: 95000,
      capitalisedOn: new Date("2020-01-01T00:00:00Z"),
      period: monthRange("2036-06"),
    });
    expect(charge.amount).toBe(0);
    expect(charge.closingWdv).toBe(5000);
  });

  it("charges only what is left in the final month, not a full slice", () => {
    const charge = monthlyCharge({
      cost: 100000,
      residualValue: 5000,
      usefulLifeMonths: 120,
      method: SLM,
      accumulated: 94700, // 300 left of the depreciable 95,000
      capitalisedOn: new Date("2020-01-01T00:00:00Z"),
      period: monthRange("2036-06"),
    });
    expect(charge.amount).toBe(300);
  });

  it("stops on the day of disposal", () => {
    const charge = monthlyCharge({
      cost: 120000,
      residualValue: 0,
      usefulLifeMonths: 120,
      method: SLM,
      accumulated: 0,
      capitalisedOn: new Date("2026-01-01T00:00:00Z"),
      disposedOn: new Date("2026-06-10T00:00:00Z"),
      period: monthRange("2026-06"),
    });
    expect(charge.daysInUse).toBe(10);
    expect(charge.amount).toBe(333.33);
  });
});

describe("Schedule II, written-down value", () => {
  it("derives the rate from the life and the residual rather than taking one", () => {
    // A computer over 3 years to a 5% residual: the Act's own rate is about 63.16%.
    const rate = wdvRate(100000, 5000, 36);
    expect(Math.round(rate * 10000) / 100).toBeCloseTo(63.16, 1);
  });

  it("charges on the opening written-down value, so the charge falls each year", () => {
    const first = monthlyCharge({
      cost: 100000,
      residualValue: 5000,
      usefulLifeMonths: 36,
      method: WDV,
      accumulated: 0,
      capitalisedOn: new Date("2026-01-01T00:00:00Z"),
      period: monthRange("2026-06"),
    });
    const later = monthlyCharge({
      cost: 100000,
      residualValue: 5000,
      usefulLifeMonths: 36,
      method: WDV,
      accumulated: 60000,
      capitalisedOn: new Date("2026-01-01T00:00:00Z"),
      period: monthRange("2027-06"),
    });
    expect(first.amount).toBeGreaterThan(later.amount);
    // The opening written-down value is what it works on, not cost.
    expect(later.openingWdv).toBe(40000);
  });
});

describe("Income-tax block depreciation", () => {
  const fyStart = new Date("2026-04-01T00:00:00Z");
  const fyEnd = new Date("2027-03-31T00:00:00Z");

  it("gives the full rate to an asset used for 180 days or more", () => {
    const r = itBlockDepreciation(
      0,
      15,
      [{ cost: 100000, capitalisedOn: new Date("2026-04-01T00:00:00Z") }],
      fyStart,
      fyEnd
    );
    expect(r.additionsFullRate).toBe(100000);
    expect(r.depreciation).toBe(15000);
    expect(r.closingWdv).toBe(85000);
  });

  it("halves the rate for an asset used for less than 180 days", () => {
    const r = itBlockDepreciation(
      0,
      15,
      // Bought in January: well under 180 days of use in the year.
      [{ cost: 100000, capitalisedOn: new Date("2027-01-10T00:00:00Z") }],
      fyStart,
      fyEnd
    );
    expect(r.additionsHalfRate).toBe(100000);
    expect(r.depreciation).toBe(7500);
  });

  it("takes sale proceeds off the block rather than producing a profit", () => {
    const r = itBlockDepreciation(
      200000,
      15,
      [
        {
          cost: 100000,
          capitalisedOn: new Date("2020-04-01T00:00:00Z"),
          disposedOn: new Date("2026-09-01T00:00:00Z"),
          disposalProceeds: 50000,
        },
      ],
      fyStart,
      fyEnd
    );
    expect(r.deletions).toBe(50000);
    // 200,000 opening less 50,000 proceeds, depreciated at 15%.
    expect(r.depreciation).toBe(22500);
    expect(r.closingWdv).toBe(127500);
  });

  it("closes the block at nil rather than going negative when it is sold for more than its value", () => {
    const r = itBlockDepreciation(
      50000,
      15,
      [
        {
          cost: 100000,
          capitalisedOn: new Date("2020-04-01T00:00:00Z"),
          disposedOn: new Date("2026-09-01T00:00:00Z"),
          disposalProceeds: 90000,
        },
      ],
      fyStart,
      fyEnd
    );
    expect(r.depreciation).toBe(0);
    expect(r.closingWdv).toBe(0);
  });

  it("does not agree with the book charge, and is not meant to", () => {
    const book = monthlyCharge({
      cost: 100000,
      residualValue: 5000,
      usefulLifeMonths: 36,
      method: WDV,
      accumulated: 0,
      capitalisedOn: new Date("2026-04-01T00:00:00Z"),
      period: monthRange("2026-04"),
    });
    const tax = itBlockDepreciation(
      0,
      40,
      [{ cost: 100000, capitalisedOn: new Date("2026-04-01T00:00:00Z") }],
      fyStart,
      fyEnd
    );
    // One is a month of one asset at the Schedule II rate; the other is a year of a pool at the
    // Act's rate. A test that expected them to match would be testing the wrong thing.
    expect(tax.depreciation).toBe(40000);
    expect(book.amount * 12).not.toBe(tax.depreciation);
  });
});
