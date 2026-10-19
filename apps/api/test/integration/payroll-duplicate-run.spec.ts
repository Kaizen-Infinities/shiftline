import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * Duplicate payroll runs (QA C09 / PAY-B02): the duplicate guard compared employeeCategory, so an
 * ALL run and a FIXED_MONTHLY run for the same month were both accepted and the same employees
 * could be paid twice. The rule now: a run is refused when a live run for the same period and type
 * already covers any employee it would pay. Disjoint categories (FIXED_MONTHLY then CASH_MONTHLY)
 * still run side by side, and cancelling a DRAFT (deleting it) frees its employees again.
 */
const sfx = Date.now().toString(36).slice(-6);

let OWNER: { auth: Record<string, string> };
let fixedEmp: { id: bigint; empCode: string };
let cashEmp: { id: bigint; empCode: string };

const configure = async (employeeId: bigint, salaryType: string) => {
  const res = await (
    await api()
  )
    .put(`/api/payroll/employees/${employeeId}/config`)
    .set(OWNER.auth)
    .send({
      salaryType,
      monthlySalary: 30000,
      basicSalary: 20000,
      paymentMode: "BANK",
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
};

// A run pays only the employees it has attendance for, so each run names the fixtures it should pay.
const attendanceFor = (ids: bigint[]) =>
  ids.map((id) => ({
    employeeId: Number(id),
    presentDays: 30,
    absentDays: 0,
    halfDays: 0,
    otHours: 0,
    lateMinutes: 0,
    permissionMinutes: 0,
    advance: 0,
  }));

const runFor = async (period: string, employeeCategory: string, ids: bigint[]) =>
  (await api())
    .post("/api/payroll/runs")
    .set(OWNER.auth)
    .send({
      period,
      type: "MONTHLY",
      employeeCategory,
      calendarDays: 31,
      attendance: attendanceFor(ids),
    });

describe("payroll duplicate run guard", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const company = await demoCompany();
    const mk = (empCode: string, fullName: string) =>
      asDemoTenant(async () =>
        (await getPrisma()).employee.create({
          data: {
            companyId: company.id,
            empCode,
            fullName,
            status: "active",
            basicSalary: 20000,
            grossSalary: 30000,
          },
        })
      );
    fixedEmp = await mk(`DR-F-${sfx}`, "Duplicate Run Fixed");
    cashEmp = await mk(`DR-C-${sfx}`, "Duplicate Run Cash");
    await configure(fixedEmp.id, "FIXED_MONTHLY");
    await configure(cashEmp.id, "CASH_MONTHLY");
  });

  it("refuses a FIXED_MONTHLY run for a month an ALL run already covers", async () => {
    const all = await runFor("2044-03", "ALL", [fixedEmp.id, cashEmp.id]);
    expect(all.status, JSON.stringify(all.body).slice(0, 300)).toBe(201);

    const fixed = await runFor("2044-03", "FIXED_MONTHLY", [fixedEmp.id]);
    expect(fixed.status, JSON.stringify(fixed.body).slice(0, 300)).toBe(400);
    expect(String(fixed.body.message)).toMatch(/already covers/);
    expect(String(fixed.body.message)).toContain(all.body.data.runCode);
  });

  it("refuses an ALL run after a FIXED_MONTHLY run for the same month", async () => {
    const fixed = await runFor("2044-04", "FIXED_MONTHLY", [fixedEmp.id]);
    expect(fixed.status, JSON.stringify(fixed.body).slice(0, 300)).toBe(201);

    const all = await runFor("2044-04", "ALL", [fixedEmp.id, cashEmp.id]);
    expect(all.status).toBe(400);
    expect(String(all.body.message)).toMatch(/already covers/);
  });

  it("still refuses a repeat of the same category for the same month", async () => {
    const again = await runFor("2044-04", "FIXED_MONTHLY", [fixedEmp.id]);
    expect(again.status).toBe(400);
    expect(String(again.body.message)).toMatch(/already exists/);
  });

  it("allows a run for a different month", async () => {
    const res = await runFor("2044-05", "FIXED_MONTHLY", [fixedEmp.id]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  });

  it("allows disjoint categories in the same month", async () => {
    // 2044-06: the FIXED_MONTHLY run covers only the fixed employee, the CASH_MONTHLY run only the
    // cash employee, so neither run pays anyone the other one covers.
    const fixed = await runFor("2044-06", "FIXED_MONTHLY", [fixedEmp.id]);
    expect(fixed.status, JSON.stringify(fixed.body).slice(0, 300)).toBe(201);
    const cash = await runFor("2044-06", "CASH_MONTHLY", [cashEmp.id]);
    expect(cash.status, JSON.stringify(cash.body).slice(0, 300)).toBe(201);
  });

  it("allows the month again once the covering DRAFT run is cancelled", async () => {
    const all = await runFor("2044-07", "ALL", [fixedEmp.id, cashEmp.id]);
    expect(all.status, JSON.stringify(all.body).slice(0, 300)).toBe(201);
    const blocked = await runFor("2044-07", "FIXED_MONTHLY", [fixedEmp.id]);
    expect(blocked.status).toBe(400);

    const del = await (await api()).delete(`/api/payroll/runs/${all.body.data.id}`).set(OWNER.auth);
    expect(del.status, JSON.stringify(del.body).slice(0, 300)).toBe(200);

    const retry = await runFor("2044-07", "FIXED_MONTHLY", [fixedEmp.id]);
    expect(retry.status, JSON.stringify(retry.body).slice(0, 300)).toBe(201);
  });
});
