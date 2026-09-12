import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * Leave, gratuity, bonus and the settlement (P1-17b).
 *
 * The arithmetic is proved in `test/unit/labour-code.spec.ts`. What is proved here is that the
 * leave ledger holds a balance rather than re-deriving one, and that a settlement's voucher
 * balances and puts gratuity in its own expense rather than in salary.
 */
const sfx = Date.now().toString(36).slice(-5);
const FY = "2036-37";

let OWNER: { auth: Record<string, string> };
let EMPLOYEE_ID: string;

const ledgerBalance = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code } });
    const items = await prisma.journalItem.findMany({
      where: {
        OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
        voucher: { status: "POSTED" },
      },
      select: { debitLedgerId: true, creditLedgerId: true, debitAmount: true, creditAmount: true },
    });
    return items.reduce(
      (s, i) =>
        s +
        (i.debitLedgerId === ledger.id ? Number(i.debitAmount) : 0) -
        (i.creditLedgerId === ledger.id ? Number(i.creditAmount) : 0),
      0
    );
  });
};

describe("leave, gratuity, bonus and settlement", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();
    const employee = await asDemoTenant(() =>
      prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `LB-${sfx}`,
          fullName: "Anand Test",
          // Ten years of service by the settlement date below.
          dateOfJoining: new Date("2026-04-01T00:00:00Z"),
          basicSalary: 26000,
          grossSalary: 45000,
          status: "active",
        },
      })
    );
    EMPLOYEE_ID = String(employee.id);
  });

  it("seeds the leave a factory gives, with earned leave accruing on days worked", async () => {
    const res = await (await api()).get("/api/labour/leave-types").set(OWNER.auth);
    expect(res.status).toBe(200);
    const types = res.body.data as { code: string; basis: string; encashable: boolean }[];
    const el = types.find((t) => t.code === "EL");
    expect(el).toBeDefined();
    // Earned leave is the Factories Act's: one day for every twenty worked, and the only one
    // that can be encashed.
    expect(el!.basis).toBe("DAYS_WORKED");
    expect(el!.encashable).toBe(true);
    expect(types.find((t) => t.code === "CL")?.encashable).toBe(false);
  });

  it("accrues leave and keeps the opening balance rather than re-deriving it", async () => {
    const client = await api();
    const first = await client
      .post("/api/labour/leave-balances/accrue")
      .set(OWNER.auth)
      .send({ employeeId: EMPLOYEE_ID, fyCode: FY, daysWorked: 240, monthsWorked: 12, opening: 5 });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
    const el = (
      first.body.data as {
        leaveTypeId: string;
        accrued: string;
        closing: string;
        opening: string;
      }[]
    )
      .map((b) => b)
      .find((b) => Number(b.accrued) === 12);
    expect(el, JSON.stringify(first.body.data).slice(0, 300)).toBeDefined();
    expect(Number(el!.opening)).toBe(5);
    expect(Number(el!.closing)).toBe(17);

    // Accruing again with a different opening does not move it: what the employee had is what
    // they had, and a later policy change must not rewrite it.
    const again = await client
      .post("/api/labour/leave-balances/accrue")
      .set(OWNER.auth)
      .send({ employeeId: EMPLOYEE_ID, fyCode: FY, daysWorked: 240, opening: 99 });
    const elAgain = (again.body.data as { opening: string; accrued: string }[]).find(
      (b) => Number(b.accrued) === 12
    );
    expect(Number(elAgain!.opening)).toBe(5);
  });

  it("refuses leave the employee does not have", async () => {
    const client = await api();
    const ok = await client
      .post("/api/labour/leave-balances/take")
      .set(OWNER.auth)
      .send({ employeeId: EMPLOYEE_ID, leaveTypeCode: "EL", fyCode: FY, days: 3 });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    expect(Number(ok.body.data.closing)).toBe(14);

    const tooMuch = await client
      .post("/api/labour/leave-balances/take")
      .set(OWNER.auth)
      .send({ employeeId: EMPLOYEE_ID, leaveTypeCode: "EL", fyCode: FY, days: 100 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe("INSUFFICIENT_LEAVE");
  });

  it("lapses what is over the carry-forward cap at the year end", async () => {
    const prisma = await getPrisma();
    const client = await api();
    // Push the balance past the thirty-day cap.
    await asDemoTenant(async () => {
      const type = await prisma.leaveType.findFirstOrThrow({ where: { code: "EL" } });
      await prisma.leaveBalance.updateMany({
        where: { employeeId: BigInt(EMPLOYEE_ID), leaveTypeId: type.id, fyCode: FY },
        data: { closing: 45 },
      });
    });
    const res = await client
      .post(`/api/labour/leave-balances/${FY}/close`)
      .set(OWNER.auth)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.lapsedDays).toBeGreaterThanOrEqual(15);

    const after = await asDemoTenant(async () => {
      const type = await prisma.leaveType.findFirstOrThrow({ where: { code: "EL" } });
      return prisma.leaveBalance.findFirstOrThrow({
        where: { employeeId: BigInt(EMPLOYEE_ID), leaveTypeId: type.id, fyCode: FY },
      });
    });
    expect(Number(after.closing)).toBe(30);
    expect(Number(after.lapsed)).toBe(15);
  });

  it("reports the gratuity the company is carrying, not only what has been asked for", async () => {
    const res = await (
      await api()
    )
      .get("/api/labour/gratuity")
      .query({ asOn: "2036-06-01" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = (
      res.body.data.rows as { employeeCode: string; eligible: boolean; amount: number }[]
    ).find((r) => r.employeeCode === `LB-${sfx}`);
    expect(row).toBeDefined();
    // Ten years at 26,000: 26,000 / 26 × 15 × 10.
    expect(row!.eligible).toBe(true);
    expect(row!.amount).toBe(150000);
    // The liability exists whether or not anyone has resigned.
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  it("computes the bonus on the ceiling and leaves out anyone above the eligibility wage", async () => {
    const res = await (await api()).get(`/api/labour/bonus/${FY}`).set(OWNER.auth);
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as { employeeCode: string; calculationWage: number }[];
    // The test employee is on 26,000 basic, above the ₹21,000 eligibility wage, so no bonus.
    expect(rows.find((r) => r.employeeCode === `LB-${sfx}`)).toBeUndefined();
  });

  it("settles: gratuity to its own expense, recoveries against the cost, and the voucher balances", async () => {
    const client = await api();
    const preview = await client.post("/api/labour/settlements/preview").set(OWNER.auth).send({
      employeeId: EMPLOYEE_ID,
      separationOn: "2036-06-01",
      noticeDaysRequired: 30,
      noticeDaysServed: 10,
      salaryDue: 20000,
      fyCode: FY,
    });
    expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
    const p = preview.body.data as {
      gratuity: number;
      leaveEncashment: number;
      noticeRecovery: number;
      netPayable: number;
      encashableDays: number;
    };
    expect(p.gratuity).toBe(150000);
    // Thirty days of earned leave at 1,000 a day.
    expect(p.encashableDays).toBe(30);
    expect(p.leaveEncashment).toBe(30000);
    // Twenty days of notice short, at 1,000 a day.
    expect(p.noticeRecovery).toBe(20000);
    expect(p.netPayable).toBe(20000 + 30000 + 150000 - 20000);

    const created = await client.post("/api/labour/settlements").set(OWNER.auth).send({
      employeeId: EMPLOYEE_ID,
      separationOn: "2036-06-01",
      noticeDaysRequired: 30,
      noticeDaysServed: 10,
      salaryDue: 20000,
      fyCode: FY,
      reason: "Resigned",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");

    const gratuityBefore = await ledgerBalance("GRATUITY-EXP-001");
    const approved = await client
      .post(`/api/labour/settlements/${created.body.data.id}/approve`)
      .set(OWNER.auth)
      .send({});
    expect(approved.status, JSON.stringify(approved.body).slice(0, 300)).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");

    const prisma = await getPrisma();
    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({
        where: { id: approved.body.data.voucherId },
        include: { items: true },
      })
    );
    const net = voucher.items.reduce(
      (s, i) => s + Number(i.debitAmount) - Number(i.creditAmount),
      0
    );
    expect(Math.round(net)).toBe(0);
    // Gratuity is a retirement benefit, reported apart from salary.
    expect(Math.round((await ledgerBalance("GRATUITY-EXP-001")) - gratuityBefore)).toBe(150000);

    // Approving twice is refused.
    const twice = await client
      .post(`/api/labour/settlements/${created.body.data.id}/approve`)
      .set(OWNER.auth)
      .send({});
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("NOT_DRAFT");
  });

  it("refuses a user without the permission and hides another tenant's settlements", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect((await client.get("/api/labour/settlements").set(production.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Labour Tenant B", companyCode: `LBB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.finalSettlement.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.finalSettlement.count())).toBeGreaterThan(0);
  });
});
