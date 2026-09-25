import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import {
  asDemoTenant,
  createEmployee,
  createPayrollResult,
  createPayrollRun,
  demoCompany,
} from "../factories";

/**
 * Fines and deductions (P2-13): create, show-cause, approve against the 3% ceiling, and payroll
 * recovery — the source the fines/deductions registers (P2-03) read and payroll's "other
 * deductions" now picks up.
 */
const sfx = Date.now().toString(36).slice(-6);
const RECOVERY_PERIOD = "2033-05";
const CEILING_PERIOD = "2033-02";
const REGISTER_PERIOD = "2033-06";

const daysIn = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

let OWNER: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let empId: bigint;
let empCode: string;

describe("fines and deductions", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    ACCOUNTS = await authed("demo.accounts");
    PRODUCTION = await authed("demo.production");

    const employee = await createEmployee({ empCode: `FIN-${sfx}`, fullName: "Meena Fines" });
    empId = employee.id;
    empCode = employee.empCode;
  });

  it("creates a fine, refuses approval before show-cause, then approves it", async () => {
    const client = await api();
    const create = await client
      .post("/api/fines")
      .set(ACCOUNTS.auth)
      .send({
        employeeId: Number(empId),
        kind: "FINE",
        occurredOn: `${CEILING_PERIOD}-05`,
        cause: "Reported late without notice",
        amount: 15,
        wagePeriod: CEILING_PERIOD,
      });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    expect(create.body.data.status).toBe("PENDING");
    const id = create.body.data.id;

    const tooEarly = await client.post(`/api/fines/${id}/approve`).set(ACCOUNTS.auth);
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.code).toBe("SHOW_CAUSE_REQUIRED");

    const shown = await client
      .post(`/api/fines/${id}/show-cause`)
      .set(ACCOUNTS.auth)
      .send({ showCauseDate: `${CEILING_PERIOD}-06`, showCauseRemarks: "Heard; no valid reason" });
    expect(shown.status).toBe(200);
    expect(shown.body.data.shownCauseGiven).toBe(true);

    const approved = await client.post(`/api/fines/${id}/approve`).set(ACCOUNTS.auth);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
  });

  it("refuses approval once approved fines for the period would exceed the 3% ceiling", async () => {
    const client = await api();
    const run = await createPayrollRun({ period: CEILING_PERIOD, status: "APPROVED" });
    await createPayrollResult({
      payrollRunId: run.id,
      employeeId: empId,
      employeeCode: empCode,
      grossSalary: 1000, // 3% ceiling = 30; the 15 already approved above leaves 15 of headroom.
      netSalary: 1000,
    });

    const create = await client
      .post("/api/fines")
      .set(ACCOUNTS.auth)
      .send({
        employeeId: Number(empId),
        kind: "FINE",
        occurredOn: `${CEILING_PERIOD}-10`,
        cause: "Damaged a tool through carelessness",
        amount: 20, // 15 already approved + 20 = 35 > 30
        wagePeriod: CEILING_PERIOD,
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    await client
      .post(`/api/fines/${id}/show-cause`)
      .set(ACCOUNTS.auth)
      .send({ showCauseDate: `${CEILING_PERIOD}-11`, showCauseRemarks: "Heard" });

    const res = await client.post(`/api/fines/${id}/approve`).set(ACCOUNTS.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("FINE_CEILING_EXCEEDED");
  });

  it("approves a deduction for damage/loss without a show-cause notice", async () => {
    const client = await api();
    const create = await client
      .post("/api/fines")
      .set(ACCOUNTS.auth)
      .send({
        employeeId: Number(empId),
        kind: "DEDUCTION",
        occurredOn: `${REGISTER_PERIOD}-02`,
        cause: "Damaged raw material by negligence",
        amount: 75,
        wagePeriod: REGISTER_PERIOD,
      });
    expect(create.status).toBe(201);
    const approve = await client
      .post(`/api/fines/${create.body.data.id}/approve`)
      .set(ACCOUNTS.auth);
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect(approve.body.data.status).toBe("APPROVED");
  });

  it("recovers an approved fine in the payroll run once, dropping net pay by the amount, and never twice", async () => {
    const client = await api();
    const company = await demoCompany();
    const employee = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `FINPR-${sfx}`,
          fullName: "Ravi Recovery",
          salaryType: "monthly",
          grossSalary: 30000,
          pfApplicable: false,
          esiApplicable: false,
          accountNumber: "1234599001",
          ifscCode: "HDFC0000123",
        },
      });
    });

    const createRes = await client
      .post("/api/fines")
      .set(ACCOUNTS.auth)
      .send({
        employeeId: Number(employee.id),
        kind: "FINE",
        occurredOn: `${RECOVERY_PERIOD}-05`,
        cause: "Left the machine unattended",
        amount: 200,
        wagePeriod: RECOVERY_PERIOD,
      });
    expect(createRes.status).toBe(201);
    const fineId = createRes.body.data.id;
    await client
      .post(`/api/fines/${fineId}/show-cause`)
      .set(ACCOUNTS.auth)
      .send({ showCauseDate: `${RECOVERY_PERIOD}-06`, showCauseRemarks: "Heard; admitted fault" });
    const approveRes = await client.post(`/api/fines/${fineId}/approve`).set(ACCOUNTS.auth);
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200);

    const days = daysIn(RECOVERY_PERIOD);
    const attendance = [
      {
        employeeId: Number(employee.id),
        presentDays: days,
        absentDays: 0,
        halfDays: 0,
        otHours: 0,
        lateMinutes: 0,
        permissionMinutes: 0,
        advance: 0,
      },
    ];

    const firstRun = await client.post("/api/payroll/runs").set(OWNER.auth).send({
      period: RECOVERY_PERIOD,
      type: "MONTHLY",
      employeeCategory: "ALL",
      calendarDays: days,
      attendance,
    });
    expect(firstRun.status, JSON.stringify(firstRun.body).slice(0, 500)).toBe(201);
    const firstResult = firstRun.body.data.results.find(
      (r: any) => r.employeeCode === employee.empCode
    );
    expect(firstResult).toBeTruthy();
    expect(Number(firstResult.grossSalary)).toBe(30000);
    expect(Number(firstResult.otherDeductions)).toBeGreaterThanOrEqual(200);
    expect(Number(firstResult.netSalary)).toBe(29800);

    const prisma = await getPrisma();
    const fineRow = await asDemoTenant(() =>
      prisma.employeeFineDeduction.findUniqueOrThrow({ where: { id: fineId } })
    );
    expect(fineRow.recoveredInPayrollResultId).toBe(firstResult.id);
    expect(fineRow.recoveredAt).not.toBeNull();

    // Cancelling a recovered item is refused.
    const cancelRes = await client
      .post(`/api/fines/${fineId}/cancel`)
      .set(ACCOUNTS.auth)
      .send({ reason: "changed my mind" });
    expect(cancelRes.status).toBe(409);
    expect(cancelRes.body.code).toBe("ALREADY_RECOVERED");

    // A second run for the same period must not recover the same fine again. A run for the same
    // period, type and employeeCategory is refused as a duplicate, so this uses the category
    // that matches this employee's salary type directly — a legitimate second run over the same
    // wage period, the scenario the "not-yet-recovered" filter exists for.
    const secondRun = await client.post("/api/payroll/runs").set(OWNER.auth).send({
      period: RECOVERY_PERIOD,
      type: "MONTHLY",
      employeeCategory: "FIXED_MONTHLY",
      calendarDays: days,
      attendance,
    });
    expect(secondRun.status, JSON.stringify(secondRun.body).slice(0, 500)).toBe(201);
    const secondResult = secondRun.body.data.results.find(
      (r: any) => r.employeeCode === employee.empCode
    );
    expect(secondResult).toBeTruthy();
    expect(Number(secondResult.otherDeductions)).toBe(0);
    expect(Number(secondResult.netSalary)).toBe(30000);
  });

  it("shows only the approved item in the fines and deductions registers, with its recovery status", async () => {
    const client = await api();
    const pending = await client
      .post("/api/fines")
      .set(ACCOUNTS.auth)
      .send({
        employeeId: Number(empId),
        kind: "FINE",
        occurredOn: `${REGISTER_PERIOD}-03`,
        cause: "Still under review",
        amount: 5,
        wagePeriod: REGISTER_PERIOD,
      });
    expect(pending.status).toBe(201);

    const res = await client
      .get("/api/registers/deductions")
      .query({ from: `${REGISTER_PERIOD}-01`, to: `${REGISTER_PERIOD}-28` })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    const approvedRow = rows.find((r) => r.employeeCode === empCode && r.amount === 75);
    expect(approvedRow).toBeTruthy();
    expect(approvedRow!.recovered).toBe(false);
    expect(rows.find((r) => r.amount === 5)).toBeUndefined();
  });

  it("refuses a user without the fines permission", async () => {
    const res = await (
      await api()
    )
      .post("/api/fines")
      .set(PRODUCTION.auth)
      .send({
        employeeId: Number(empId),
        kind: "FINE",
        occurredOn: `${REGISTER_PERIOD}-01`,
        cause: "x",
        amount: 5,
        wagePeriod: REGISTER_PERIOD,
      });
    expect(res.status).toBe(403);
  });

  it("never shows another tenant's fine", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Fines Tenant B", companyCode: `FINB-${sfx}` },
      })
    );
    const otherEmployee = await runAsTenant(other.id, () =>
      prisma.employee.create({
        data: { empCode: `OTHF-${sfx}`, fullName: "Other Tenant Employee", status: "active" },
      })
    );
    await runAsTenant(other.id, () =>
      prisma.employeeFineDeduction.create({
        data: {
          employeeId: otherEmployee.id,
          kind: "FINE",
          occurredOn: new Date(`${REGISTER_PERIOD}-01T00:00:00Z`),
          cause: "Other tenant's fine",
          amount: 10,
          status: "APPROVED",
          wagePeriod: REGISTER_PERIOD,
        },
      })
    );

    const res = await (await api()).get("/api/fines").set(OWNER.auth);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(otherEmployee.empCode);

    expect(await runAsTenant(other.id, () => prisma.employeeFineDeduction.count())).toBe(1);
  });
});
