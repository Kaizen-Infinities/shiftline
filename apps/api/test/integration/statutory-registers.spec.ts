import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * The inspector's registers (P2T-03): muster roll, wages, overtime, deductions, fines and
 * advances, all derived from attendance and payroll data that already exists.
 *
 * One golden dataset covers muster roll, wages, overtime and deductions: an employee with a
 * July 2033 (31-day) attendance pattern and a matching payroll run. Fines and advances read a
 * date range directly, independent of any run, and get their own small fixtures.
 */
const sfx = Date.now().toString(36).slice(-6);
const n = (v: unknown) => Number(v);

let OWNER: { auth: Record<string, string> };
let EMPLOYEE_ID: string;
let RUN_ID: number;
let ADVANCE_ID: number;

describe("statutory registers", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();

    const employee = await asDemoTenant(() =>
      prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `SR-${sfx}`,
          fullName: "Register Test Employee",
          designation: "Fitter",
          status: "active",
          basicSalary: 20000,
          grossSalary: 31000,
          pfApplicable: true,
          esiApplicable: false,
        },
      })
    );
    EMPLOYEE_ID = String(employee.id);

    const setConfig = await (
      await api()
    )
      .put(`/api/payroll/employees/${employee.id}/config`)
      .set(OWNER.auth)
      .send({
        salaryType: "FIXED_MONTHLY",
        monthlySalary: 31000,
        basicSalary: 20000,
        da: 0,
        hra: 0,
        otherAllowance: 0,
        cashInHand: 0,
        paymentMode: "BANK",
      });
    expect(setConfig.status, JSON.stringify(setConfig.body).slice(0, 300)).toBe(200);

    // 27 PRESENT, 2 ABSENT, 2 HALF_DAY across July 2033's 31 days; three of the present days
    // carry 2 OT hours each (6 total).
    const statuses: Record<number, string> = {
      5: "ABSENT",
      12: "ABSENT",
      20: "HALF_DAY",
      21: "HALF_DAY",
    };
    const otDays = new Set([3, 10, 17]);
    const records = Array.from({ length: 31 }, (_, i) => {
      const day = i + 1;
      const date = `2033-07-${String(day).padStart(2, "0")}`;
      return {
        companyId: company.id,
        employeeId: employee.id,
        date,
        period: "2033-07",
        status: statuses[day] ?? "PRESENT",
        otHours: otDays.has(day) ? 2 : 0,
      };
    });
    await asDemoTenant(() => prisma.attendanceRecord.createMany({ data: records }));

    // A pending salary advance recovered by this run, plus a standing loan EMI and two "other"
    // permanent deductions — one of them a fine, so the same dataset feeds the fines register.
    const advance = await (
      await api()
    )
      .post("/api/payroll/advances")
      .set(OWNER.auth)
      .send({ employeeId: Number(employee.id), amount: 500, disbursedDate: "2033-07-10" });
    expect(advance.status).toBe(201);
    ADVANCE_ID = advance.body.data.id;

    await asDemoTenant(() =>
      prisma.employeePermanentDeduction.createMany({
        data: [
          { employeeId: employee.id, type: "LOAN_EMI", label: "Loan EMI", amount: 200 },
          { employeeId: employee.id, type: "UNIFORM", label: "Uniform deposit", amount: 100 },
          { employeeId: employee.id, type: "FINE", label: "Late reporting fine", amount: 50 },
        ],
      })
    );

    const run = await (
      await api()
    )
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: "2033-07",
        type: "MONTHLY",
        employeeCategory: "FIXED_MONTHLY",
        calendarDays: 31,
        attendance: [
          {
            employeeId: Number(employee.id),
            presentDays: 27,
            absentDays: 2,
            halfDays: 2,
            otHours: 6,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 500,
          },
        ],
      });
    expect(run.status, JSON.stringify(run.body).slice(0, 500)).toBe(201);
    RUN_ID = run.body.data.id;
    // Sanity check on the golden figures the registers below all key off.
    const result = run.body.data.results[0];
    expect(n(result.grossSalary)).toBe(29500); // 28000 earned + 1500 OT (6h * (1000/8) * 2)
    expect(n(result.netSalary)).toBe(26850); // 29500 - (1800 PF + 500 advance + 200 loan + 150 other)
  });

  it("the muster roll shows every day of the month and the right totals", async () => {
    const res = await (
      await api()
    )
      .get("/api/statutory-registers/muster-roll")
      .query({ period: "2033-07" })
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.days).toBe(31);
    const row = res.body.data.employees.find(
      (e: { employeeId: string }) => e.employeeId === EMPLOYEE_ID
    );
    expect(row.days).toHaveLength(31);
    expect(row.totals.PRESENT).toBe(27);
    expect(row.totals.ABSENT).toBe(2);
    expect(row.totals.HALF_DAY).toBe(2);
    const day3 = row.days.find((d: { date: string }) => d.date === "2033-07-03");
    expect(Number(day3.otHours)).toBe(2);
    const day5 = row.days.find((d: { date: string }) => d.date === "2033-07-05");
    expect(day5.status).toBe("ABSENT");
  });

  it("the wages register carries gross, deductions and net straight from the payroll run", async () => {
    const res = await (
      await api()
    )
      .get("/api/statutory-registers/wages")
      .query({ runId: RUN_ID })
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const row = res.body.data.employees.find(
      (e: { employeeId: string }) => e.employeeId === EMPLOYEE_ID
    );
    expect(row.daysPaid).toBe(28); // 27 present + 2 half days * 0.5
    expect(row.grossWages).toBe(29500);
    expect(row.totalDeductions).toBe(2650); // 1800 PF + 500 advance + 200 loan + 150 other
    expect(row.netWages).toBe(26850);
    expect(row.paymentMode).toBe("BANK");
  });

  it("the overtime register lists the three days worked and the wages the run paid for them", async () => {
    const res = await (
      await api()
    )
      .get("/api/statutory-registers/overtime")
      .query({ runId: RUN_ID })
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const row = res.body.data.employees.find(
      (e: { employeeId: string }) => e.employeeId === EMPLOYEE_ID
    );
    expect(row.days).toHaveLength(3);
    expect(row.days.map((d: { date: string }) => d.date).sort()).toEqual([
      "2033-07-03",
      "2033-07-10",
      "2033-07-17",
    ]);
    expect(row.totalOtHours).toBe(6);
    expect(row.otWagesPaid).toBe(1500); // the Labour Code figure: 6 * (1000/8) * 2
  });

  it("the deductions register itemises PF, the advance, the loan EMI and every other named deduction", async () => {
    const res = await (
      await api()
    )
      .get("/api/statutory-registers/deductions")
      .query({ runId: RUN_ID })
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const row = res.body.data.employees.find(
      (e: { employeeId: string }) => e.employeeId === EMPLOYEE_ID
    );
    expect(row.providentFund).toBe(1800);
    expect(row.esi).toBe(0);
    expect(row.salaryAdvance).toBe(500);
    expect(row.loanRecovery).toBe(200);
    expect(row.other).toHaveLength(2);
    const byType = Object.fromEntries(
      row.other.map((o: { type: string; amount: number }) => [o.type, o.amount])
    );
    expect(byType.UNIFORM).toBe(100);
    expect(byType.FINE).toBe(50);
    expect(row.total).toBe(2650);
  });

  it("the fines register finds the recorded fine within the date range and not outside it", async () => {
    const inRange = await (
      await api()
    )
      .get("/api/statutory-registers/fines")
      .query({ from: "2020-01-01", to: "2099-12-31" })
      .set(OWNER.auth);
    expect(inRange.status, JSON.stringify(inRange.body).slice(0, 300)).toBe(200);
    const row = inRange.body.data.rows.find(
      (r: { employeeCode: string }) => r.employeeCode === `SR-${sfx}`
    );
    expect(row.label).toBe("Late reporting fine");
    expect(row.amount).toBe(50);
    expect(row.isActive).toBe(true);

    const outOfRange = await (
      await api()
    )
      .get("/api/statutory-registers/fines")
      .query({ from: "1999-01-01", to: "1999-12-31" })
      .set(OWNER.auth);
    expect(
      outOfRange.body.data.rows.some(
        (r: { employeeCode: string }) => r.employeeCode === `SR-${sfx}`
      )
    ).toBe(false);
  });

  it("the advances register shows the disbursed amount as fully outstanding before recovery", async () => {
    const res = await (
      await api()
    )
      .get("/api/statutory-registers/advances")
      .query({ from: "2033-07-01", to: "2033-07-31" })
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const row = res.body.data.rows.find(
      (r: { employeeCode: string }) => r.employeeCode === `SR-${sfx}`
    );
    expect(row.amount).toBe(500);
    expect(row.recovered).toBe(0);
    expect(row.outstanding).toBe(500);
    expect(row.status).toBe("PENDING");
    void ADVANCE_ID;
  });

  it("refuses a role without the permission and hides another tenant's registers", async () => {
    const stores = await authed("demo.stores");
    const denied = await (
      await api()
    )
      .get("/api/statutory-registers/muster-roll")
      .query({ period: "2033-07" })
      .set(stores.auth);
    expect(denied.status).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Registers Tenant B", companyCode: `REGB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.payrollRun.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.payrollRun.count())).toBeGreaterThan(0);
  });
});
