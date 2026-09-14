import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * Payroll reconciliation (P2-02): the run itself calls the statutory and Labour Code
 * calculators, instead of computing PF/ESI/PT/OT a second time with the old engine's own
 * arithmetic. What is proved here is the golden numbers: net pay actually reflects professional
 * tax and salary TDS, overtime is paid once at double wages, ESI eligibility survives a wage
 * rise mid-period, and two employees in different states pay different professional tax in the
 * same run.
 *
 * The demo company's GSTIN starts "33", so its own state is Tamil Nadu.
 */
const sfx = Date.now().toString(36).slice(-6);
const MAIN_PERIOD = "2037-08"; // August — 31 days, not February (Maharashtra's special month)
const ESI_PERIOD_1 = "2037-04"; // April — first month of the Apr-Sep contribution half-year
const ESI_PERIOD_2 = "2037-05"; // May — second month of the same half-year

const daysIn = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

let OWNER: { auth: Record<string, string> };
let empA: { id: bigint; empCode: string }; // Tamil Nadu, above the TDS threshold
let empTn: { id: bigint; empCode: string }; // Tamil Nadu, ₹30,000
let empMh: { id: bigint; empCode: string }; // Maharashtra, ₹30,000 — same gross as empTn
let empOt: { id: bigint; empCode: string }; // overtime only, no statutory deductions
let empEsi: { id: bigint; empCode: string }; // crosses the ESI limit in the period's second month

describe("payroll reconciliation", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const company = await demoCompany();
    const prisma = await getPrisma();

    const created = await asDemoTenant(() =>
      Promise.all([
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `PR-A-${sfx}`,
            fullName: "Kavitha Iyer",
            salaryType: "monthly",
            grossSalary: 150000,
            basicSalary: 75000,
            pfApplicable: true,
            esiApplicable: true,
            professionalTax: true,
            tdsApplicable: true,
            accountNumber: "1234500001",
            ifscCode: "HDFC0000123",
          },
        }),
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `PR-TN-${sfx}`,
            fullName: "Suresh Babu",
            salaryType: "monthly",
            grossSalary: 30000,
            professionalTax: true,
            accountNumber: "1234500002",
            ifscCode: "HDFC0000123",
          },
        }),
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `PR-MH-${sfx}`,
            fullName: "Rohan Deshmukh",
            salaryType: "monthly",
            grossSalary: 30000,
            workStateCode: "27",
            professionalTax: true,
            accountNumber: "1234500003",
            ifscCode: "HDFC0000123",
          },
        }),
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `PR-OT-${sfx}`,
            fullName: "Manoj Pillai",
            salaryType: "monthly",
            grossSalary: 20000,
            accountNumber: "1234500004",
            ifscCode: "HDFC0000123",
          },
        }),
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `PR-ESI-${sfx}`,
            fullName: "Divya Nair",
            salaryType: "monthly",
            grossSalary: 20000,
            esiApplicable: true,
            accountNumber: "1234500005",
            ifscCode: "HDFC0000123",
          },
        }),
      ])
    );
    [empA, empTn, empMh, empOt, empEsi] = created;
  });

  it("reconciles net pay: gross + OT − employee PF − employee ESI − PT − salary TDS", async () => {
    const res = await (
      await api()
    )
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: MAIN_PERIOD,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: daysIn(MAIN_PERIOD),
        attendance: [empA, empTn, empMh, empOt].map((e) => ({
          employeeId: Number(e.id),
          presentDays: daysIn(MAIN_PERIOD),
          absentDays: 0,
          halfDays: 0,
          otHours: e === empOt ? 4 : 0,
          lateMinutes: 0,
          permissionMinutes: 0,
          advance: 0,
        })),
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    const results = res.body.data.results as Array<Record<string, unknown>>;

    const a = results.find((r) => r.employeeCode === empA.empCode)!;
    // 12% employee PF on the ₹15,000 wage ceiling (basic ₹75,000, capped).
    expect(Number(a.employeePf)).toBe(1800);
    // Gross ₹150,000 is well above the ESI limit, so nothing is taken.
    expect(Number(a.employeeEsi)).toBe(0);
    // Tamil Nadu's top slab.
    expect(Number(a.professionalTax)).toBe(1250);
    // A twelfth of the year's tax on ₹18,00,000 under the new regime (no declaration).
    expect(Number(a.salaryTds)).toBeCloseTo(12566.67, 2);
    expect(Number(a.netSalary)).toBe(134390);
    // totalDeductions is exactly PF + ESI + PT + TDS here (no late/permission/advance/loan/other),
    // and net is gross less that total, rounded up to the nearest ₹10.
    expect(Number(a.totalDeductions)).toBeCloseTo(
      Number(a.employeePf) +
        Number(a.employeeEsi) +
        Number(a.professionalTax) +
        Number(a.salaryTds),
      2
    );
    const rawNet = Number(a.grossSalary) - Number(a.totalDeductions);
    expect(Number(a.netSalary)).toBe(Math.ceil(rawNet / 10) * 10);
  });

  it("charges different professional tax for the same wage in two different states", async () => {
    const prisma = await getPrisma();
    const results = await asDemoTenant(() =>
      prisma.payrollResult.findMany({
        where: { employeeId: { in: [empTn.id, empMh.id] }, payrollRun: { period: MAIN_PERIOD } },
      })
    );
    const tn = results.find((r) => r.employeeId === empTn.id)!;
    const mh = results.find((r) => r.employeeId === empMh.id)!;
    expect(Number(tn.professionalTax)).toBe(135); // Tamil Nadu's ₹21,000–30,000 slab
    expect(Number(mh.professionalTax)).toBe(200); // Maharashtra's flat slab outside February
    expect(Number(tn.professionalTax)).not.toBe(Number(mh.professionalTax));
  });

  it("pays overtime once, at double the ordinary hourly rate — not the old flat-rate engine", async () => {
    const prisma = await getPrisma();
    const result = await asDemoTenant(() =>
      prisma.payrollResult.findFirstOrThrow({
        where: { employeeId: empOt.id, payrollRun: { period: MAIN_PERIOD } },
      })
    );
    const days = daysIn(MAIN_PERIOD);
    const dailyRate = 20000 / days;
    const ordinaryHourlyRate = dailyRate / 8;
    const expectedOtPay = Math.round(ordinaryHourlyRate * 4 * 2 * 100) / 100;
    expect(Number(result.otPay)).toBeCloseTo(expectedOtPay, 2);
    expect(Number(result.otHours)).toBe(4);
    // Gross carries the OT pay exactly once.
    expect(Number(result.grossSalary)).toBeCloseTo(20000 + expectedOtPay, 2);
  });

  it("keeps ESI eligibility fixed for the contribution period once the employee crosses the limit", async () => {
    const client = await api();
    const days1 = daysIn(ESI_PERIOD_1);
    const first = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: ESI_PERIOD_1,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: days1,
        attendance: [
          {
            employeeId: Number(empEsi.id),
            presentDays: days1,
            absentDays: 0,
            halfDays: 0,
            otHours: 0,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(first.status, JSON.stringify(first.body).slice(0, 500)).toBe(201);
    const r1 = first.body.data.results[0];
    expect(r1.esiApplicable).toBe(true);
    expect(Number(r1.grossSalary)).toBe(20000);
    expect(Number(r1.employeeEsi)).toBe(150); // 0.75% of ₹20,000, rounded up

    // The second month: overtime pushes gross above the ₹21,000 limit, but the half-year's
    // decision was already made in April.
    const days2 = daysIn(ESI_PERIOD_2);
    const second = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: ESI_PERIOD_2,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: days2,
        attendance: [
          {
            employeeId: Number(empEsi.id),
            presentDays: days2,
            absentDays: 0,
            halfDays: 0,
            otHours: 10,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(second.status, JSON.stringify(second.body).slice(0, 500)).toBe(201);
    const r2 = second.body.data.results[0];
    expect(Number(r2.grossSalary)).toBeGreaterThan(21000);
    expect(r2.esiApplicable).toBe(true);
    expect(Number(r2.employeeEsi)).toBeGreaterThan(0);

    // The decision itself is on record, not re-derived.
    const prisma = await getPrisma();
    const period = await asDemoTenant(() =>
      prisma.esiContributionPeriod.findFirstOrThrow({
        where: { employeeId: empEsi.id, periodKey: "2037-H1" },
      })
    );
    expect(period.eligible).toBe(true);
    expect(Number(period.wageAtStart)).toBe(20000);
  });

  it("refuses a foreign tenant and hides the run and the ESI period decision from it", async () => {
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Payroll Tenant B", companyCode: `PRB-${sfx}` },
      })
    );

    const ourResult = await asDemoTenant(() =>
      prisma.payrollResult.findFirstOrThrow({
        where: { employeeId: empA.id, payrollRun: { period: MAIN_PERIOD } },
      })
    );

    expect(
      await runAsTenant(other.id, () =>
        prisma.payrollResult.findUnique({ where: { id: ourResult.id } })
      )
    ).toBeNull();
    expect(await runAsTenant(other.id, () => prisma.payrollResult.count())).toBe(0);
    expect(
      await runAsTenant(other.id, () =>
        prisma.esiContributionPeriod.findFirst({ where: { employeeId: empEsi.id } })
      )
    ).toBeNull();
    expect(await runAsTenant(other.id, () => prisma.esiContributionPeriod.count())).toBe(0);
  });
});
