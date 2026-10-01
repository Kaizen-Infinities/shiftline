import { describe, expect, it } from "vitest";

import {
  asDate,
  canMoveAction,
  canMoveAudit,
  dailyHoursCheck,
  hoursBreaches,
  hoursForDay,
  isDueSoon,
  isFindingOpen,
  isOverdue,
  minimumWageCheck,
  monthsInRange,
  openFindingsCheck,
  otCapCheck,
  overdueActionsCheck,
  quarterKey,
  quarterStart,
  readinessBand,
  readinessPercent,
  registersCheck,
  shiftHours,
  weekStart,
  weeklyHoursCheck,
  type DayHours,
  type EmployeeRef,
} from "../../src/modules/buyer-audits/buyer-audits.calc";

/** TN-08 readiness checks: every rule of the pure calc. */
const EMP = new Map<string, EmployeeRef>([
  ["1", { code: "E001", name: "Anbu" }],
  ["2", { code: "E002", name: "Bala" }],
]);

/** Six days Mon 2026-09-07 .. Sat 2026-09-12 at `h` hours each. */
const week = (employeeId: string, h: number | number[]): DayHours[] =>
  ["07", "08", "09", "10", "11", "12"].map((d, i) => ({
    employeeId,
    date: `2026-09-${d}`,
    hours: Array.isArray(h) ? h[i] : h,
  }));

describe("dates", () => {
  it("finds the Monday of a week, months in a range and the calendar quarter", () => {
    expect(weekStart("2026-09-13")).toBe("2026-09-07"); // Sunday → Monday before
    expect(weekStart("2026-09-07")).toBe("2026-09-07");
    expect(monthsInRange("2026-11-20", "2027-02-01")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(quarterKey("2026-09-30")).toBe("2026-Q3");
    expect(quarterStart("2026-11-15")).toBe("2026-10-01");
  });
});

describe("hours", () => {
  it("computes shift length net of the break, wrapping overnight", () => {
    expect(shiftHours("09:00", "18:00", 60)).toBe(8);
    expect(shiftHours("22:00", "06:00", 30)).toBe(7.5);
    expect(shiftHours("bad", "18:00", 0)).toBeNull();
    expect(shiftHours("09:00", "09:30", 60)).toBeNull();
  });

  it("counts a present day as shift + OT, a half day as half + OT, an off day as OT only", () => {
    expect(hoursForDay("PRESENT", 8, 2)).toBe(10);
    expect(hoursForDay("HALF_DAY", 8, 1)).toBe(5);
    expect(hoursForDay("WEEKLY_OFF", 8, 4)).toBe(4);
    expect(hoursForDay("ABSENT", 8, 0)).toBe(0);
  });

  it("flags weeks over 48 as a warning and over 60 as a failure", () => {
    const ok = weeklyHoursCheck(hoursBreaches(week("1", 8)), EMP);
    expect(ok).toMatchObject({ status: "PASS", count: 0 });

    const warn = weeklyHoursCheck(hoursBreaches(week("1", 9)), EMP); // 54 h, 9 h/day is not over 9
    expect(warn).toMatchObject({ status: "WARN", count: 1 });
    expect(warn.items[0]).toMatchObject({
      label: "E001 · Anbu",
      value: "54 h (week of 2026-09-07)",
    });

    const fail = weeklyHoursCheck(hoursBreaches([...week("1", 11), ...week("2", 8)]), EMP); // 66 h
    expect(fail).toMatchObject({ status: "FAIL", count: 1 });
  });

  it("flags days over 9 hours, only inside the period when one is given", () => {
    const days = week("1", [8, 8, 10, 8, 8, 8]);
    expect(dailyHoursCheck(hoursBreaches(days), EMP)).toMatchObject({ status: "WARN", count: 1 });
    const outside = hoursBreaches(days, { from: "2026-09-10", to: "2026-09-12" });
    expect(dailyHoursCheck(outside, EMP)).toMatchObject({ status: "PASS", count: 0 });
  });
});

describe("overtime quarterly cap", () => {
  it("passes under 80%, warns at 80% and fails past 125 hours or on a payroll breach", () => {
    expect(otCapCheck([{ employeeId: "1", quarter: "2026-Q3", hours: 40 }], EMP).status).toBe(
      "PASS"
    );
    expect(otCapCheck([{ employeeId: "1", quarter: "2026-Q3", hours: 100 }], EMP)).toMatchObject({
      status: "WARN",
      count: 0,
    });
    const fail = otCapCheck(
      [
        { employeeId: "1", quarter: "2026-Q3", hours: 130 },
        { employeeId: "2", quarter: "2026-Q3", hours: 20, payrollBreach: true },
      ],
      EMP
    );
    expect(fail).toMatchObject({ status: "FAIL", count: 2 });
    expect(fail.items[0].value).toBe("130 h OT in 2026-Q3");
  });
});

describe("minimum wage", () => {
  it("is not configured without a minimum, never a guess", () => {
    const c = minimumWageCheck([{ employeeId: "1", month: "2026-09", dailyRate: 100 }], null, EMP);
    expect(c).toMatchObject({ status: "NOT_CONFIGURED", count: null, items: [] });
  });

  it("fails for a daily rate below the minimum and passes otherwise", () => {
    const rows = [
      { employeeId: "1", month: "2026-09", dailyRate: 400 },
      { employeeId: "2", month: "2026-09", dailyRate: 520 },
    ];
    expect(minimumWageCheck(rows, 450, EMP)).toMatchObject({ status: "FAIL", count: 1 });
    expect(minimumWageCheck(rows, 400, EMP)).toMatchObject({ status: "PASS", count: 0 });
  });
});

describe("registers", () => {
  const month = (over: Partial<Parameters<typeof registersCheck>[0][number]>) => ({
    month: "2026-08",
    activeEmployees: 10,
    employeesWithoutAttendance: 0,
    attendanceRows: 250,
    payrollResults: 10,
    closed: true,
    ...over,
  });

  it("passes when the muster roll and wages register exist for each month", () => {
    expect(registersCheck([month({})])).toMatchObject({ status: "PASS", count: 0 });
  });

  it("warns on an incomplete muster roll and fails on a missing register", () => {
    expect(registersCheck([month({ employeesWithoutAttendance: 2 })])).toMatchObject({
      status: "WARN",
      count: 1,
    });
    const fail = registersCheck([
      month({ payrollResults: 0 }),
      month({ month: "2026-09", attendanceRows: 0, closed: false }),
    ]);
    expect(fail).toMatchObject({ status: "FAIL", count: 2 });
    expect(fail.items.map((i) => i.label)).toEqual([
      "Wages register · 2026-08",
      "Muster roll · 2026-09",
    ]);
  });

  it("does not ask for a wages register before the month closes, nor any with no employees", () => {
    expect(registersCheck([month({ payrollResults: 0, closed: false })]).status).toBe("PASS");
    expect(
      registersCheck([month({ activeEmployees: 0, attendanceRows: 0, payrollResults: 0 })]).status
    ).toBe("PASS");
  });
});

describe("findings and corrective actions", () => {
  const today = asDate("2026-09-28");

  it("moves an action forward only, skipping allowed, never back or to itself", () => {
    expect(canMoveAction("OPEN", "IN_PROGRESS")).toBe(true);
    expect(canMoveAction("OPEN", "DONE")).toBe(true);
    expect(canMoveAction("DONE", "VERIFIED")).toBe(true);
    expect(canMoveAction("DONE", "IN_PROGRESS")).toBe(false);
    expect(canMoveAction("VERIFIED", "OPEN")).toBe(false);
    expect(canMoveAction("OPEN", "OPEN")).toBe(false);
  });

  it("moves an audit forward only; cancelled and completed are final", () => {
    expect(canMoveAudit("PLANNED", "COMPLETED")).toBe(true);
    expect(canMoveAudit("IN_PROGRESS", "PLANNED")).toBe(false);
    expect(canMoveAudit("IN_PROGRESS", "CANCELLED")).toBe(true);
    expect(canMoveAudit("COMPLETED", "CANCELLED")).toBe(false);
    expect(canMoveAudit("CANCELLED", "PLANNED")).toBe(false);
  });

  it("knows overdue, due soon and an open finding", () => {
    expect(isOverdue({ status: "OPEN", dueDate: "2026-09-27" }, today)).toBe(true);
    expect(isOverdue({ status: "DONE", dueDate: "2026-09-01" }, today)).toBe(false);
    expect(isOverdue({ status: "OPEN", dueDate: "2026-09-28" }, today)).toBe(false);
    expect(isDueSoon({ status: "IN_PROGRESS", dueDate: "2026-10-05" }, today)).toBe(true);
    expect(isDueSoon({ status: "IN_PROGRESS", dueDate: "2026-10-06" }, today)).toBe(false);
    expect(isFindingOpen([])).toBe(true);
    expect(isFindingOpen([{ status: "DONE" }])).toBe(true);
    expect(isFindingOpen([{ status: "VERIFIED" }])).toBe(false);
  });

  it("fails on an open critical finding, warns on an open major, ignores minor", () => {
    const f = (severity: "CRITICAL" | "MAJOR" | "MINOR", verified = false) => ({
      id: severity,
      auditNo: "BSCI-1",
      severity,
      area: "WORKING_HOURS",
      description: "Excess hours",
      actions: verified ? [{ status: "VERIFIED" as const }] : [],
    });
    expect(openFindingsCheck([f("MINOR")])).toMatchObject({ status: "PASS", count: 0 });
    expect(openFindingsCheck([f("MAJOR"), f("CRITICAL", true)])).toMatchObject({
      status: "WARN",
      count: 1,
    });
    expect(openFindingsCheck([f("MAJOR"), f("CRITICAL")])).toMatchObject({
      status: "FAIL",
      count: 2,
    });
  });

  it("fails on an overdue action and warns on one due within a week", () => {
    const a = (dueDate: string, status: "OPEN" | "DONE" = "OPEN") => ({
      id: dueDate,
      auditNo: "WRAP-1",
      action: "Fix it",
      status,
      dueDate,
    });
    expect(overdueActionsCheck([a("2026-09-20", "DONE")], today).status).toBe("PASS");
    expect(overdueActionsCheck([a("2026-10-01")], today)).toMatchObject({
      status: "WARN",
      count: 0,
    });
    const fail = overdueActionsCheck([a("2026-09-20"), a("2026-10-01")], today);
    expect(fail).toMatchObject({ status: "FAIL", count: 1 });
    expect(fail.items[0].value).toBe("8d overdue");
  });
});

describe("score", () => {
  it("scores pass 1, warn ½, fail 0 and leaves not-configured checks out", () => {
    expect(
      readinessPercent([
        { status: "PASS" },
        { status: "WARN" },
        { status: "FAIL" },
        { status: "PASS" },
        { status: "NOT_CONFIGURED" },
      ])
    ).toBe(63);
    expect(readinessPercent([{ status: "NOT_CONFIGURED" }])).toBeNull();
    expect(readinessBand(90)).toBe("READY");
    expect(readinessBand(63)).toBe("AT_RISK");
    expect(readinessBand(40)).toBe("NOT_READY");
    expect(readinessBand(null)).toBeNull();
  });
});
