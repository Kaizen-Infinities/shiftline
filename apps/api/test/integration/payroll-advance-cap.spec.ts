import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createSalaryAdvance, demoCompany } from "../factories";

/**
 * Advance deduction cap (QA C11 / PAY-B04): a run deducted 9,000 from an employee who owed 5,000.
 * Net pay dropped by 9,000, but approval recorded only the 5,000 that was outstanding, so 4,000
 * left the employee's pay and was recorded nowhere. A run now refuses a deduction above the
 * outstanding advance, and an amount within it is the same figure for net pay and recovery.
 */
const sfx = Date.now().toString(36).slice(-6);
// February 2045 (28 days). No other suite uses it.
const PERIOD = "2045-02";

let OWNER: { auth: Record<string, string> };
let employee: { id: bigint; empCode: string };
let advanceId: number;

const runWith = async (advance: number) =>
  (await api())
    .post("/api/payroll/runs")
    .set(OWNER.auth)
    .send({
      period: PERIOD,
      type: "MONTHLY",
      employeeCategory: "FIXED_MONTHLY",
      calendarDays: 28,
      attendance: [
        {
          employeeId: Number(employee.id),
          presentDays: 28,
          absentDays: 0,
          halfDays: 0,
          otHours: 0,
          lateMinutes: 0,
          permissionMinutes: 0,
          advance,
        },
      ],
    });

describe("payroll advance deduction cap", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const company = await demoCompany();
    employee = await asDemoTenant(async () =>
      (await getPrisma()).employee.create({
        data: {
          companyId: company.id,
          empCode: `ADV-${sfx}`,
          fullName: "Advance Cap Employee",
          status: "active",
          basicSalary: 10000,
          grossSalary: 10000,
        },
      })
    );
    const cfg = await (
      await api()
    )
      .put(`/api/payroll/employees/${employee.id}/config`)
      .set(OWNER.auth)
      .send({
        salaryType: "FIXED_MONTHLY",
        monthlySalary: 10000,
        basicSalary: 10000,
        da: 0,
        hra: 0,
        otherAllowance: 0,
        cashInHand: 0,
        paymentMode: "BANK",
      });
    expect(cfg.status).toBe(200);
    const adv = await createSalaryAdvance({
      employeeId: employee.id,
      amount: 5000,
      disbursedDate: new Date("2045-01-15T12:00:00.000Z"),
    });
    advanceId = adv.id;
  });

  it("refuses a deduction above the outstanding advance and creates no run", async () => {
    const res = await runWith(9000);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(String(res.body.message)).toMatch(/outstanding advance \(5000\)/);
    expect(String(res.body.message)).toContain(employee.empCode);
  });

  it("deducts exactly the outstanding amount and recovers the same amount at approval", async () => {
    const res = await runWith(5000);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const row = res.body.data.results[0] as { salaryAdvance: string; netSalary: string };
    expect(Number(row.salaryAdvance)).toBe(5000);
    expect(Number(row.netSalary)).toBe(5000); // 10000 gross - 5000 recovered, nothing else on this employee

    const approved = await (
      await api()
    )
      .post(`/api/payroll/runs/${res.body.data.id}/approve`)
      .set(OWNER.auth);
    expect(approved.status).toBe(200);

    const advance = await asDemoTenant(async () =>
      (await getPrisma()).salaryAdvance.findUniqueOrThrow({ where: { id: advanceId } })
    );
    expect(advance.status).toBe("CLEARED");
    expect(Number(advance.recoveredAmount)).toBe(5000);
  });
});
