import { beforeAll, describe, expect, it } from "vitest";

import { api, authed, loginAs } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { expectCleanError } from "../helpers/clean-error";
import { foreignTenant } from "../helpers/foreign-tenant";
import { asDemoTenant, createEmployee } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Employee master (R-04, characterisation). Pins today's behaviour of
 * `apps/api/src/modules/employee/`:
 *  - create/update take multipart or JSON and have no zod schema on the route (the controller
 *    coerces fields), so a missing `empCode` or an unknown enum value is reported by Prisma as
 *    the generic 400 "Invalid request data." rather than a field-level error;
 *  - duplicates of empCode, e-mail, Aadhaar, PAN, PF, UAN and ESI numbers are refused with 400;
 *  - every create/update also upserts the employee's payroll config;
 *  - a login account can be created with the employee; the response never carries the hash;
 *  - delete refuses employees still referenced by a machine, store or sales order, and removes
 *    the linked user, payroll config and attendance otherwise.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
let seq = 0;
const code = () => `E${sfx}${++seq}`;

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;

const body = (over: Record<string, unknown> = {}) => ({
  empCode: code(),
  fullName: `Test Employee ${sfx}`,
  mobile: "9876543210",
  designation: "Operator",
  status: "active",
  ...over,
});

const post = async (over: Record<string, unknown> = {}, auth = OWNER.auth) =>
  (await api()).post("/api/employees").set(auth).send(body(over));

describe("employee master", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant("xemp");
  });

  describe("happy path", () => {
    it("creates an employee, defaults the work state, and upserts a payroll config", async () => {
      const empCode = code();
      const res = await post({
        empCode,
        email: `${empCode.toLowerCase()}@example.com`,
        gender: "Male",
        employeeType: "permanent",
        salaryType: "MONTHLY",
        basicSalary: 12000,
        grossSalary: 20000,
        da: 1000,
        hra: 2000,
        paymentMode: "bank",
        dateOfJoining: "2026-01-15",
        dateOfBirth: "1990-05-01",
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const e = res.body.data;
      expect(e.empCode).toBe(empCode);
      expect(e.status).toBe("active");
      // The lowercase enums are normalised by the controller.
      expect(e.gender).toBe("male");
      expect(e.salaryType).toBe("monthly");
      expect(Number(e.basicSalary)).toBe(12000);
      expect(e.workStateCode).toMatch(/^\d{2}$/);
      expect(e.user).toBeNull();

      const prisma = await getPrisma();
      const cfg = await asDemoTenant(() =>
        prisma.employeePayrollConfig.findUniqueOrThrow({ where: { employeeId: BigInt(e.id) } })
      );
      expect(cfg.salaryType).toBe("MONTHLY");
      expect(Number(cfg.monthlySalary)).toBe(20000);
      expect(Number(cfg.da)).toBe(1000);
      expect(Number(cfg.hra)).toBe(2000);
      expect(cfg.paymentMode).toBe("BANK");
    });

    it("creates a login account with the employee and never returns the password hash in a list", async () => {
      const prisma = await getPrisma();
      const role = await asDemoTenant(() =>
        prisma.role.findFirstOrThrow({ where: { code: "STORES" } })
      );
      const username = `emp.${sfx.toLowerCase()}.login`;
      const res = await post({
        createLoginAccount: true,
        loginAccount: { username, password: "Secret#12345", roleId: role.id },
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      expect(res.body.data.user.username).toBe(username);
      expect(res.body.data.user.roleId).toBe(role.id);
      expect(res.body.data.user.mustChangePw).toBe(true);

      const list = await (
        await api()
      )
        .get("/api/employees")
        .query({ search: res.body.data.empCode })
        .set(OWNER.auth);
      expect(list.status).toBe(200);
      expect(list.body.data.employees).toHaveLength(1);
      expect(list.body.data.employees[0].user.username).toBe(username);
      // The login works for the new account.
      expect(await loginAs(username, "Secret#12345")).toBeTruthy();
    });

    it("lists with search, status filter and pagination", async () => {
      const marker = `Lister ${sfx}`;
      for (let i = 0; i < 3; i++) await post({ fullName: `${marker} ${i}` });
      await post({ fullName: `${marker} gone`, status: "resigned" });
      const client = await api();
      const page1 = await client
        .get("/api/employees")
        .query({ search: marker, limit: "2", page: "1" })
        .set(OWNER.auth);
      expect(page1.status).toBe(200);
      expect(page1.body.data).toMatchObject({ total: 4, page: 1, totalPages: 2 });
      expect(page1.body.data.employees).toHaveLength(2);
      const resigned = await client
        .get("/api/employees")
        .query({ search: marker, status: "resigned" })
        .set(OWNER.auth);
      expect(resigned.body.data.total).toBe(1);
    });

    it("fetches by id, 404s on a missing id, and suggests the next code", async () => {
      const created = await post();
      const client = await api();
      const one = await client.get(`/api/employees/${created.body.data.id}`).set(OWNER.auth);
      expect(one.status).toBe(200);
      expect(one.body.data.empCode).toBe(created.body.data.empCode);
      expectCleanError(await client.get("/api/employees/999999999").set(OWNER.auth), 404);

      const next = await client.get("/api/employees/next-code").set(OWNER.auth);
      expect(next.status).toBe(200);
      expect(next.body.data.nextCode).toMatch(/\d/);
    });

    it("updates fields and the payroll config, partially", async () => {
      const created = await post({ basicSalary: 10000 });
      const id = created.body.data.id;
      const res = await (
        await api()
      )
        .put(`/api/employees/${id}`)
        .set(OWNER.auth)
        .send({ designation: "Supervisor", basicSalary: 15000, status: "INACTIVE" });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.data.designation).toBe("Supervisor");
      expect(res.body.data.status).toBe("inactive");
      expect(Number(res.body.data.basicSalary)).toBe(15000);
      // Untouched fields survive a partial update.
      expect(res.body.data.mobile).toBe("9876543210");
      const prisma = await getPrisma();
      const cfg = await asDemoTenant(() =>
        prisma.employeePayrollConfig.findUniqueOrThrow({ where: { employeeId: BigInt(id) } })
      );
      expect(Number(cfg.basicSalary)).toBe(15000);
    });

    it("adds and then edits a login account on update", async () => {
      const prisma = await getPrisma();
      const role = await asDemoTenant(() =>
        prisma.role.findFirstOrThrow({ where: { code: "AUDITOR" } })
      );
      const created = await post();
      const id = created.body.data.id;
      const username = `emp.${sfx.toLowerCase()}.upd`;
      const client = await api();
      const add = await client
        .put(`/api/employees/${id}`)
        .set(OWNER.auth)
        .send({
          createLoginAccount: true,
          loginAccount: { username, password: "Secret#12345", roleId: role.id },
        });
      expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBe(200);
      expect(add.body.data.user.username).toBe(username);
      const suspend = await client
        .put(`/api/employees/${id}`)
        .set(OWNER.auth)
        .send({
          createLoginAccount: true,
          loginAccount: { username, roleId: role.id, loginEnabled: false },
        });
      expect(suspend.status).toBe(200);
      expect(suspend.body.data.user.status).toBe("suspended");
    });

    it("searches active employees by code or name for the picker, capped and minimal", async () => {
      const marker = `Pick${sfx}`;
      await post({ fullName: `${marker} Active` });
      await post({ fullName: `${marker} Gone`, status: "resigned" });
      const client = await api();
      const res = await client.get("/api/employees/search").query({ q: marker }).set(OWNER.auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(
        ["businessPlace", "department", "empCode", "fullName", "id"].sort()
      );
      const empty = await client.get("/api/employees/search").query({ q: "  " }).set(OWNER.auth);
      expect(empty.body.data).toEqual([]);
    });

    it("returns the caller's own profile, with or without a linked employee", async () => {
      const client = await api();
      const res = await client.get("/api/employees/me").set(OWNER.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBeTruthy();
      expect(res.body.data.employeeLinked).toBe(false);
    });

    it("deletes an unreferenced employee together with its login account and payroll config", async () => {
      const prisma = await getPrisma();
      const role = await asDemoTenant(() =>
        prisma.role.findFirstOrThrow({ where: { code: "AUDITOR" } })
      );
      const username = `emp.${sfx.toLowerCase()}.del`;
      const created = await post({
        createLoginAccount: true,
        loginAccount: { username, password: "Secret#12345", roleId: role.id },
      });
      const id = created.body.data.id;
      const client = await api();
      const del = await client.delete(`/api/employees/${id}`).set(OWNER.auth);
      expect(del.status).toBe(200);
      expect((await client.get(`/api/employees/${id}`).set(OWNER.auth)).status).toBe(404);
      const [user, cfg] = await asDemoTenant(() =>
        Promise.all([
          prisma.user.findFirst({ where: { username } }),
          prisma.employeePayrollConfig.count({ where: { employeeId: BigInt(id) } }),
        ])
      );
      expect(user).toBeNull();
      expect(cfg).toBe(0);
    });

    it("refuses to delete an employee who is a store incharge or a source on a sales order", async () => {
      const prisma = await getPrisma();
      const client = await api();

      const incharge = await createEmployee();
      const storeCode = `ST-${sfx}`;
      await asDemoTenant(() =>
        prisma.store.create({
          data: {
            storeId: storeCode,
            storeName: "Incharge store",
            inchargeId: incharge.id,
          } as never,
        })
      );
      expectCleanError(
        await client.delete(`/api/employees/${incharge.id}`).set(OWNER.auth),
        400,
        /Incharge for a Store/
      );
      expect((await client.get(`/api/employees/${incharge.id}`).set(OWNER.auth)).status).toBe(200);
    });
  });

  describe("validation", () => {
    it("rejects a create with no empCode or fullName with the generic 400", async () => {
      const res = await (
        await api()
      )
        .post("/api/employees")
        .set(OWNER.auth)
        .send({ mobile: "9876543210" });
      expectCleanError(res, 400, "Invalid request data.");
    });

    it("rejects unknown enum values and an unparseable body with a clean 400", async () => {
      expectCleanError(await post({ gender: "robot" }), 400, "Invalid request data.");
      expectCleanError(await post({ employeeType: "wizard" }), 400, "Invalid request data.");
      expectCleanError(await post({ status: "on-fire" }), 400, "Invalid request data.");
      const raw = await (
        await api()
      )
        .post("/api/employees")
        .set(OWNER.auth)
        .set("Content-Type", "application/json")
        .send("{not json");
      expectCleanError(raw, 400, "Request body is not valid JSON.");
    });

    it("rejects over-long or out-of-range values with a field-level 400, never a 500", async () => {
      const mobile = await post({ mobile: "9".repeat(60) });
      expectCleanError(mobile, 400, "Validation failed");
      expect(mobile.body.errors.map((e: { path: string }) => e.path)).toContain("mobile");
      const code = await post({ empCode: "E".repeat(300) });
      expectCleanError(code, 400, "Validation failed");
      expectCleanError(await post({ basicSalary: 1e15 }), 400, "Validation failed");
      expectCleanError(await post({ basicSalary: -5 }), 400, "Validation failed");
      const upd = await createEmployee();
      expectCleanError(
        await (
          await api()
        )
          .put(`/api/employees/${upd.id}`)
          .set(OWNER.auth)
          .send({ mobile: "9".repeat(60) }),
        400,
        "Validation failed"
      );
    });

    it("rejects duplicate empCode, e-mail and statutory numbers with 400", async () => {
      const first = await post({
        email: `dup.${sfx.toLowerCase()}@example.com`,
        aadhaarNumber: `A${sfx}1`,
        panNumber: `P${sfx}1`,
        pfNumber: `PF${sfx}1`,
        uanNumber: `UA${sfx}1`,
        esiNumber: `ES${sfx}1`,
      });
      expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(201);
      expectCleanError(
        await post({ empCode: first.body.data.empCode }),
        400,
        "Employee code already exists"
      );
      expectCleanError(await post({ email: first.body.data.email }), 400, "Email already exists");
      expectCleanError(
        await post({ aadhaarNumber: first.body.data.aadhaarNumber }),
        400,
        "Aadhaar number already exists"
      );
      expectCleanError(
        await post({ panNumber: first.body.data.panNumber }),
        400,
        "PAN number already exists"
      );
      expectCleanError(
        await post({ pfNumber: first.body.data.pfNumber }),
        400,
        "PF number already exists"
      );
      expectCleanError(
        await post({ uanNumber: first.body.data.uanNumber }),
        400,
        "UAN number already exists"
      );
      expectCleanError(
        await post({ esiNumber: first.body.data.esiNumber }),
        400,
        "ESI number already exists"
      );

      // The same numbers are refused on update when they belong to someone else.
      const other = await post();
      const upd = await (
        await api()
      )
        .put(`/api/employees/${other.body.data.id}`)
        .set(OWNER.auth)
        .send({ empCode: first.body.data.empCode });
      expectCleanError(upd, 400, "Employee code already exists");
      const self = await (
        await api()
      )
        .put(`/api/employees/${first.body.data.id}`)
        .set(OWNER.auth)
        .send({ empCode: first.body.data.empCode });
      expect(self.status).toBe(200);
    });

    it("rejects a login account without a password, with a taken username, and rolls the employee back", async () => {
      const prisma = await getPrisma();
      const role = await asDemoTenant(() =>
        prisma.role.findFirstOrThrow({ where: { code: "STORES" } })
      );
      const empCode = code();
      const noPw = await post({
        empCode,
        createLoginAccount: true,
        loginAccount: { username: `nopw.${sfx.toLowerCase()}`, roleId: role.id },
      });
      expectCleanError(noPw, 400, "Password is required for creating a login account");
      expect(await asDemoTenant(() => prisma.employee.count({ where: { empCode } }))).toBe(0);

      const taken = await post({
        createLoginAccount: true,
        loginAccount: { username: "demo.owner", password: "Secret#12345", roleId: role.id },
      });
      expectCleanError(taken, 400, "Username already exists");
    });

    it("rejects unknown references: business place, department, role", async () => {
      expectCleanError(
        await post({ businessPlaceId: "999999999" }),
        400,
        "That business place does not exist"
      );
      expectCleanError(
        await post({ departmentId: 999999999 }),
        400,
        "That department does not exist"
      );
      expectCleanError(await post({ roleId: 999999999 }), 400, "That role does not exist");
    });

    it("answers 400 (not 500) for non-numeric and out-of-range ids, 404 for unknown ones", async () => {
      const client = await api();
      expectCleanError(await client.get("/api/employees/abc").set(OWNER.auth), 400);
      expectCleanError(
        await client.put("/api/employees/abc").set(OWNER.auth).send({ fullName: "x" }),
        400
      );
      expectCleanError(await client.delete("/api/employees/abc").set(OWNER.auth), 400);
      expectCleanError(
        await client.get("/api/employees/99999999999999999999999").set(OWNER.auth),
        400
      );
      expectCleanError(
        await client.put("/api/employees/999999999").set(OWNER.auth).send({ fullName: "x" }),
        404
      );
      expectCleanError(await client.delete("/api/employees/999999999").set(OWNER.auth), 404);
    });
  });

  describe("permissions", () => {
    it("refuses employees.* routes to roles without the key", async () => {
      const client = await api();
      const target = await createEmployee();
      // SALES_EXEC, STORES, PRODUCTION and ACCOUNTS hold only employees.search; AUDITOR the same.
      for (const user of ["demo.sales", "demo.stores", "demo.accounts", "demo.auditor"]) {
        const { auth } = await authed(user);
        expectCleanError(await client.get("/api/employees").set(auth), 403);
        expectCleanError(await client.get("/api/employees/next-code").set(auth), 403);
        expectCleanError(await client.get(`/api/employees/${target.id}`).set(auth), 403);
        expectCleanError(await client.post("/api/employees").set(auth).send(body()), 403);
        expectCleanError(
          await client.put(`/api/employees/${target.id}`).set(auth).send({ fullName: "x" }),
          403
        );
        expectCleanError(await client.delete(`/api/employees/${target.id}`).set(auth), 403);
        // ...but the light picker is open to them.
        expect((await client.get("/api/employees/search").query({ q: "a" }).set(auth)).status).toBe(
          200
        );
      }
      expect((await client.get("/api/employees")).status).toBe(401);
    });

    it("keeps /search behind employees.search", async () => {
      const prisma = await getPrisma();
      const client = await api();
      // A role with no employees.* key at all: reuse the foreign tenant's owner? No: create one.
      const role = await asDemoTenant(() =>
        prisma.role.create({
          data: { code: `NOEMP${sfx}`, name: `No employee ${sfx}`, isSystem: false },
        })
      );
      const hash = (
        await asDemoTenant(() =>
          prisma.user.findFirstOrThrow({ where: { username: "demo.owner" } })
        )
      ).passwordHash;
      const company = await prisma.company.findUniqueOrThrow({ where: { companyCode: "DEMO" } });
      const username = `noemp.${sfx.toLowerCase()}`;
      await withoutTenant(() =>
        prisma.user.create({
          data: {
            username,
            fullName: "No Employee Access",
            email: `${username}@example.com`,
            passwordHash: hash,
            roleId: role.id,
            companyId: company.id,
          },
        })
      );
      const token = await loginAs(username);
      const res = await client
        .get("/api/employees/search")
        .query({ q: "a" })
        .set({ Authorization: `Bearer ${token}` });
      expectCleanError(res, 403);
    });
  });

  describe("tenancy", () => {
    it("shows a foreign tenant's employees nowhere and cannot update or delete them", async () => {
      const prisma = await getPrisma();
      const foreign = await runAsTenant(FOREIGN.companyId, () =>
        prisma.employee.findFirstOrThrow()
      );
      const client = await api();

      const list = await client
        .get("/api/employees")
        .query({ search: foreign.empCode, limit: "100" })
        .set(OWNER.auth);
      expect(list.status).toBe(200);
      expect(
        list.body.data.employees.filter((e: { id: string }) => e.id === String(foreign.id))
      ).toEqual([]);
      expect(JSON.stringify(list.body)).not.toContain(FOREIGN.companyId);

      const search = await client
        .get("/api/employees/search")
        .query({ q: foreign.fullName })
        .set(OWNER.auth);
      expect(search.body.data.filter((e: { id: string }) => e.id === String(foreign.id))).toEqual(
        []
      );

      expectCleanError(await client.get(`/api/employees/${foreign.id}`).set(OWNER.auth), 404);
      expectCleanError(
        await client
          .put(`/api/employees/${foreign.id}`)
          .set(OWNER.auth)
          .send({ fullName: "Hijacked" }),
        404
      );
      expectCleanError(await client.delete(`/api/employees/${foreign.id}`).set(OWNER.auth), 404);

      const after = await runAsTenant(FOREIGN.companyId, () =>
        prisma.employee.findUniqueOrThrow({ where: { id: foreign.id } })
      );
      expect(after.fullName).toBe(foreign.fullName);
    });

    it("does not let the owner reach a foreign business place, department, role or shift from an employee", async () => {
      const prisma = await getPrisma();
      const foreign = await runAsTenant(FOREIGN.companyId, async () => ({
        place: await prisma.businessPlace.findFirstOrThrow(),
        dept: await prisma.department.findFirstOrThrow(),
        role: await prisma.role.findFirstOrThrow({ where: { code: "OWNER" } }),
      }));
      expectCleanError(
        await post({ businessPlaceId: String(foreign.place.id) }),
        400,
        "That business place does not exist"
      );
      expectCleanError(
        await post({ departmentId: foreign.dept.id }),
        400,
        "That department does not exist"
      );
      expectCleanError(await post({ roleId: foreign.role.id }), 400, "That role does not exist");

      const login = await post({
        createLoginAccount: true,
        loginAccount: {
          username: `xrole.${sfx.toLowerCase()}`,
          password: "Secret#12345",
          roleId: foreign.role.id,
        },
      });
      expectCleanError(login, 400, "That role does not exist");
      expect(
        await withoutTenant(() =>
          prisma.user.count({ where: { username: `xrole.${sfx.toLowerCase()}` } })
        )
      ).toBe(0);
    });

    it("refuses a foreign department or role on update too", async () => {
      const prisma = await getPrisma();
      const foreign = await runAsTenant(FOREIGN.companyId, async () => ({
        dept: await prisma.department.findFirstOrThrow(),
        role: await prisma.role.findFirstOrThrow({ where: { code: "OWNER" } }),
      }));
      const own = await createEmployee();
      const client = await api();
      expectCleanError(
        await client
          .put(`/api/employees/${own.id}`)
          .set(OWNER.auth)
          .send({ departmentId: foreign.dept.id }),
        400,
        "That department does not exist"
      );
      expectCleanError(
        await client
          .put(`/api/employees/${own.id}`)
          .set(OWNER.auth)
          .send({ roleId: foreign.role.id }),
        400,
        "That role does not exist"
      );
    });

    it("allows the same empCode in two tenants", async () => {
      const prisma = await getPrisma();
      const foreign = await runAsTenant(FOREIGN.companyId, () =>
        prisma.employee.findFirstOrThrow()
      );
      const res = await post({ empCode: foreign.empCode });
      // The demo tenant may or may not already hold that code (the seed uses the same ones).
      expect([201, 400]).toContain(res.status);
      if (res.status === 400) expect(res.body.message).toBe("Employee code already exists");
    });
  });
});
