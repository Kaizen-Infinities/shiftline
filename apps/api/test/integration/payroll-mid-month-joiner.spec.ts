import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * Mid-month joiners and leavers (QA C10 / PAY-B03): a monthly employee was paid the full month
 * when dateOfJoining fell inside the period, because the joining date never reached the
 * calculation. Days before joining and after relieving are now LOP, whatever attendance says.
 */
const sfx = Date.now().toString(36).slice(-6);
// October 2044 has 31 days, November 2044 has 30. No other suite uses these periods.
const OCT = "2044-10";
const NOV = "2044-11";

let OWNER: { auth: Record<string, string> };
let joinerLow: { id: bigint; empCode: string }; // joined 16 Oct, marked present for 14 days (the QA case)
let joinerFull: { id: bigint; empCode: string }; // joined 16 Oct, marked present every day (attendance says full month)
let fullMonth: { id: bigint; empCode: string }; // no joining or leaving date
let leaver: { id: bigint; empCode: string }; // on the rolls until 20 Nov

const mkEmp = (empCode: string, fullName: string, dates: { joined?: string; relieved?: string }) =>
  asDemoTenant(async () =>
    (await getPrisma()).employee.create({
      data: {
        companyId: (await demoCompany()).id,
        empCode,
        fullName,
        status: "active",
        basicSalary: 20000,
        grossSalary: 31000,
        dateOfJoining: dates.joined ? new Date(`${dates.joined}T12:00:00.000Z`) : null,
        relievingDate: dates.relieved ? new Date(`${dates.relieved}T12:00:00.000Z`) : null,
      },
    })
  );

const configure = async (employeeId: bigint, monthlySalary: number) => {
  const res = await (
    await api()
  )
    .put(`/api/payroll/employees/${employeeId}/config`)
    .set(OWNER.auth)
    .send({
      salaryType: "FIXED_MONTHLY",
      monthlySalary,
      basicSalary: 20000,
      paymentMode: "BANK",
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
};

const att = (employeeId: bigint, presentDays: number) => ({
  employeeId: Number(employeeId),
  presentDays,
  absentDays: 0,
  halfDays: 0,
  otHours: 0,
  lateMinutes: 0,
  permissionMinutes: 0,
  advance: 0,
});

const resultFor = (results: any[], empCode: string) => {
  const row = results.find((r: any) => r.employeeCode === empCode);
  expect(row, `no result for employee ${empCode}`).toBeDefined();
  return row;
};

describe("payroll mid-month joiner and leaver", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    joinerLow = await mkEmp(`MJ-L-${sfx}`, "Mid Month Joiner Low", { joined: "2044-10-16" });
    joinerFull = await mkEmp(`MJ-F-${sfx}`, "Mid Month Joiner Full", { joined: "2044-10-16" });
    fullMonth = await mkEmp(`MJ-M-${sfx}`, "Full Month Employee", {});
    leaver = await mkEmp(`MJ-X-${sfx}`, "Mid Month Leaver", { relieved: "2044-11-20" });
    await configure(joinerLow.id, 31000);
    await configure(joinerFull.id, 31000);
    await configure(fullMonth.id, 31000);
    await configure(leaver.id, 30000);
  });

  it("pays a 16 October joiner 16/31 of the month, however many days attendance shows", async () => {
    const client = await api();
    const res = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: OCT,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: 31,
        attendance: [
          att(joinerLow.id, 14), // days actually worked from joining, as an operator enters them
          att(joinerFull.id, 31), // attendance that wrongly counts pre-joining days as present
          att(fullMonth.id, 31),
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    const results = res.body.data.results as any[];

    const low = resultFor(results, joinerLow.empCode);
    expect(Number(low.lopDays)).toBe(15); // 1-15 October are before joining
    expect(Number(low.earnedSalary)).toBeCloseTo(16000, 2); // 31000 * 16 / 31

    const full = resultFor(results, joinerFull.empCode);
    expect(Number(full.earnedSalary)).toBeCloseTo(16000, 2);

    // Control: an employee with no joining date is still paid the whole month.
    const whole = resultFor(results, fullMonth.empCode);
    expect(Number(whole.lopDays)).toBe(0);
    expect(Number(whole.earnedSalary)).toBeCloseTo(31000, 2);
  });

  it("stops pay after the relieving date", async () => {
    const client = await api();
    const res = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: NOV,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: 30,
        attendance: [att(leaver.id, 20)],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    const row = resultFor(res.body.data.results as any[], leaver.empCode);
    // On the rolls 1-20 November: 20 of 30 days, so 30000 * 20 / 30.
    expect(Number(row.lopDays)).toBe(10);
    expect(Number(row.earnedSalary)).toBeCloseTo(20000, 2);
  });
});
