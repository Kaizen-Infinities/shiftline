import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * Characterisation of the legacy payroll engine (`payroll.service.ts`), before (and now, since
 * P2T-02) Phase 2 touches anything near it. There is no per-route permission on this router today
 * — only the `payroll` plan feature gates it (`entitlements.spec.ts` already proves the 403 when a
 * tenant's plan lacks it) — so what this suite locks down is the arithmetic itself: how a monthly
 * and a daily-weekly employee are paid, and that a run is a one-shot per period/type/category.
 *
 * P2T-02 reconciled overtime with the Labour Code: an OT hour is now always paid at twice the
 * employee's ordinary hourly rate (`dailyRate / defaultWorkingHoursPerDay`), whatever
 * `PayrollConfig.otRatePerHour`/`otSlabs` say — those settings no longer decide the rate, only
 * `otEnabled` still gates whether OT is paid at all.
 */
const sfx = Date.now().toString(36).slice(-6);

const mkEmployee = async (
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  companyId: string,
  input: {
    empCode: string;
    fullName: string;
    basicSalary: number;
    pfApplicable?: boolean;
    esiApplicable?: boolean;
  }
) =>
  asDemoTenant(() =>
    prisma.employee.create({
      data: {
        companyId,
        empCode: input.empCode,
        fullName: input.fullName,
        status: "active",
        basicSalary: input.basicSalary,
        grossSalary: input.basicSalary,
        pfApplicable: input.pfApplicable ?? false,
        esiApplicable: input.esiApplicable ?? false,
      },
    })
  );

const setEmployeeConfig = async (
  auth: Record<string, string>,
  employeeId: bigint,
  body: object
) => {
  const res = await (
    await api()
  )
    .put(`/api/payroll/employees/${employeeId}/config`)
    .set(auth)
    .send(body);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
};

describe("legacy payroll engine", () => {
  it("pays a fixed-monthly employee LOP-adjusted, caps PF at the wage ceiling, excludes ESI above its ceiling, and pays overtime at the Labour Code's double rate", async () => {
    const OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();
    const employee = await mkEmployee(prisma, company.id, {
      empCode: `PR-A-${sfx}`,
      fullName: "Payroll Fixed Monthly",
      basicSalary: 20000,
      pfApplicable: true,
      esiApplicable: true,
    });
    await setEmployeeConfig(OWNER.auth, employee.id, {
      salaryType: "FIXED_MONTHLY",
      monthlySalary: 30000,
      basicSalary: 20000,
      da: 0,
      hra: 0,
      otherAllowance: 0,
      cashInHand: 0,
      paymentMode: "BANK",
    });

    const res = await (
      await api()
    )
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: `2032-04`,
        type: "MONTHLY",
        employeeCategory: "FIXED_MONTHLY",
        calendarDays: 30,
        attendance: [
          {
            employeeId: Number(employee.id),
            presentDays: 28,
            absentDays: 2,
            halfDays: 0,
            otHours: 5, // logged, but the default config pays no overtime — see below.
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    const run = res.body.data as { id: number; results: unknown[] };
    expect(run.results).toHaveLength(1);
    const result = run.results[0] as Record<string, unknown>;

    expect(Number(result.presentDays)).toBe(28);
    expect(Number(result.lopDays)).toBe(2);
    expect(Number(result.dailyRate)).toBe(1000); // 30000 / 30 calendar days
    expect(Number(result.earnedSalary)).toBe(28000); // 30000 - 2 * 1000
    // The Labour Code figure: ordinary hourly rate is dailyRate / 8h (the default shift length),
    // and overtime is twice that, however PayrollConfig.otRatePerHour is set (it defaults to 0
    // and is not read here at all any more).
    expect(Number(result.otHours)).toBe(5);
    expect(Number(result.otPay)).toBe(1250); // 5 * (1000 / 8) * 2
    expect(Number(result.grossSalary)).toBe(29250); // 28000 + 1250
    // PF at 12% of the BASIC-formula wage, capped at the ₹15,000 ceiling: 12% of 15,000, not 20,000.
    expect(Number(result.employeePf)).toBe(1800);
    // The employer's side is the full statutory cost since P2-02: 12% (EPS + EPF) plus 0.5% EDLI
    // and 0.5% admin charges on the same ₹15,000, so 1800 + 75 + 75.
    expect(Number(result.employerPf)).toBe(1950);
    // Gross (₹29,250) is over the ₹21,000 ESI ceiling, so no ESI at all despite esiApplicable.
    expect(Number(result.employeeEsi)).toBe(0);
    expect(Number(result.employerEsi)).toBe(0);
    // Professional tax is off company-wide by default and the employee carries no override.
    expect(Number(result.professionalTax)).toBe(0);
    expect(Number(result.netSalary)).toBe(27450); // 29250 - 1800

    // The payslip reads back the same figures.
    const slip = await (
      await api()
    )
      .get(`/api/payroll/runs/${run.id}/payslip/${(result as { id: number }).id}`)
      .set(OWNER.auth);
    expect(slip.status).toBe(200);
    expect(Number(slip.body.data.result.netSalary)).toBe(27450);
  });

  it("pays no overtime when otEnabled is switched off, whatever the hours logged", async () => {
    const OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();
    const employee = await mkEmployee(prisma, company.id, {
      empCode: `PR-D-${sfx}`,
      fullName: "Payroll OT Disabled",
      basicSalary: 20000,
    });
    await setEmployeeConfig(OWNER.auth, employee.id, {
      salaryType: "FIXED_MONTHLY",
      monthlySalary: 20000,
      basicSalary: 20000,
      da: 0,
      hra: 0,
      otherAllowance: 0,
      cashInHand: 0,
      paymentMode: "BANK",
    });
    const offConfig = await (
      await api()
    )
      .put("/api/payroll/config")
      .set(OWNER.auth)
      .send({ otEnabled: false });
    expect(offConfig.status).toBe(200);

    const res = await (
      await api()
    )
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: "2032-06",
        type: "MONTHLY",
        employeeCategory: "FIXED_MONTHLY",
        calendarDays: 30,
        attendance: [
          {
            employeeId: Number(employee.id),
            presentDays: 30,
            absentDays: 0,
            halfDays: 0,
            otHours: 10,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    const result = (res.body.data.results as Record<string, unknown>[])[0];
    expect(Number(result.otPay)).toBe(0);

    // Restore the switch so it does not leak into any test that runs after this one.
    await (await api()).put("/api/payroll/config").set(OWNER.auth).send({ otEnabled: true });
  });

  it("pays a daily-weekly employee only for days actually worked", async () => {
    const OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();
    const employee = await mkEmployee(prisma, company.id, {
      empCode: `PR-B-${sfx}`,
      fullName: "Payroll Daily Weekly",
      basicSalary: 15000,
    });
    await setEmployeeConfig(OWNER.auth, employee.id, {
      salaryType: "DAILY_WEEKLY",
      monthlySalary: 15000,
      basicSalary: 15000,
      da: 0,
      hra: 0,
      otherAllowance: 0,
      cashInHand: 0,
      paymentMode: "CASH",
    });

    // A DAILY_WEEKLY employee is only computable under a WEEKLY run: the filter excludes
    // "isWeekly" salary types from a MONTHLY run outright, whatever employeeCategory says.
    const res = await (
      await api()
    )
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: "2032-W17",
        type: "WEEKLY",
        employeeCategory: "DAILY_WEEKLY",
        calendarDays: 7,
        attendance: [
          {
            employeeId: Number(employee.id),
            presentDays: 5,
            absentDays: 1,
            halfDays: 0,
            otHours: 0,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    const result = (res.body.data.results as Record<string, unknown>[])[0];
    // A WEEKLY run always divides by six, whatever the calendar month holds.
    expect(Number(result.dailyRate)).toBe(2500); // 15000 / 6
    expect(Number(result.earnedSalary)).toBe(12500); // 2500 * 5 present days
    expect(Number(result.netSalary)).toBe(12500); // no PF/ESI: neither flag was set on this employee
  });

  it("refuses a second run for the same period, type and category", async () => {
    const OWNER = await authed("demo.owner");
    const res = await (await api()).post("/api/payroll/runs").set(OWNER.auth).send({
      period: "2032-04",
      type: "MONTHLY",
      employeeCategory: "FIXED_MONTHLY",
      calendarDays: 30,
      attendance: [],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/already exists/);
  });

  it("approves a run and recovers the employee's outstanding salary advance", async () => {
    const OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();
    const employee = await mkEmployee(prisma, company.id, {
      empCode: `PR-C-${sfx}`,
      fullName: "Payroll Advance",
      basicSalary: 10000,
    });
    await setEmployeeConfig(OWNER.auth, employee.id, {
      salaryType: "FIXED_MONTHLY",
      monthlySalary: 10000,
      basicSalary: 10000,
      da: 0,
      hra: 0,
      otherAllowance: 0,
      cashInHand: 0,
      paymentMode: "BANK",
    });
    const advance = await (
      await api()
    )
      .post("/api/payroll/advances")
      .set(OWNER.auth)
      .send({ employeeId: Number(employee.id), amount: 3000, disbursedDate: "2032-04-15" });
    expect(advance.status).toBe(201);

    const run = await (
      await api()
    )
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: "2032-05",
        type: "MONTHLY",
        employeeCategory: "FIXED_MONTHLY",
        calendarDays: 31,
        attendance: [
          {
            employeeId: Number(employee.id),
            presentDays: 31,
            absentDays: 0,
            halfDays: 0,
            otHours: 0,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 3000,
          },
        ],
      });
    expect(run.status, JSON.stringify(run.body).slice(0, 500)).toBe(201);
    const result = run.body.data.results[0] as { salaryAdvance: string; netSalary: string };
    expect(Number(result.salaryAdvance)).toBe(3000);
    expect(Number(result.netSalary)).toBe(7000); // 10000 - 3000, no PF/ESI on this employee

    const approved = await (
      await api()
    )
      .post(`/api/payroll/runs/${run.body.data.id}/approve`)
      .set(OWNER.auth);
    expect(approved.status).toBe(200);

    const row = await asDemoTenant(() =>
      prisma.salaryAdvance.findUniqueOrThrow({ where: { id: advance.body.data.id } })
    );
    expect(row.status).toBe("CLEARED");
    expect(Number(row.recoveredAmount)).toBe(3000);
  });

  it("hides another tenant's runs and refuses an unauthenticated request", async () => {
    const noAuth = await (await api()).get("/api/payroll/runs");
    expect(noAuth.status).toBe(401);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Payroll Tenant B", companyCode: `PRB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.payrollRun.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.payrollRun.count())).toBeGreaterThan(0);
  });
});
