import { describe, expect, it } from "vitest";

import {
  BONUS_CALCULATION_CEILING,
  BONUS_ELIGIBILITY_WAGE,
  GRATUITY_CEILING,
  QUARTERLY_OVERTIME_CAP,
  carryForward,
  gratuity,
  leaveAccrued,
  leaveEncashment,
  overtimeForWeek,
  settle,
  statutoryBonus,
} from "../../src/modules/payroll/labour.calc";

/**
 * What the Labour Codes say the company owes (P1-17b). Each of these is a formula somebody will
 * check against the bare words of an Act, so they are tested against the Act rather than against
 * the code.
 */
describe("overtime", () => {
  it("takes the greater of the daily and the weekly excess, not the sum", () => {
    // Six days of ten hours: six hours over the daily trigger, twelve over the weekly one.
    const ot = overtimeForWeek({ dailyHours: [10, 10, 10, 10, 10, 10], hourlyRate: 100 });
    expect(ot.dailyExcess).toBe(6);
    expect(ot.weeklyExcess).toBe(12);
    // The same hour cannot be overtime twice; adding them would pay eighteen for twelve.
    expect(ot.overtimeHours).toBe(12);
    expect(ot.amount).toBe(2400); // twelve hours at double the hundred
  });

  it("pays double, never one and a half", () => {
    // Five days at the daily limit and one of twelve: three hours over the day, but the week
    // comes to fifty-seven, which is nine over. The week is the binding trigger here.
    const ot = overtimeForWeek({ dailyHours: [9, 9, 9, 9, 9, 12], hourlyRate: 50 });
    expect(ot.dailyExcess).toBe(3);
    expect(ot.weeklyExcess).toBe(9);
    expect(ot.overtimeHours).toBe(9);
    expect(ot.amount).toBe(900);
  });

  it("says when the quarter's ceiling has been passed, and still pays", () => {
    const ot = overtimeForWeek({
      dailyHours: [12, 12, 12, 12, 12, 12],
      hourlyRate: 100,
      quarterToDateHours: 120,
    });
    expect(ot.overtimeHours).toBe(24);
    // 120 already worked plus 24 is 144, and the ceiling is 125.
    expect(ot.hoursOverCap).toBe(144 - QUARTERLY_OVERTIME_CAP);
    // The hours were worked, so they are paid. The breach is the company's problem, not a reason
    // to underpay the person who worked them.
    expect(ot.amount).toBe(4800);
  });

  it("finds no overtime in an ordinary week", () => {
    const ot = overtimeForWeek({ dailyHours: [8, 8, 8, 8, 8, 8], hourlyRate: 100 });
    expect(ot.overtimeHours).toBe(0);
    expect(ot.amount).toBe(0);
  });
});

describe("gratuity", () => {
  const joined = new Date("2020-04-01T00:00:00Z");

  it("is nil before five completed years", () => {
    const g = gratuity({
      joinedOn: joined,
      leftOn: new Date("2024-06-01T00:00:00Z"),
      lastDrawnWage: 26000,
    });
    expect(g.eligible).toBe(false);
    expect(g.amount).toBe(0);
  });

  it("is fifteen days' wages a year on a twenty-six-day month", () => {
    const g = gratuity({
      joinedOn: joined,
      leftOn: new Date("2025-05-01T00:00:00Z"),
      lastDrawnWage: 26000,
    });
    expect(g.eligible).toBe(true);
    expect(g.countedYears).toBe(5);
    // 26,000 / 26 × 15 × 5 = 75,000.
    expect(g.amount).toBe(75000);
  });

  it("rounds a final part-year over six months up to a whole one", () => {
    // Five years and seven months.
    const g = gratuity({
      joinedOn: joined,
      leftOn: new Date("2025-11-15T00:00:00Z"),
      lastDrawnWage: 26000,
    });
    expect(g.countedYears).toBe(6);
    expect(g.amount).toBe(90000);

    // Five years and four months does not round up.
    const shorter = gratuity({
      joinedOn: joined,
      leftOn: new Date("2025-08-01T00:00:00Z"),
      lastDrawnWage: 26000,
    });
    expect(shorter.countedYears).toBe(5);
  });

  it("qualifies a fixed-term employee after one year", () => {
    const g = gratuity({
      joinedOn: joined,
      leftOn: new Date("2021-06-01T00:00:00Z"),
      lastDrawnWage: 26000,
      fixedTerm: true,
    });
    expect(g.eligible).toBe(true);
    expect(g.countedYears).toBe(1);
  });

  it("stops at the statutory ceiling", () => {
    const g = gratuity({
      joinedOn: new Date("1990-01-01T00:00:00Z"),
      leftOn: new Date("2026-01-01T00:00:00Z"),
      lastDrawnWage: 300000,
    });
    expect(g.cappedAtCeiling).toBe(true);
    expect(g.amount).toBe(GRATUITY_CEILING);
  });
});

describe("statutory bonus", () => {
  it("is computed on the calculation ceiling, not on the actual wage", () => {
    const b = statutoryBonus({ monthlyWage: 20000, monthsWorked: 12 });
    expect(b.eligible).toBe(true);
    // The trap: 20,000 is eligible, but the bonus is on 7,000 — computing it on 20,000 would
    // overstate the liability nearly threefold.
    expect(b.calculationWage).toBe(BONUS_CALCULATION_CEILING);
    expect(b.percent).toBe(8.33);
    expect(b.amount).toBe(Math.round(7000 * 12 * 0.0833 * 100) / 100);
  });

  it("is nil above the eligibility wage", () => {
    const b = statutoryBonus({ monthlyWage: BONUS_ELIGIBILITY_WAGE + 1, monthsWorked: 12 });
    expect(b.eligible).toBe(false);
    expect(b.amount).toBe(0);
  });

  it("uses the minimum wage when it is above the ceiling", () => {
    const b = statutoryBonus({ monthlyWage: 20000, monthsWorked: 12, minimumWage: 12000 });
    expect(b.calculationWage).toBe(12000);
  });

  it("uses the actual wage when it is below the ceiling", () => {
    const b = statutoryBonus({ monthlyWage: 5000, monthsWorked: 12 });
    expect(b.calculationWage).toBe(5000);
  });

  it("holds the percentage between the floor and the cap", () => {
    expect(statutoryBonus({ monthlyWage: 10000, monthsWorked: 12, percent: 2 }).percent).toBe(8.33);
    expect(statutoryBonus({ monthlyWage: 10000, monthsWorked: 12, percent: 50 }).percent).toBe(20);
  });
});

describe("leave", () => {
  it("accrues one day for every twenty worked", () => {
    expect(
      leaveAccrued({ basis: "DAYS_WORKED", daysPerYear: 18, daysWorkedPerDay: 20, daysWorked: 240 })
    ).toBe(12);
    // A part of twenty does not earn a part of a day.
    expect(
      leaveAccrued({ basis: "DAYS_WORKED", daysPerYear: 18, daysWorkedPerDay: 20, daysWorked: 39 })
    ).toBe(1);
  });

  it("accrues monthly and annually the obvious way", () => {
    expect(leaveAccrued({ basis: "MONTHLY", daysPerYear: 12, monthsWorked: 5 })).toBe(5);
    expect(leaveAccrued({ basis: "ANNUAL", daysPerYear: 7 })).toBe(7);
  });

  it("lapses what is over the carry-forward cap", () => {
    expect(carryForward(45, 30)).toEqual({ carried: 30, lapsed: 15 });
    expect(carryForward(20, 30)).toEqual({ carried: 20, lapsed: 0 });
  });

  it("encashes at the daily wage", () => {
    expect(leaveEncashment(10, 26000)).toBe(10000);
  });
});

describe("the settlement", () => {
  it("adds the dues and takes off the recoveries", () => {
    const out = settle({
      salaryDue: 20000,
      leaveEncashment: 10000,
      gratuity: 75000,
      bonus: 7000,
      noticeDaysRequired: 30,
      noticeDaysServed: 30,
      monthlyWage: 26000,
    });
    expect(out.dues).toBe(112000);
    expect(out.noticeRecovery).toBe(0);
    expect(out.netPayable).toBe(112000);
  });

  it("recovers the notice that was not served, at the daily wage", () => {
    const out = settle({
      salaryDue: 20000,
      leaveEncashment: 0,
      gratuity: 0,
      bonus: 0,
      noticeDaysRequired: 30,
      noticeDaysServed: 10,
      monthlyWage: 26000,
    });
    // Twenty days short at a thousand a day.
    expect(out.noticeRecovery).toBe(20000);
    expect(out.netPayable).toBe(0);
  });

  it("comes out negative when the recoveries exceed the dues, rather than clamping to zero", () => {
    const out = settle({
      salaryDue: 5000,
      leaveEncashment: 0,
      gratuity: 0,
      bonus: 0,
      noticeDaysRequired: 60,
      noticeDaysServed: 0,
      monthlyWage: 26000,
      advanceRecovery: 10000,
    });
    // The employee owes the company. Hiding that behind a zero would lose a real receivable.
    expect(out.netPayable).toBeLessThan(0);
    expect(out.recoveries).toBe(70000);
  });
});
