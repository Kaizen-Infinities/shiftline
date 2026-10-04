import { beforeAll, describe, expect, it } from "vitest";

import { api, authed, loginAs } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { hashPassword } from "../../src/utils/hashPassword";

/**
 * Security regression (F02, F03): an employee editor cannot create or change a login account
 * without users.create / users.edit, and no employee response carries authentication secrets.
 */
const sfx = Date.now().toString(36).slice(-5);
const FORBIDDEN_KEYS = /^(passwordHash|mfaSecret|refreshToken\w*)$/i;

const forbiddenKeys = (value: unknown, path = "$"): string[] => {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      FORBIDDEN_KEYS.test(k) ? [`${path}.${k}`] : forbiddenKeys(v, `${path}.${k}`)
    );
  }
  return [];
};

let OWNER: { auth: Record<string, string> };
let EDITOR: { auth: Record<string, string> };
let ROLE_ID: number;
let LINKED_EMPLOYEE_ID: string;
let PLAIN_EMPLOYEE_ID: string;
let LINKED_USER_ID: string;

describe("employee login accounts", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();
    const password = process.env.SEED_PASSWORD ?? "Test@12345678";

    await asDemoTenant(async () => {
      const role = await prisma.role.create({
        data: {
          companyId: company.id,
          code: `EMPED${sfx}`,
          name: `Employee editor ${sfx}`,
          isSystem: false,
        },
      });
      ROLE_ID = role.id;
      const perms = await prisma.permission.findMany({
        where: { key: { in: ["employees.view", "employees.create", "employees.edit"] } },
      });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ companyId: company.id, roleId: role.id, permissionId: p.id })),
      });
      await prisma.user.create({
        data: {
          companyId: company.id,
          username: `emped.${sfx}`,
          fullName: "Employee Editor",
          passwordHash: await hashPassword(password),
          roleId: role.id,
        },
      });

      const mk = (code: string) =>
        prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `LA-${sfx}-${code}`,
            fullName: `Login Test ${code}`,
            dateOfJoining: new Date("2030-04-01T00:00:00Z"),
            basicSalary: 15000,
            status: "active",
          },
        });
      const linked = await mk("L");
      LINKED_EMPLOYEE_ID = String(linked.id);
      PLAIN_EMPLOYEE_ID = String((await mk("P")).id);
      const user = await prisma.user.create({
        data: {
          companyId: company.id,
          username: `linked.${sfx}`,
          fullName: "Linked",
          passwordHash: await hashPassword(password),
          employeeId: linked.id,
          roleId: role.id,
          mfaSecret: "JBSWY3DPEHPK3PXP",
        },
      });
      LINKED_USER_ID = user.userId;
    });

    EDITOR = { auth: { Authorization: `Bearer ${await loginAs(`emped.${sfx}`)}` } };
  });

  it("rejects creating a login account without users.create", async () => {
    const res = await (
      await api()
    )
      .put(`/api/employees/${PLAIN_EMPLOYEE_ID}`)
      .set(EDITOR.auth)
      .send({
        createLoginAccount: true,
        loginAccount: { username: `new.${sfx}`, password: "Passw0rd!x", roleId: ROLE_ID },
      });
    expect(res.status).toBe(403);
    const prisma = await getPrisma();
    const created = await asDemoTenant(() =>
      prisma.user.findFirst({ where: { username: `new.${sfx}` } })
    );
    expect(created).toBeNull();
  });

  it("rejects changing a linked account's password or role without users.edit", async () => {
    const res = await (
      await api()
    )
      .put(`/api/employees/${LINKED_EMPLOYEE_ID}`)
      .set(EDITOR.auth)
      .send({
        createLoginAccount: true,
        loginAccount: { username: `linked.${sfx}`, password: "Takeover#1", roleId: ROLE_ID },
      });
    expect(res.status).toBe(403);
    const prisma = await getPrisma();
    const user = await asDemoTenant(() =>
      prisma.user.findUniqueOrThrow({ where: { userId: LINKED_USER_ID } })
    );
    expect(user.username).toBe(`linked.${sfx}`);
  });

  it("rejects a malformed loginAccount body", async () => {
    const res = await (
      await api()
    )
      .put(`/api/employees/${PLAIN_EMPLOYEE_ID}`)
      .set(OWNER.auth)
      .send({ createLoginAccount: true, loginAccount: { username: "x", roleId: "admin" } });
    expect(res.status).toBe(400);
  });

  it("rejects a role from another tenant or one that does not exist", async () => {
    const res = await (
      await api()
    )
      .put(`/api/employees/${PLAIN_EMPLOYEE_ID}`)
      .set(OWNER.auth)
      .send({
        createLoginAccount: true,
        loginAccount: { username: `norole.${sfx}`, password: "Passw0rd!x", roleId: 2147483000 },
      });
    expect(res.status).toBe(400);
  });

  it("lets a caller holding users.create make the account", async () => {
    const res = await (
      await api()
    )
      .put(`/api/employees/${PLAIN_EMPLOYEE_ID}`)
      .set(OWNER.auth)
      .send({
        createLoginAccount: true,
        loginAccount: { username: `ok.${sfx}`, password: "Passw0rd!x", roleId: ROLE_ID },
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(forbiddenKeys(res.body)).toEqual([]);
  });

  it("returns no authentication secrets from employee list and detail", async () => {
    const client = await api();
    const list = await client.get("/api/employees?limit=100").set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(`linked.${sfx}`);
    expect(forbiddenKeys(list.body)).toEqual([]);

    const detail = await client.get(`/api/employees/${LINKED_EMPLOYEE_ID}`).set(OWNER.auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data.user.username).toBe(`linked.${sfx}`);
    expect(forbiddenKeys(detail.body)).toEqual([]);
    expect(JSON.stringify(detail.body)).not.toContain("JBSWY3DPEHPK3PXP");
  });
});
