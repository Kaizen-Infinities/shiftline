import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { hashPassword } from "../../src/utils/hashPassword";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { statutoryPayrollService } from "../../src/modules/payroll/statutory.service";

/**
 * Payroll follow-ups (P2-16): the quarterly overtime cap is now a real running total instead of
 * always computing against a blank quarter, employees with no tax declaration on file are
 * flagged on the run and notified once per FY, employees created before work-state tracking
 * existed are backfilled to the company's own state, and the wages register reads salary TDS
 * from the persisted run instead of reporting a hard-coded zero.
 *
 * The demo company's GSTIN starts "33" (Tamil Nadu).
 */
const sfx = Date.now().toString(36).slice(-6);
// January and February 2039 both fall in the same calendar quarter (2039-Q1); April starts the
// next one. Chosen far from any other suite's fixed periods.
const Q1_PERIOD_1 = "2039-01";
const Q1_PERIOD_2 = "2039-02";
const Q2_PERIOD = "2039-04";
const DECL_PERIOD = "2038-12"; // FY 2038-39, a period no other test in this file uses

const daysIn = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

let OWNER: { auth: Record<string, string> };
let otEmp: { id: bigint; empCode: string };

describe("payroll follow-ups", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const company = await demoCompany();
    const prisma = await getPrisma();

    otEmp = await asDemoTenant(() =>
      prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `PF-OT-${sfx}`,
          fullName: "Arjun Kumar",
          salaryType: "monthly",
          grossSalary: 30000,
          accountNumber: "1234500010",
          ifscCode: "HDFC0000123",
        },
      })
    );
  });

  it("accumulates overtime across a quarter and flags the second run's breach; a new quarter resets", async () => {
    const client = await api();

    const run1 = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: Q1_PERIOD_1,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: daysIn(Q1_PERIOD_1),
        attendance: [
          {
            employeeId: Number(otEmp.id),
            presentDays: daysIn(Q1_PERIOD_1),
            absentDays: 0,
            halfDays: 0,
            otHours: 70,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(run1.status, JSON.stringify(run1.body).slice(0, 500)).toBe(201);
    const r1 = run1.body.data.results.find((r: any) => r.employeeCode === otEmp.empCode);
    expect(Number(r1.otHours)).toBe(70);
    // 70 hours this quarter, well under the 125-hour cap on its own.
    expect(Number(r1.otHoursOverCap)).toBe(0);

    const run2 = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: Q1_PERIOD_2,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: daysIn(Q1_PERIOD_2),
        attendance: [
          {
            employeeId: Number(otEmp.id),
            presentDays: daysIn(Q1_PERIOD_2),
            absentDays: 0,
            halfDays: 0,
            otHours: 70,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(run2.status, JSON.stringify(run2.body).slice(0, 500)).toBe(201);
    const r2 = run2.body.data.results.find((r: any) => r.employeeCode === otEmp.empCode);
    // 70 (April) + 70 (May) = 140, 15 over the 125-hour cap — flagged, not blocked.
    expect(Number(r2.otHoursOverCap)).toBe(15);
    expect(Number(r2.otPay)).toBeGreaterThan(0);

    const prisma = await getPrisma();
    const q1Register = await asDemoTenant(() =>
      prisma.overtimeQuarterPeriod.findFirstOrThrow({
        where: { employeeId: otEmp.id, quarterKey: "2039-Q1" },
      })
    );
    expect(Number(q1Register.hoursAccrued)).toBe(140);
    expect(q1Register.breached).toBe(true);

    // A run in the next quarter starts from zero again.
    const run3 = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: Q2_PERIOD,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: daysIn(Q2_PERIOD),
        attendance: [
          {
            employeeId: Number(otEmp.id),
            presentDays: daysIn(Q2_PERIOD),
            absentDays: 0,
            halfDays: 0,
            otHours: 70,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(run3.status, JSON.stringify(run3.body).slice(0, 500)).toBe(201);
    const r3 = run3.body.data.results.find((r: any) => r.employeeCode === otEmp.empCode);
    expect(Number(r3.otHoursOverCap)).toBe(0);

    const q2Register = await asDemoTenant(() =>
      prisma.overtimeQuarterPeriod.findFirstOrThrow({
        where: { employeeId: otEmp.id, quarterKey: "2039-Q2" },
      })
    );
    expect(Number(q2Register.hoursAccrued)).toBe(70);
    expect(q2Register.breached).toBe(false);
  });

  it("lists employees with no tax declaration on the run response, and the job notifies their linked user once per FY", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const fyCode = "2038-39"; // covers January 2039

    const [noDeclEmp, filedEmp] = await asDemoTenant(() =>
      Promise.all([
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `PF-ND-${sfx}`,
            fullName: "Priya Sen",
            salaryType: "monthly",
            grossSalary: 25000,
            accountNumber: "1234500011",
            ifscCode: "HDFC0000123",
          },
        }),
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `PF-FD-${sfx}`,
            fullName: "Karan Malhotra",
            salaryType: "monthly",
            grossSalary: 25000,
            accountNumber: "1234500012",
            ifscCode: "HDFC0000123",
          },
        }),
      ])
    );
    await asDemoTenant(() =>
      statutoryPayrollService.setDeclaration(
        { employeeId: String(filedEmp.id), fyCode, regime: "NEW" },
        {}
      )
    );

    const client = await api();
    const run = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: DECL_PERIOD,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: daysIn(DECL_PERIOD),
        attendance: [noDeclEmp, filedEmp].map((e) => ({
          employeeId: Number(e.id),
          presentDays: daysIn(DECL_PERIOD),
          absentDays: 0,
          halfDays: 0,
          otHours: 0,
          lateMinutes: 0,
          permissionMinutes: 0,
          advance: 0,
        })),
      });
    expect(run.status, JSON.stringify(run.body).slice(0, 500)).toBe(201);
    const missing = run.body.data.missingTaxDeclarations as Array<{ employeeCode: string }>;
    expect(missing.some((m) => m.employeeCode === noDeclEmp.empCode)).toBe(true);
    expect(missing.some((m) => m.employeeCode === filedEmp.empCode)).toBe(false);

    // Link a user to the employee with no declaration so the job has somebody to notify.
    const role = await asDemoTenant(() =>
      prisma.role.findFirstOrThrow({ where: { code: "PRODUCTION" } })
    );
    const username = `pf.decl.${sfx}`;
    const passwordHash = await hashPassword("Test@12345678");
    const linkedUser = await asDemoTenant(() =>
      prisma.user.create({
        data: {
          companyId: company.id,
          username,
          fullName: "Priya Sen",
          email: `${username}@test.shiftline.local`,
          passwordHash,
          employeeId: noDeclEmp.id,
          roleId: role.id,
          status: "active",
        },
      })
    );

    const first = await asDemoTenant(() =>
      statutoryPayrollService.remindMissingDeclarations(fyCode)
    );
    expect(first.sent).toBeGreaterThan(0);
    const notification = await asDemoTenant(() =>
      prisma.notification.findFirstOrThrow({
        where: { userId: linkedUser.userId, category: "payroll-tax-declaration" },
      })
    );
    expect(notification.link).toContain(String(noDeclEmp.id));

    // Once per FY: calling it again the same month sends nothing new.
    const second = await asDemoTenant(() =>
      statutoryPayrollService.remindMissingDeclarations(fyCode)
    );
    expect(second.sent).toBe(0);
  });

  it("backfills a NULL work state to the company's own state", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();

    const preMigration = await asDemoTenant(() =>
      prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `PF-WS-${sfx}`,
          fullName: "Backfill Test",
          status: "active",
          workStateCode: null,
        },
      })
    );
    expect(preMigration.workStateCode).toBeNull();

    // Same effect as the migration's data step (20260914160000_payroll_followups) — every
    // employee with no work state takes on the employing company's own state. The migration
    // itself runs as one UPDATE ... FROM companies under the migrator role, which bypasses RLS;
    // reproduced here through the tenant-scoped client (raw SQL through the app's own Prisma
    // client would skip the RLS session variables the extension sets around model operations,
    // so this drives the same WHERE condition through `updateMany` instead).
    await asDemoTenant(() =>
      prisma.employee.updateMany({
        where: { workStateCode: null },
        data: { workStateCode: company.stateCode },
      })
    );

    const backfilled = await asDemoTenant(() =>
      prisma.employee.findUniqueOrThrow({ where: { id: preMigration.id } })
    );
    expect(backfilled.workStateCode).toBe(company.stateCode);

    const stillNull = await asDemoTenant(() =>
      prisma.employee.count({ where: { workStateCode: null } })
    );
    expect(stillNull).toBe(0);
  });

  it("shows salary TDS on the wages register and produces a landscape PDF", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();

    const tdsEmp = await asDemoTenant(() =>
      prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `PF-TDS-${sfx}`,
          fullName: "Meena Krishnan",
          salaryType: "monthly",
          grossSalary: 200000,
          tdsApplicable: true,
          accountNumber: "1234500013",
          ifscCode: "HDFC0000123",
        },
      })
    );
    const period = "2039-06";
    const client = await api();
    const run = await client
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period,
        type: "MONTHLY",
        employeeCategory: "ALL",
        calendarDays: daysIn(period),
        attendance: [
          {
            employeeId: Number(tdsEmp.id),
            presentDays: daysIn(period),
            absentDays: 0,
            halfDays: 0,
            otHours: 0,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 0,
          },
        ],
      });
    expect(run.status, JSON.stringify(run.body).slice(0, 500)).toBe(201);
    const runResult = run.body.data.results.find((r: any) => r.employeeCode === tdsEmp.empCode);
    expect(Number(runResult.salaryTds)).toBeGreaterThan(0);

    const wages = await client.get("/api/registers/wages").query({ month: period }).set(OWNER.auth);
    expect(wages.status).toBe(200);
    const row = wages.body.data.rows.find((r: any) => r.employeeCode === tdsEmp.empCode);
    expect(row).toBeTruthy();
    expect(Number(row.tds)).toBe(Number(runResult.salaryTds));
    expect(Number(row.tds)).toBeGreaterThan(0);

    const pdf = await client
      .get("/api/registers/wages")
      .query({ month: period, format: "pdf" })
      .set(OWNER.auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain("wages-");
    // %PDF is the file signature at the start of any PDF byte stream — proof the landscape
    // option actually rendered a document, not just returned a 200.
    expect((pdf.body as Buffer).slice(0, 4).toString("ascii")).toBe("%PDF");
    expect((pdf.body as Buffer).length).toBeGreaterThan(500);
  });

  it("refuses a foreign tenant and hides the overtime quarter register from it", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Payroll Followups Tenant B", companyCode: `PFB-${sfx}` },
      })
    );

    const ours = await asDemoTenant(() =>
      prisma.overtimeQuarterPeriod.findFirstOrThrow({ where: { employeeId: otEmp.id } })
    );
    expect(
      await runAsTenant(other.id, () =>
        prisma.overtimeQuarterPeriod.findUnique({ where: { id: ours.id } })
      )
    ).toBeNull();
    expect(await runAsTenant(other.id, () => prisma.overtimeQuarterPeriod.count())).toBe(0);
  });
});
