import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import {
  asDemoTenant,
  createAttendanceRecord,
  createEmployee,
  createFineDeduction,
  createPayrollResult,
  createPayrollRun,
  createSalaryAdvance,
  demoCompany,
} from "../factories";

/**
 * The inspector's registers (P2-03): muster roll, wages, overtime, fines, deductions and
 * advances, read from attendance and payroll rows a factory writes directly — the module never
 * computes payroll itself.
 */
const sfx = Date.now().toString(36).slice(-5);
const MONTH = "2031-03"; // a month no other suite touches
const D1 = `${MONTH}-01`;
const D2 = `${MONTH}-02`;
const D3 = `${MONTH}-03`;

let OWNER: { auth: Record<string, string> };
let empId: bigint;
let empCode: string;
let runId: number;

describe("inspector's registers", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");

    const employee = await createEmployee({ empCode: `REG-${sfx}`, fullName: "Kavya Register" });
    empId = employee.id;
    empCode = employee.empCode;

    await createAttendanceRecord({ employeeId: empId, date: D1, status: "PRESENT", otHours: 2 });
    await createAttendanceRecord({ employeeId: empId, date: D2, status: "ABSENT" });
    await createAttendanceRecord({ employeeId: empId, date: D3, status: "WEEKLY_OFF" });

    const run = await createPayrollRun({
      period: MONTH,
      type: "MONTHLY",
      status: "APPROVED",
      approvedAt: new Date(),
    });
    runId = run.id;
    await createPayrollResult({
      payrollRunId: run.id,
      employeeId: empId,
      employeeCode: empCode,
      presentDays: 1,
      dailyRate: 1000,
      earnedSalary: 1000,
      grossSalary: 1200,
      otPay: 200,
      employeePf: 120,
      employeeEsi: 9,
      professionalTax: 200,
      salaryAdvance: 100,
      otherDeductions: 10,
      netSalary: 761,
      paymentMode: "BANK",
    });

    await createSalaryAdvance({
      employeeId: empId,
      amount: 500,
      disbursedDate: new Date(`${D1}T00:00:00Z`),
      reason: "Medical emergency",
    });

    await createFineDeduction({
      employeeId: empId,
      kind: "FINE",
      occurredOn: new Date(`${D2}T00:00:00Z`),
      cause: "Reported late without notice",
      amount: 50,
      shownCauseGiven: true,
    });
    await createFineDeduction({
      employeeId: empId,
      kind: "DEDUCTION",
      occurredOn: new Date(`${D2}T00:00:00Z`),
      cause: "Damaged raw material by negligence",
      amount: 75,
      shownCauseGiven: false,
    });
  });

  it("muster roll marks P/A/WO for the days recorded and totals them", async () => {
    const res = await (
      await api()
    )
      .get("/api/registers/muster-roll")
      .query({ month: MONTH })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: any) => r.employeeCode === empCode);
    expect(row).toBeTruthy();
    expect(row.days[0].code).toBe("P");
    expect(row.days[0].otHours).toBe(2);
    expect(row.days[1].code).toBe("A");
    expect(row.days[2].code).toBe("WO");
    expect(row.totals).toMatchObject({ present: 1, absent: 1, weekOff: 1, otHours: 2 });
  });

  it("muster roll CSV export has a header row", async () => {
    const res = await (
      await api()
    )
      .get("/api/registers/muster-roll")
      .query({ month: MONTH, format: "csv" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const firstLine = res.text.split("\r\n")[0];
    expect(firstLine).toContain("Code");
    expect(firstLine).toContain("Name");
    expect(res.text).toContain(empCode);
  });

  it("wages register reads gross, deductions and net from the persisted payroll result", async () => {
    const res = await (
      await api()
    )
      .get("/api/registers/wages")
      .query({ month: MONTH })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: any) => r.employeeCode === empCode);
    expect(row).toBeTruthy();
    expect(row.gross).toBe(1200);
    expect(row.pf).toBe(120);
    expect(row.esi).toBe(9);
    expect(row.professionalTax).toBe(200);
    expect(row.advancesRecovered).toBe(100);
    expect(row.fines).toBe(50);
    expect(row.net).toBe(761);
    expect(row.paymentMode).toBe("BANK");
  });

  it("overtime register computes double the normal rate and the quarter's cumulative hours", async () => {
    const res = await (
      await api()
    )
      .get("/api/registers/overtime")
      .query({ month: MONTH })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: any) => r.employeeCode === empCode);
    expect(row).toBeTruthy();
    expect(row.otHours).toBe(2);
    expect(row.otRate).toBe(row.normalRate * 2);
    expect(row.cumulativeQuarterHours).toBeGreaterThanOrEqual(2);
    expect(row.quarterlyCap).toBe(125);
  });

  it("fines register lists the incident, respects the 3% ceiling check and totals", async () => {
    const res = await (
      await api()
    )
      .get("/api/registers/fines")
      .query({ from: `${MONTH}-01`, to: `${MONTH}-28` })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: any) => r.employeeCode === empCode);
    expect(row).toBeTruthy();
    expect(row.amount).toBe(50);
    expect(row.shownCauseGiven).toBe(true);
    expect(res.body.data.total).toBeGreaterThanOrEqual(50);
    const check = res.body.data.ceilingChecks.find((c: any) => c.employeeCode === empCode);
    expect(check).toBeTruthy();
    // 3% of 1200 gross = 36; a 50 fine breaches it.
    expect(check.wageCeiling).toBe(36);
    expect(check.breach).toBe(true);
  });

  it("deductions register lists damage/loss deductions separately from fines", async () => {
    const res = await (
      await api()
    )
      .get("/api/registers/deductions")
      .query({ from: `${MONTH}-01`, to: `${MONTH}-28` })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: any) => r.employeeCode === empCode);
    expect(row).toBeTruthy();
    expect(row.amount).toBe(75);
    expect(row.shownCauseGiven).toBe(false);
  });

  it("advances register shows the balance outstanding", async () => {
    const res = await (
      await api()
    )
      .get("/api/registers/advances")
      .query({ from: `${MONTH}-01`, to: `${MONTH}-28` })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: any) => r.employeeCode === empCode);
    expect(row).toBeTruthy();
    expect(row.amount).toBe(500);
    expect(row.balance).toBe(500);
    expect(row.purpose).toBe("Medical emergency");
  });

  it("rejects a malformed month and an inverted date range", async () => {
    const client = await api();
    const badMonth = await client
      .get("/api/registers/wages")
      .query({ month: "2031-3" })
      .set(OWNER.auth);
    expect(badMonth.status).toBe(400);

    const badRange = await client
      .get("/api/registers/advances")
      .query({ from: `${MONTH}-15`, to: `${MONTH}-01` })
      .set(OWNER.auth);
    expect(badRange.status).toBe(400);
  });

  it("refuses a user without the registers permission", async () => {
    const production = await authed("demo.production");
    const res = await (
      await api()
    )
      .get("/api/registers/muster-roll")
      .query({ month: MONTH })
      .set(production.auth);
    expect(res.status).toBe(403);
  });

  it("never shows another tenant's employees in any register", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Registers Tenant B", companyCode: `REGB-${sfx}` },
      })
    );
    const otherEmployee = await runAsTenant(other.id, () =>
      prisma.employee.create({
        data: { empCode: `OTH-${sfx}`, fullName: "Other Tenant Employee", status: "active" },
      })
    );
    await runAsTenant(other.id, () =>
      prisma.attendanceRecord.create({
        data: { employeeId: otherEmployee.id, date: D1, period: MONTH, status: "PRESENT" },
      })
    );

    const res = await (
      await api()
    )
      .get("/api/registers/muster-roll")
      .query({ month: MONTH })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(otherEmployee.empCode);
    expect(body).not.toContain(other.id);

    expect(await runAsTenant(other.id, () => prisma.employee.count())).toBe(1);
    expect(await asDemoTenant(() => prisma.employee.count())).toBeGreaterThan(0);
  });
});
