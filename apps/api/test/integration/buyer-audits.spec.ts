import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createAttendanceRecord,
  createCustomer,
  createEmployee,
  createPayrollResult,
  createPayrollRun,
  demoOwner,
} from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { addDays, asDate, iso } from "../../src/modules/buyer-audits/buyer-audits.calc";

/**
 * Buyer social-compliance audits (TN-08): the audit calendar, findings, forward-only corrective
 * actions, the readiness report from attendance and payroll, validation, permissions, tenancy.
 */
const sfx = Date.now().toString(36).slice(-5);
const today = asDate(new Date());
const day = (n: number) => iso(addDays(today, n));

type Auth = { auth: Record<string, string> };
let OWNER: Auth;
let ACCOUNTS: Auth;
let AUDITOR: Auth;
let CUSTOMER_ID: string;
let AUDIT_ID: string;
let FINDING_ID: string;
let ACTION_ID: string;
let OWNER_USER_ID: string;
let EMPLOYEE_ID: string;

const base = () => ({
  standard: "BSCI",
  customerId: CUSTOMER_ID,
  auditorFirm: "Intertek",
  scheduledDate: day(20),
});

describe("buyer audits (TN-08)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    ACCOUNTS = await authed("demo.accounts");
    AUDITOR = await authed("demo.auditor");
    CUSTOMER_ID = (await createCustomer()).id;
    OWNER_USER_ID = (await demoOwner()).userId;
    EMPLOYEE_ID = (await createEmployee()).id.toString();
  });

  it("plans an audit and lists it among upcoming audits", async () => {
    const client = await api();
    const res = await client
      .post("/api/buyer-audits")
      .set(OWNER.auth)
      .send({ ...base(), auditNo: `BSCI-${sfx}`, nextAuditDue: day(400) });
    expect(res.status).toBe(201);
    AUDIT_ID = res.body.data.id;
    expect(res.body.data).toMatchObject({
      auditNo: `BSCI-${sfx}`,
      standard: "BSCI",
      status: "PLANNED",
      customerId: CUSTOMER_ID,
      scheduledDate: day(20),
      daysToGo: 20,
      findings: [],
    });
    const list = await client.get("/api/buyer-audits?status=PLANNED").set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.some((a: { id: string }) => a.id === AUDIT_ID)).toBe(true);
  });

  it("defaults the audit number to <standard>-<date> and refuses a duplicate", async () => {
    const client = await api();
    const body = { standard: "WRAP", scheduledDate: day(300 + (Date.now() % 50)) };
    const res = await client.post("/api/buyer-audits").set(OWNER.auth).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.auditNo).toBe(`WRAP-${body.scheduledDate}`);
    expect(res.body.data.customerId).toBeNull();
    const dup = await client.post("/api/buyer-audits").set(OWNER.auth).send(body);
    expect(dup.status).toBe(409);
  });

  it("moves an audit forward only and needs the actual date to complete it", async () => {
    const client = await api();
    const started = await client
      .patch(`/api/buyer-audits/${AUDIT_ID}`)
      .set(OWNER.auth)
      .send({ status: "IN_PROGRESS" });
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe("IN_PROGRESS");
    const back = await client
      .patch(`/api/buyer-audits/${AUDIT_ID}`)
      .set(OWNER.auth)
      .send({ status: "PLANNED" });
    expect(back.status).toBe(409);
    const noDate = await client
      .patch(`/api/buyer-audits/${AUDIT_ID}`)
      .set(OWNER.auth)
      .send({ status: "COMPLETED" });
    expect(noDate.status).toBe(400);
    const future = await client
      .patch(`/api/buyer-audits/${AUDIT_ID}`)
      .set(OWNER.auth)
      .send({ status: "COMPLETED", actualDate: day(3) });
    expect(future.status).toBe(400);
    const done = await client
      .patch(`/api/buyer-audits/${AUDIT_ID}`)
      .set(OWNER.auth)
      .send({ status: "COMPLETED", actualDate: day(-1), rating: "B" });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: "COMPLETED", actualDate: day(-1), rating: "B" });
  });

  it("records findings and corrective actions owned by a user or an employee", async () => {
    const client = await api();
    const f = await client.post(`/api/buyer-audits/${AUDIT_ID}/findings`).set(OWNER.auth).send({
      area: "WORKING_HOURS",
      severity: "CRITICAL",
      clauseRef: "PA 6.2",
      description: "Weekly hours above 60 for stitching operators",
    });
    expect(f.status).toBe(201);
    FINDING_ID = f.body.data.findings[0].id;
    expect(f.body.data.findings[0]).toMatchObject({ seq: 1, open: true, actions: [] });
    expect(f.body.data.openFindings.CRITICAL).toBe(1);

    const byUser = await client
      .post(`/api/buyer-audits/${AUDIT_ID}/findings/${FINDING_ID}/actions`)
      .set(OWNER.auth)
      .send({
        action: "Cap overtime at 12 h a week",
        ownerUserId: OWNER_USER_ID,
        dueDate: day(-2),
      });
    expect(byUser.status).toBe(201);
    const ca = byUser.body.data.findings[0].actions[0];
    ACTION_ID = ca.id;
    expect(ca).toMatchObject({ status: "OPEN", ownerUserId: OWNER_USER_ID, overdue: true });
    expect(byUser.body.data.overdueActions).toBe(1);

    const byEmployee = await client
      .post(`/api/buyer-audits/${AUDIT_ID}/findings/${FINDING_ID}/actions`)
      .set(OWNER.auth)
      .send({ action: "Post the hours policy", ownerEmployeeId: EMPLOYEE_ID, dueDate: day(30) });
    expect(byEmployee.status).toBe(201);
    expect(byEmployee.body.data.findings[0].actions[1]).toMatchObject({
      ownerEmployeeId: EMPLOYEE_ID,
      overdue: false,
    });
  });

  it("moves a corrective action forward only and needs evidence to close it", async () => {
    const client = await api();
    const url = `/api/buyer-audits/${AUDIT_ID}/actions/${ACTION_ID}`;
    const started = await client.patch(url).set(OWNER.auth).send({ status: "IN_PROGRESS" });
    expect(started.status).toBe(200);
    expect((await client.patch(url).set(OWNER.auth).send({ status: "OPEN" })).status).toBe(409);
    expect((await client.patch(url).set(OWNER.auth).send({ status: "DONE" })).status).toBe(400);
    const future = await client
      .patch(url)
      .set(OWNER.auth)
      .send({ status: "DONE", evidenceNote: "Rota changed", closedOn: day(2) });
    expect(future.status).toBe(400);
    const done = await client
      .patch(url)
      .set(OWNER.auth)
      .send({ status: "DONE", evidenceNote: "New rota and signed OT register" });
    expect(done.status).toBe(200);
    const doneCa = done.body.data.findings[0].actions[0];
    expect(doneCa).toMatchObject({ status: "DONE", closedOn: day(0), overdue: false });
    expect((await client.patch(url).set(OWNER.auth).send({ status: "IN_PROGRESS" })).status).toBe(
      409
    );
    const verified = await client.patch(url).set(OWNER.auth).send({ status: "VERIFIED" });
    expect(verified.status).toBe(200);
    expect(verified.body.data.findings[0].actions[0].status).toBe("VERIFIED");
    // A verified action is final, and the finding stays open while the other action is open.
    expect(
      (
        await client
          .patch(url)
          .set(OWNER.auth)
          .send({ dueDate: day(5) })
      ).status
    ).toBe(409);
    expect(verified.body.data.findings[0].open).toBe(true);
  });

  it("builds the readiness report from attendance, payroll and the findings", async () => {
    // February 2024: one employee on 12-hour days (72 h weeks), one with 7 h OT a day.
    const long = await createEmployee();
    const ot = await createEmployee();
    const dates: string[] = [];
    for (let d = 1; d <= 29; d++) {
      const date = `2024-02-${String(d).padStart(2, "0")}`;
      if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 0) dates.push(date);
    }
    for (const date of dates) {
      await createAttendanceRecord({ employeeId: long.id, date, otHours: new Prisma.Decimal(4) });
      await createAttendanceRecord({ employeeId: ot.id, date, otHours: new Prisma.Decimal(7) });
    }
    const run = await createPayrollRun({ period: "2024-01" });
    await createPayrollResult({ payrollRunId: run.id, employeeId: long.id });

    const client = await api();
    const res = await client
      .get("/api/buyer-audits/readiness?from=2024-02-01&to=2024-02-29")
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
    const check = (key: string) => r.checks.find((c: { key: string }) => c.key === key);
    const listed = (key: string, code: string) =>
      check(key).items.some((i: { label: string }) => i.label.startsWith(code));

    expect(check("WEEKLY_HOURS").status).toBe("FAIL");
    expect(listed("WEEKLY_HOURS", long.empCode)).toBe(true);
    expect(check("DAILY_HOURS").status).toBe("WARN");
    expect(listed("DAILY_HOURS", ot.empCode)).toBe(true);
    expect(check("OT_QUARTERLY_CAP").status).toBe("FAIL");
    expect(listed("OT_QUARTERLY_CAP", ot.empCode)).toBe(true);
    expect(listed("OT_QUARTERLY_CAP", long.empCode)).toBe(true); // 100 h: above 80%
    expect(check("MINIMUM_WAGE")).toMatchObject({ status: "NOT_CONFIGURED", count: null });
    expect(check("REGISTERS").status).toBe("FAIL");
    expect(check("REGISTERS").items.map((i: { label: string }) => i.label)).toContain(
      "Wages register · 2024-02"
    );
    // The open critical finding (one action still open) and nothing overdue any more.
    expect(check("OPEN_FINDINGS")).toMatchObject({ status: "FAIL" });
    expect(check("OVERDUE_ACTIONS").count).toBe(0);
    expect(typeof r.percent).toBe("number");
    expect(r.percent).toBeLessThan(60);
    expect(r.band).toBe("NOT_READY");
    expect(r.counts.notConfigured).toBe(1);

    const csv = await client
      .get("/api/buyer-audits/readiness/export?from=2024-02-01&to=2024-02-29")
      .set(OWNER.auth);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain('"Weekly hours within 48","FAIL"');
  });

  it("cancels an audit with a reason instead of deleting it, and then locks it", async () => {
    const client = await api();
    const res = await client
      .post("/api/buyer-audits")
      .set(OWNER.auth)
      .send({ ...base(), auditNo: `SMETA-${sfx}`, standard: "SMETA" });
    const id = res.body.data.id;
    expect(
      (await client.post(`/api/buyer-audits/${id}/cancel`).set(OWNER.auth).send({})).status
    ).toBe(400);
    const cancelled = await client
      .post(`/api/buyer-audits/${id}/cancel`)
      .set(OWNER.auth)
      .send({ reason: "Buyer moved the audit to next season" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      status: "CANCELLED",
      cancelReason: "Buyer moved the audit to next season",
    });
    expect(
      (await client.patch(`/api/buyer-audits/${id}`).set(OWNER.auth).send({ rating: "A" })).status
    ).toBe(409);
    expect(
      (
        await client
          .post(`/api/buyer-audits/${id}/findings`)
          .set(OWNER.auth)
          .send({ area: "WAGES", severity: "MINOR", description: "Late payslips" })
      ).status
    ).toBe(409);
    expect(
      (
        await client
          .post(`/api/buyer-audits/${id}/cancel`)
          .set(OWNER.auth)
          .send({ reason: "Again" })
      ).status
    ).toBe(409);
    expect((await client.delete(`/api/buyer-audits/${id}`).set(OWNER.auth)).status).toBe(404);
    // A completed audit cannot be cancelled either.
    expect(
      (
        await client
          .post(`/api/buyer-audits/${AUDIT_ID}/cancel`)
          .set(OWNER.auth)
          .send({ reason: "Too late now" })
      ).status
    ).toBe(409);
  });

  it("rejects every invalid audit", async () => {
    const client = await api();
    const bad = async (patch: Record<string, unknown>) =>
      client
        .post("/api/buyer-audits")
        .set(OWNER.auth)
        .send({ ...base(), auditNo: `BAD-${sfx}`, ...patch });
    expect((await bad({ standard: "ISO9001" })).status).toBe(400);
    expect((await bad({ standard: undefined })).status).toBe(400);
    expect((await bad({ scheduledDate: "25/09/2026" })).status).toBe(400);
    expect((await bad({ scheduledDate: undefined })).status).toBe(400);
    expect((await bad({ nextAuditDue: day(10) })).status).toBe(400); // before the audit
    expect((await bad({ customerId: "not-a-uuid" })).status).toBe(400);
    expect((await bad({ auditNo: "" })).status).toBe(400);
    expect((await bad({ auditNo: "X".repeat(31) })).status).toBe(400);
    expect((await bad({ auditorFirm: "X".repeat(121) })).status).toBe(400);
    const unknownBuyer = await bad({ customerId: randomUUID() });
    expect(unknownBuyer.status).toBe(404);
    expect(JSON.stringify(unknownBuyer.body)).not.toMatch(/prisma|stack|at .*\.ts/i);

    const patch = (body: Record<string, unknown>) =>
      client.patch(`/api/buyer-audits/${AUDIT_ID}`).set(OWNER.auth).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: "CANCELLED" })).status).toBe(400);
    expect((await patch({ nextAuditDue: day(-30) })).status).toBe(400); // not after the audit
    expect((await patch({ customerId: randomUUID() })).status).toBe(404);
    expect((await client.get("/api/buyer-audits/not-a-uuid").set(OWNER.auth)).status).toBe(400);
    expect((await client.get(`/api/buyer-audits/${randomUUID()}`).set(OWNER.auth)).status).toBe(
      404
    );
    expect(
      (
        await client
          .get("/api/buyer-audits/readiness?from=2026-09-10&to=2026-09-01")
          .set(OWNER.auth)
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .get("/api/buyer-audits/readiness?from=2024-01-01&to=2026-01-01")
          .set(OWNER.auth)
      ).status
    ).toBe(400);
    expect(
      (await client.get("/api/buyer-audits/readiness?from=2024-1-1").set(OWNER.auth)).status
    ).toBe(400);
  });

  it("rejects every invalid finding and corrective action", async () => {
    const client = await api();
    const finding = (body: Record<string, unknown>) =>
      client.post(`/api/buyer-audits/${AUDIT_ID}/findings`).set(OWNER.auth).send(body);
    const ok = { area: "HEALTH_SAFETY", severity: "MAJOR", description: "Blocked fire exit" };
    expect((await finding({ ...ok, area: "PARKING" })).status).toBe(400);
    expect((await finding({ ...ok, severity: "HUGE" })).status).toBe(400);
    expect((await finding({ ...ok, description: "" })).status).toBe(400);
    expect((await finding({ ...ok, clauseRef: "X".repeat(41) })).status).toBe(400);
    expect(
      (
        await client
          .patch(`/api/buyer-audits/${AUDIT_ID}/findings/${FINDING_ID}`)
          .set(OWNER.auth)
          .send({})
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .patch(`/api/buyer-audits/${AUDIT_ID}/findings/${randomUUID()}`)
          .set(OWNER.auth)
          .send({ severity: "MINOR" })
      ).status
    ).toBe(404);

    const action = (body: Record<string, unknown>, findingId = FINDING_ID) =>
      client
        .post(`/api/buyer-audits/${AUDIT_ID}/findings/${findingId}/actions`)
        .set(OWNER.auth)
        .send(body);
    const okCa = { action: "Clear the exit", ownerUserId: OWNER_USER_ID, dueDate: day(7) };
    expect((await action({ ...okCa, action: "" })).status).toBe(400);
    expect((await action({ ...okCa, dueDate: "tomorrow" })).status).toBe(400);
    expect((await action({ ...okCa, ownerUserId: undefined })).status).toBe(400); // no owner
    expect((await action({ ...okCa, ownerEmployeeId: EMPLOYEE_ID })).status).toBe(400); // both
    expect((await action({ ...okCa, ownerUserId: undefined, ownerEmployeeId: "abc" })).status).toBe(
      400
    );
    expect((await action({ ...okCa, ownerUserId: randomUUID() })).status).toBe(404);
    expect(
      (await action({ ...okCa, ownerUserId: undefined, ownerEmployeeId: "999999999999" })).status
    ).toBe(404);
    expect((await action(okCa, randomUUID())).status).toBe(404);

    const update = (body: Record<string, unknown>, id: string) =>
      client.patch(`/api/buyer-audits/${AUDIT_ID}/actions/${id}`).set(OWNER.auth).send(body);
    const detail = (await client.get(`/api/buyer-audits/${AUDIT_ID}`).set(OWNER.auth)).body.data;
    const openId = detail.findings[0].actions[1].id;
    expect((await update({}, openId)).status).toBe(400);
    expect((await update({ status: "CLOSED" }, openId)).status).toBe(400);
    expect((await update({ closedOn: "yesterday" }, openId)).status).toBe(400);
    expect((await update({ status: "OPEN" }, randomUUID())).status).toBe(404);
  });

  it("refuses a role without buyer-audit permissions, and the auditor only reads", async () => {
    const client = await api();
    expect((await client.get("/api/buyer-audits").set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.get("/api/buyer-audits/readiness").set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.post("/api/buyer-audits").set(ACCOUNTS.auth).send(base())).status).toBe(
      403
    );
    expect((await client.get("/api/buyer-audits").set(AUDITOR.auth)).status).toBe(200);
    expect((await client.get("/api/buyer-audits/readiness").set(AUDITOR.auth)).status).toBe(200);
    expect((await client.post("/api/buyer-audits").set(AUDITOR.auth).send(base())).status).toBe(
      403
    );
    expect((await client.get("/api/buyer-audits/readiness/export").set(AUDITOR.auth)).status).toBe(
      403
    );
    expect((await client.get("/api/buyer-audits/owners").set(AUDITOR.auth)).status).toBe(403);
    const owners = await client.get("/api/buyer-audits/owners").set(OWNER.auth);
    expect(owners.status).toBe(200);
    expect(owners.body.data.some((o: { kind: string; id: string }) => o.id === EMPLOYEE_ID)).toBe(
      true
    );
  });

  it("a foreign company sees none of these audits and cannot use their ids", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Audit Tenant B", companyCode: `BAB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.buyerAudit.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.auditFinding.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.correctiveAction.count())).toBe(0);
    expect(
      await runAsTenant(other.id, () => prisma.buyerAudit.findFirst({ where: { id: AUDIT_ID } }))
    ).toBeNull();
    expect(await asDemoTenant(() => prisma.buyerAudit.count())).toBeGreaterThan(0);

    // A buyer, user or employee of another company reads as absent from the demo tenant.
    const foreignCustomer = await runAsTenant(other.id, () =>
      prisma.customer.create({
        data: {
          companyId: other.id,
          createdBy: "test",
          customerCode: `FC${sfx}`,
          firmName: "Foreign Buyer",
          displayName: "Foreign Buyer",
          mobile: ["9000000001"],
        },
      })
    );
    const foreignEmployee = await runAsTenant(other.id, () =>
      prisma.employee.create({
        data: { empCode: `FE${sfx}`, fullName: "Foreign Worker", status: "active" },
      })
    );
    const client = await api();
    expect(
      (
        await client
          .post("/api/buyer-audits")
          .set(OWNER.auth)
          .send({ ...base(), auditNo: `FX-${sfx}`, customerId: foreignCustomer.id })
      ).status
    ).toBe(404);
    expect(
      (
        await client
          .post(`/api/buyer-audits/${AUDIT_ID}/findings/${FINDING_ID}/actions`)
          .set(OWNER.auth)
          .send({
            action: "Borrow a worker",
            ownerEmployeeId: foreignEmployee.id.toString(),
            dueDate: day(5),
          })
      ).status
    ).toBe(404);
  });
});
