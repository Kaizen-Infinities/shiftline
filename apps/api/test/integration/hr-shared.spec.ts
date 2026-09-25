import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { hashPassword } from "../../src/utils/hashPassword";
import {
  asDemoTenant,
  createEmployee,
  createFineDeduction,
  createPayrollResult,
  createPayrollRun,
  demoCompany,
} from "../factories";

/**
 * HR shared pieces (P2-15): the employee search behind `employees.search`, `Employee.
 * businessPlaceId` (round-tripped through the employee API and the registers' business-place
 * filter), a fine/deduction edit while still PENDING, and the notifications a show-cause and an
 * approval now leave for the employee.
 */
const sfx = Date.now().toString(36).slice(-6);
const SEARCH_MONTH = "2034-04"; // a month no other suite touches

let OWNER: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };

describe("HR shared pieces", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    ACCOUNTS = await authed("demo.accounts");
  });

  // ── Employee search ──────────────────────────────────────────────────────────
  describe("employee search", () => {
    it("finds a matching employee by name or code, and caps at 20 rows", async () => {
      const client = await api();
      const employee = await createEmployee({
        empCode: `SRCH-${sfx}`,
        fullName: `Zsearchable Person ${sfx}`,
      });

      const byName = await client
        .get("/api/employees/search")
        .query({ q: "Zsearchable" })
        .set(OWNER.auth);
      expect(byName.status).toBe(200);
      expect(byName.body.data.some((r: any) => r.id === String(employee.id))).toBe(true);
      expect(byName.body.data[0]).toHaveProperty("empCode");
      expect(byName.body.data[0]).toHaveProperty("department");
      expect(byName.body.data[0]).toHaveProperty("businessPlace");

      const byCode = await client
        .get("/api/employees/search")
        .query({ q: `SRCH-${sfx}` })
        .set(OWNER.auth);
      expect(byCode.status).toBe(200);
      expect(byCode.body.data.some((r: any) => r.id === String(employee.id))).toBe(true);

      // Cap at 20: create enough matching employees to exceed it, all sharing one prefix.
      const prefix = `CAP${sfx}`;
      await asDemoTenant(async () => {
        const prisma = await getPrisma();
        const company = await demoCompany();
        for (let i = 0; i < 25; i++) {
          await prisma.employee.create({
            data: {
              companyId: company.id,
              empCode: `${prefix}-${i}`,
              fullName: `${prefix} Person ${i}`,
              status: "active",
            },
          });
        }
      });
      const capped = await client.get("/api/employees/search").query({ q: prefix }).set(OWNER.auth);
      expect(capped.status).toBe(200);
      expect(capped.body.data.length).toBeLessThanOrEqual(20);
    });

    it("refuses a user without employees.search", async () => {
      const prisma = await getPrisma();
      const client = await api();
      const username = `hr.norole.${sfx}`;
      await asDemoTenant(async () => {
        const company = await demoCompany();
        const role = await prisma.role.create({
          data: { companyId: company.id, code: `NOSEARCH-${sfx}`, name: "No permissions" },
        });
        await prisma.user.create({
          data: {
            companyId: company.id,
            username,
            fullName: "No Role Test",
            email: `${username}@test.shiftline.local`,
            passwordHash: await hashPassword("Test@12345678"),
            roleId: role.id,
            status: "active",
          },
        });
      });
      const login = await client
        .post("/api/auth/login")
        .send({ email: username, password: "Test@12345678" });
      expect(login.status, JSON.stringify(login.body).slice(0, 300)).toBe(200);
      const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };

      const res = await client.get("/api/employees/search").query({ q: "a" }).set(auth);
      expect(res.status).toBe(403);
    });

    it("never shows another tenant's employee", async () => {
      const prisma = await getPrisma();
      const other = await withoutTenant(() =>
        prisma.company.create({
          data: { companyName: "HR Shared Tenant B", companyCode: `HRSB-${sfx}` },
        })
      );
      const otherEmployee = await runAsTenant(other.id, () =>
        prisma.employee.create({
          data: {
            empCode: `OTHHR-${sfx}`,
            fullName: `Other Tenant Findable ${sfx}`,
            status: "active",
          },
        })
      );

      const res = await (
        await api()
      )
        .get("/api/employees/search")
        .query({ q: sfx })
        .set(OWNER.auth);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(otherEmployee.empCode);
    });
  });

  // ── Employee businessPlaceId round-trip ─────────────────────────────────────
  describe("employee business place", () => {
    it("round-trips businessPlaceId on create and update, and refuses an unknown place", async () => {
      const client = await api();
      const headOffice = await asDemoTenant(async () => {
        const prisma = await getPrisma();
        return prisma.businessPlace.findFirstOrThrow();
      });

      const create = await client
        .post("/api/employees")
        .set(OWNER.auth)
        .field("empCode", `BP-${sfx}`)
        .field("fullName", "Business Place Test")
        .field("businessPlaceId", String(headOffice.id));
      expect(create.status, JSON.stringify(create.body).slice(0, 300)).toBe(201);
      expect(create.body.data.businessPlaceId).toBe(String(headOffice.id));
      const id = create.body.data.id;

      const badCreate = await client
        .post("/api/employees")
        .set(OWNER.auth)
        .field("empCode", `BP2-${sfx}`)
        .field("fullName", "Bad Business Place Test")
        .field("businessPlaceId", "999999999");
      expect(badCreate.status).toBe(400);

      const clear = await client
        .put(`/api/employees/${id}`)
        .set(OWNER.auth)
        .field("businessPlaceId", "");
      expect(clear.status, JSON.stringify(clear.body).slice(0, 300)).toBe(200);
      expect(clear.body.data.businessPlaceId).toBeNull();

      const badUpdate = await client
        .put(`/api/employees/${id}`)
        .set(OWNER.auth)
        .field("businessPlaceId", "999999999");
      expect(badUpdate.status).toBe(400);
    });
  });

  // ── Registers business-place filter ─────────────────────────────────────────
  describe("registers business-place filter", () => {
    it("the wages register filters by business place", async () => {
      const client = await api();
      const prisma = await getPrisma();
      const { headOffice, branch } = await asDemoTenant(async () => {
        const company = await demoCompany();
        const headOffice = await prisma.businessPlace.findFirstOrThrow();
        const branch = await prisma.businessPlace.create({
          data: {
            companyId: company.id,
            code: `BR-${sfx}`,
            name: "Branch for filter test",
            type: "BRANCH_OFFICE",
          },
        });
        return { headOffice, branch };
      });

      const atHo = await createEmployee({
        empCode: `WBP-HO-${sfx}`,
        fullName: "Wages HO",
        businessPlaceId: headOffice.id,
      });
      const atBranch = await createEmployee({
        empCode: `WBP-BR-${sfx}`,
        fullName: "Wages Branch",
        businessPlaceId: branch.id,
      });

      const run = await createPayrollRun({ period: SEARCH_MONTH, status: "APPROVED" });
      await createPayrollResult({
        payrollRunId: run.id,
        employeeId: atHo.id,
        employeeCode: atHo.empCode,
        grossSalary: 1000,
        netSalary: 1000,
      });
      await createPayrollResult({
        payrollRunId: run.id,
        employeeId: atBranch.id,
        employeeCode: atBranch.empCode,
        grossSalary: 1000,
        netSalary: 1000,
      });

      const filtered = await client
        .get("/api/registers/wages")
        .query({ month: SEARCH_MONTH, businessPlaceId: String(branch.id) })
        .set(OWNER.auth);
      expect(filtered.status, JSON.stringify(filtered.body).slice(0, 300)).toBe(200);
      const codes = filtered.body.data.rows.map((r: any) => r.employeeCode);
      expect(codes).toContain(atBranch.empCode);
      expect(codes).not.toContain(atHo.empCode);

      const unfiltered = await client
        .get("/api/registers/wages")
        .query({ month: SEARCH_MONTH })
        .set(OWNER.auth);
      const allCodes = unfiltered.body.data.rows.map((r: any) => r.employeeCode);
      expect(allCodes).toContain(atHo.empCode);
      expect(allCodes).toContain(atBranch.empCode);
    });
  });

  // ── Fine edit and notifications ──────────────────────────────────────────────
  describe("fine edit and notifications", () => {
    it("edits a PENDING fine, refuses it once show-cause is recorded, and notifies the employee", async () => {
      const client = await api();
      const prisma = await getPrisma();

      const username = `hr.fine.linked.${sfx}`;
      const { employee, user } = await asDemoTenant(async () => {
        const company = await demoCompany();
        const employee = await prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `FNL-${sfx}`,
            fullName: "Fine Linked Employee",
            status: "active",
          },
        });
        const role = await prisma.role.findFirstOrThrow({ where: { code: "PRODUCTION" } });
        const user = await prisma.user.create({
          data: {
            companyId: company.id,
            username,
            fullName: "Fine Linked Employee",
            email: `${username}@test.shiftline.local`,
            passwordHash: await hashPassword("Test@12345678"),
            employeeId: employee.id,
            roleId: role.id,
            status: "active",
          },
        });
        return { employee, user };
      });

      const create = await client
        .post("/api/fines")
        .set(ACCOUNTS.auth)
        .send({
          employeeId: Number(employee.id),
          kind: "FINE",
          occurredOn: `${SEARCH_MONTH}-05`,
          cause: "Original cause",
          amount: 10,
          wagePeriod: SEARCH_MONTH,
        });
      expect(create.status, JSON.stringify(create.body)).toBe(201);
      const id = create.body.data.id;

      const edited = await client
        .patch(`/api/fines/${id}`)
        .set(ACCOUNTS.auth)
        .send({ cause: "Corrected cause", amount: 15 });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(edited.body.data.cause).toBe("Corrected cause");
      expect(Number(edited.body.data.amount)).toBe(15);

      const shown = await client
        .post(`/api/fines/${id}/show-cause`)
        .set(ACCOUNTS.auth)
        .send({ showCauseDate: `${SEARCH_MONTH}-06`, showCauseRemarks: "Heard" });
      expect(shown.status).toBe(200);

      const editAfterShowCause = await client
        .patch(`/api/fines/${id}`)
        .set(ACCOUNTS.auth)
        .send({ amount: 20 });
      expect(editAfterShowCause.status).toBe(409);
      expect(editAfterShowCause.body.code).toBe("SHOW_CAUSE_RECORDED");

      const approved = await client.post(`/api/fines/${id}/approve`).set(ACCOUNTS.auth);
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);

      const editAfterApproval = await client
        .patch(`/api/fines/${id}`)
        .set(ACCOUNTS.auth)
        .send({ amount: 25 });
      expect(editAfterApproval.status).toBe(409);
      expect(editAfterApproval.body.code).toBe("NOT_PENDING");

      const notifications = await runAsTenant((await demoCompany()).id, () =>
        prisma.notification.findMany({
          where: { userId: user.userId, category: "fines" },
          orderBy: { createdAt: "asc" },
        })
      );
      expect(notifications.length).toBeGreaterThanOrEqual(2);
      expect(notifications.some((n) => /show-cause/i.test(n.title))).toBe(true);
      expect(notifications.some((n) => /approved/i.test(n.title))).toBe(true);
    });

    it("allows editing a PENDING deduction, which never needed a show-cause to approve", async () => {
      // A DEDUCTION never needs show-cause to approve, but the edit rule is the same for both
      // kinds: allowed while PENDING and no show-cause is recorded yet.
      const client = await api();
      const employee = await createEmployee({ empCode: `DED-${sfx}`, fullName: "Deduction Edit" });
      const row = await createFineDeduction({
        employeeId: employee.id,
        kind: "DEDUCTION",
        status: "PENDING",
        shownCauseGiven: false,
        wagePeriod: SEARCH_MONTH,
        occurredOn: new Date(`${SEARCH_MONTH}-02T00:00:00Z`),
      });

      const edited = await client
        .patch(`/api/fines/${row.id}`)
        .set(ACCOUNTS.auth)
        .send({ amount: 99 });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(Number(edited.body.data.amount)).toBe(99);
    });
  });
});
