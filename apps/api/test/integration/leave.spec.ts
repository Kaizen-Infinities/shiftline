import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { hashPassword } from "../../src/utils/hashPassword";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { leaveService } from "../../src/modules/leave/leave.service";
import { leaveAccrualHandler } from "../../src/jobs/leave.job";

/**
 * Leave management (P2-09): requests, approval, the calendar and self-service, on top of the
 * ledger `labour.service.ts` keeps.
 *
 * FY 2037-38 — later than any other suite's financial year, so nothing here collides with the
 * seed data or another package's fixtures.
 */
const sfx = Date.now().toString(36).slice(-5);
const FY = "2037-38";

let OWNER: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let AUDITOR: { auth: Record<string, string> };

let EMPLOYEE_ID: string; // has an EL accrual and is used for the happy path + overlap
let LWP_EMPLOYEE_ID: string; // fresh, used for the approve / reject / cancel ledger checks
let ACCRUAL_EMPLOYEE_ID: string; // has attendance, used for the accrual job

const balanceOf = async (employeeId: string, code: string, fyCode = FY) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const type = await prisma.leaveType.findFirstOrThrow({ where: { code } });
    return prisma.leaveBalance.findUnique({
      where: {
        companyId_employeeId_leaveTypeId_fyCode: {
          companyId: (await demoCompany()).id,
          employeeId: BigInt(employeeId),
          leaveTypeId: type.id,
          fyCode,
        },
      },
    });
  });
};

describe("leave management", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    ACCOUNTS = await authed("demo.accounts");
    PRODUCTION = await authed("demo.production");
    AUDITOR = await authed("demo.auditor");

    const prisma = await getPrisma();
    const company = await demoCompany();

    const mkEmployee = (code: string) =>
      asDemoTenant(() =>
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `LV-${sfx}-${code}`,
            fullName: `Leave Test ${code}`,
            dateOfJoining: new Date("2030-04-01T00:00:00Z"),
            basicSalary: 15000,
            status: "active",
          },
        })
      );

    const employee = await mkEmployee("A");
    EMPLOYEE_ID = String(employee.id);
    const lwp = await mkEmployee("B");
    LWP_EMPLOYEE_ID = String(lwp.id);
    const accrualEmployee = await mkEmployee("C");
    ACCRUAL_EMPLOYEE_ID = String(accrualEmployee.id);

    // Ensure the leave types (including LWP) exist for this tenant.
    await (await api()).get("/api/labour/leave-types").set(OWNER.auth);

    // Give EMPLOYEE_ID some earned leave to spend and to overlap against.
    await (
      await api()
    )
      .post("/api/labour/leave-balances/accrue")
      .set(OWNER.auth)
      .send({ employeeId: EMPLOYEE_ID, fyCode: FY, daysWorked: 100, monthsWorked: 3, opening: 5 });

    // A company holiday inside the test week, so a request spanning it excludes that day.
    await (
      await api()
    )
      .post("/api/labour/holidays")
      .set(OWNER.auth)
      .send({ holidayOn: "2037-06-03", name: `Leave test holiday ${sfx}`, kind: "COMPANY" });

    // Thirty days of PRESENT attendance in June 2037 for the accrual job to find.
    await asDemoTenant(() =>
      prisma.attendanceRecord.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          companyId: company.id,
          employeeId: accrualEmployee.id,
          date: `2037-06-${String(i + 1).padStart(2, "0")}`,
          period: "2037-06",
          status: "PRESENT",
        })),
      })
    );
  });

  it("computes days excluding weekly-offs and the holiday calendar", async () => {
    const client = await api();
    // Wed 3rd (holiday) .. Mon 8th: Thu, Fri, Sat, Mon are working days; Wed is a holiday and
    // Sun the 7th is the default weekly-off.
    const res = await client.post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: EMPLOYEE_ID,
      leaveTypeCode: "EL",
      fromDate: "2037-06-03",
      toDate: "2037-06-08",
      reason: "Family function",
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(Number(res.body.data.days)).toBe(4);
    expect(res.body.data.status).toBe("PENDING");
  });

  it("refuses an overlapping request", async () => {
    const res = await (await api()).post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: EMPLOYEE_ID,
      leaveTypeCode: "EL",
      fromDate: "2037-06-05",
      toDate: "2037-06-06",
    });
    expect(res.status).toBe(409);
    expect(res.body.errorCode ?? res.body.code).toBe("OVERLAP");
  });

  it("refuses a request beyond the balance", async () => {
    // ACCRUAL_EMPLOYEE_ID has never been accrued, so it has no balance for this type.
    const res = await (await api()).post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: ACCRUAL_EMPLOYEE_ID,
      leaveTypeCode: "SL",
      fromDate: "2037-06-15",
      toDate: "2037-06-15",
    });
    expect(res.status).toBe(409);
    expect(res.body.errorCode ?? res.body.code).toBe("INSUFFICIENT_LEAVE");
  });

  it("lets a leave-without-pay type go negative", async () => {
    const res = await (await api()).post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: LWP_EMPLOYEE_ID,
      leaveTypeCode: "LWP",
      fromDate: "2037-06-10",
      toDate: "2037-06-10",
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  });

  it("approving deducts the ledger; rejecting leaves it; cancelling an approved request restores it", async () => {
    const client = await api();

    // Approve: taken moves up.
    const toApprove = await client.post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: LWP_EMPLOYEE_ID,
      leaveTypeCode: "LWP",
      fromDate: "2037-06-11",
      toDate: "2037-06-11",
    });
    expect(toApprove.status).toBe(201);
    const approved = await client
      .post(`/api/leave/requests/${toApprove.body.data.id}/approve`)
      .set(ACCOUNTS.auth)
      .send({});
    expect(approved.status, JSON.stringify(approved.body).slice(0, 300)).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    let ledger = await balanceOf(LWP_EMPLOYEE_ID, "LWP");
    expect(Number(ledger!.taken)).toBe(1);
    expect(Number(ledger!.closing)).toBe(-1);

    // Approving again is refused.
    const twice = await client
      .post(`/api/leave/requests/${toApprove.body.data.id}/approve`)
      .set(ACCOUNTS.auth)
      .send({});
    expect(twice.status).toBe(409);

    // Reject: the ledger does not move.
    const toReject = await client.post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: LWP_EMPLOYEE_ID,
      leaveTypeCode: "LWP",
      fromDate: "2037-06-12",
      toDate: "2037-06-12",
    });
    const rejected = await client
      .post(`/api/leave/requests/${toReject.body.data.id}/reject`)
      .set(ACCOUNTS.auth)
      .send({ comments: "Not enough notice" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");
    ledger = await balanceOf(LWP_EMPLOYEE_ID, "LWP");
    expect(Number(ledger!.taken)).toBe(1); // unchanged from the approval above

    // Cancel an approved request: the ledger gives the day back.
    const toCancel = await client.post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: LWP_EMPLOYEE_ID,
      leaveTypeCode: "LWP",
      fromDate: "2037-06-13",
      toDate: "2037-06-13",
    });
    await client
      .post(`/api/leave/requests/${toCancel.body.data.id}/approve`)
      .set(ACCOUNTS.auth)
      .send({});
    ledger = await balanceOf(LWP_EMPLOYEE_ID, "LWP");
    expect(Number(ledger!.taken)).toBe(2);
    const cancelled = await client
      .post(`/api/leave/requests/${toCancel.body.data.id}/cancel`)
      .set(OWNER.auth)
      .send({});
    expect(cancelled.status, JSON.stringify(cancelled.body).slice(0, 300)).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    ledger = await balanceOf(LWP_EMPLOYEE_ID, "LWP");
    expect(Number(ledger!.taken)).toBe(1); // back to what it was before the cancelled request
  });

  it("shows the approved absence on the calendar", async () => {
    const res = await (
      await api()
    )
      .get("/api/leave/calendar")
      .query({ month: "2037-06" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as { employeeId: string; leaveTypeCode: string }[];
    expect(rows.some((r) => r.employeeId === LWP_EMPLOYEE_ID && r.leaveTypeCode === "LWP")).toBe(
      true
    );
  });

  it("/me answers for a user with an employee link and for one without", async () => {
    const client = await api();
    const prisma = await getPrisma();

    // With a link: a freshly created user tied to an employee.
    const role = await asDemoTenant(() =>
      prisma.role.findFirstOrThrow({ where: { code: "PRODUCTION" } })
    );
    const username = `leave.me.${sfx}`;
    await asDemoTenant(async () => {
      const company = await demoCompany();
      const employee = await prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `LV-${sfx}-ME`,
          fullName: "Leave Me Test",
          status: "active",
        },
      });
      await prisma.user.create({
        data: {
          companyId: company.id,
          username,
          fullName: "Leave Me Test",
          email: `${username}@test.shiftline.local`,
          passwordHash: await hashPassword("Test@12345678"),
          employeeId: employee.id,
          roleId: role.id,
          status: "active",
        },
      });
    });
    const login = await client
      .post("/api/auth/login")
      .send({ email: username, password: "Test@12345678" });
    expect(login.status, JSON.stringify(login.body).slice(0, 300)).toBe(200);
    const linkedAuth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const linked = await client.get("/api/leave/me").set(linkedAuth);
    expect(linked.status).toBe(200);
    expect(linked.body.data.linked).toBe(true);
    expect(linked.body.data.employee.empCode).toBe(`LV-${sfx}-ME`);

    // Without a link: the owner account has no employee record.
    const ownerUser = await asDemoTenant(() =>
      prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" } })
    );
    expect(ownerUser.employeeId).toBeNull();
    const unlinked = await client.get("/api/leave/me").set(OWNER.auth);
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.data.linked).toBe(false);
  });

  it("refuses a request from a role without leave.request, and an approval from one without leave.approve", async () => {
    const client = await api();
    const noRequest = await client.post("/api/leave/requests").set(AUDITOR.auth).send({
      employeeId: EMPLOYEE_ID,
      leaveTypeCode: "EL",
      fromDate: "2037-06-20",
      toDate: "2037-06-20",
    });
    expect(noRequest.status).toBe(403);

    const pending = await client.post("/api/leave/requests").set(OWNER.auth).send({
      employeeId: EMPLOYEE_ID,
      leaveTypeCode: "EL",
      fromDate: "2037-06-22",
      toDate: "2037-06-22",
    });
    expect(pending.status, JSON.stringify(pending.body).slice(0, 300)).toBe(201);
    const noApprove = await client
      .post(`/api/leave/requests/${pending.body.data.id}/approve`)
      .set(PRODUCTION.auth)
      .send({});
    expect(noApprove.status).toBe(403);
  });

  it("accrues once from attendance and is idempotent on a second run", async () => {
    const first = await asDemoTenant(() =>
      leaveService.accrueForTenant(new Date("2037-06-30T00:00:00Z"))
    );
    expect(first.employees).toBeGreaterThan(0);
    const after1 = await balanceOf(ACCRUAL_EMPLOYEE_ID, "EL");
    // Twenty PRESENT days at one earned day per twenty worked.
    expect(Number(after1!.accrued)).toBe(1);

    await asDemoTenant(() => leaveService.accrueForTenant(new Date("2037-06-30T00:00:00Z")));
    const after2 = await balanceOf(ACCRUAL_EMPLOYEE_ID, "EL");
    expect(Number(after2!.accrued)).toBe(1);
  });

  it("the scheduled handler runs across tenants without throwing", async () => {
    await expect(leaveAccrualHandler()).resolves.toBeDefined();
  });

  it("a foreign company sees no leave requests", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Leave Tenant B", companyCode: `LVB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.leaveRequest.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.leaveRequest.count())).toBeGreaterThan(0);
  });
});
