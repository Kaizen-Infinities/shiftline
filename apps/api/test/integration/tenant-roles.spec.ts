import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { api, authed, loginAs, SEED_PASSWORD } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { demoCompany } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { seedTenant } from "../../prisma/seed-lib";

/**
 * F01 / JWT-01 / JWT-02 / API-02 / API-04: roles are tenant-bound, effective permissions fail
 * closed, a password change ends the other sessions and the reset routes sit behind the tight
 * credential limiter. Tenant A is the demo tenant; tenant B is seeded here.
 */
describe("tenant-bound roles and sessions", () => {
  let tenantA: string;
  let tenantB: string;
  let roleB: number; // B's owner role
  let roleA: number; // A's accounts role
  let permissionId: number;

  beforeAll(async () => {
    const prisma = await getPrisma();
    tenantA = (await demoCompany()).id;
    const b = await seedTenant({
      companyCode: "TEN-R",
      companyName: "Role Tenant B",
      slug: "rolesb",
      globalPrefix: "RB",
      password: SEED_PASSWORD,
    });
    tenantB = b.id;
    // B's sales role: a role that does not hold every permission.
    roleB = (
      await runAsTenant(tenantB, () =>
        prisma.user.findFirstOrThrow({ where: { username: "rolesb.sales" } })
      )
    ).roleId!;
    roleA = (
      await runAsTenant(tenantA, () => prisma.role.findFirstOrThrow({ orderBy: { id: "asc" } }))
    ).id;
    // A permission B's role does not hold yet (grants are keyed by role and permission).
    const held = await withoutTenant(() =>
      prisma.rolePermission.findMany({ where: { roleId: roleB } })
    );
    const free = await prisma.permission.findFirstOrThrow({
      where: { id: { notIn: held.map((h) => h.permissionId) } },
    });
    permissionId = free.id;
  });

  afterAll(async () => {
    const prisma = await getPrisma();
    await withoutTenant(() =>
      prisma.user.deleteMany({ where: { username: { startsWith: "xt-" } } })
    );
  });

  const bGrantCount = async (rid: number) => {
    const prisma = await getPrisma();
    return withoutTenant(() => prisma.rolePermission.count({ where: { roleId: rid } }));
  };

  it("A cannot assign permissions to B's role", async () => {
    const { auth } = await authed("demo.owner");
    const before = await bGrantCount(roleB);
    const res = await (
      await api()
    )
      .post("/api/role-permissions/assign")
      .set(auth)
      .send({ roleId: roleB, permissionIds: [permissionId] });
    expect(res.status).toBe(404);
    expect(await bGrantCount(roleB)).toBe(before);
  });

  it("A cannot read or remove grants on B's role", async () => {
    const { auth } = await authed("demo.owner");
    const get = await (await api()).get(`/api/role-permissions/role/${roleB}`).set(auth);
    expect(get.status).toBe(404);
    const del = await (
      await api()
    )
      .delete("/api/role-permissions/remove")
      .set(auth)
      .send({ roleId: roleB, permissionId });
    expect(del.status).toBe(404);
  });

  it("A cannot create a user with B's role, and weak input is rejected", async () => {
    const { auth } = await authed("demo.owner");
    const base = { fullName: "Cross Tenant", username: "xt-user", password: "Str0ngPassw0rd" };
    const foreign = await (
      await api()
    )
      .post("/api/users")
      .set(auth)
      .send({ ...base, roleId: roleB });
    expect(foreign.status).toBe(404);

    const weak = await (
      await api()
    )
      .post("/api/users")
      .set(auth)
      .send({ ...base, password: "short", roleId: roleA });
    expect(weak.status).toBe(400);

    const noRole = await (
      await api()
    )
      .post("/api/users")
      .set(auth)
      .send({ ...base });
    expect(noRole.status).toBe(400);

    const prisma = await getPrisma();
    const created = await withoutTenant(() =>
      prisma.user.count({ where: { username: "xt-user" } })
    );
    expect(created).toBe(0);
  });

  it("A cannot register a user with B's role", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (await api()).post("/api/auth/register").set(auth).send({
      fullName: "Cross Tenant",
      email: "xt-register@example.test",
      username: "xt-register",
      password: "Str0ngPassw0rd",
      roleId: roleB,
    });
    expect(res.status).toBe(404);
  });

  it("the database refuses a role grant that crosses tenants", async () => {
    const prisma = await getPrisma();
    await expect(
      withoutTenant(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO role_permissions (company_id, "roleId", "permissionId") VALUES ('${tenantA}'::uuid, ${roleB}, ${permissionId})`
        )
      )
    ).rejects.toThrow();
  });

  it("a legacy foreign RolePermission row does not affect B's authentication", async () => {
    const prisma = await getPrisma();
    const fkA = "role_permissions_company_id_roleId_fkey";
    const sales = await runAsTenant(tenantB, () =>
      prisma.user.findFirstOrThrow({ where: { username: "rolesb.sales" } })
    );
    const usersView = await prisma.permission.findUniqueOrThrow({ where: { key: "users.view" } });
    const held = await withoutTenant(() =>
      prisma.rolePermission.count({ where: { roleId: sales.roleId!, permissionId: usersView.id } })
    );
    expect(held).toBe(0); // the sales role must not already hold users.view
    // Reproduce pre-migration data: drop the FK, plant A's grant on B's role, then restore.
    await prisma.$executeRawUnsafe(`ALTER TABLE role_permissions DROP CONSTRAINT "${fkA}"`);
    try {
      await withoutTenant(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO role_permissions (company_id, "roleId", "permissionId") VALUES ('${tenantA}'::uuid, ${sales.roleId}, ${usersView.id})`
        )
      );
      const auth = { Authorization: `Bearer ${await loginAs("rolesb.sales")}` };
      const me = await (await api()).get("/api/auth/me").set(auth);
      expect(me.status).toBe(200);
      expect((me.body?.data?.permissions ?? []) as string[]).not.toContain("users.view");
      // The middleware ignores the foreign grant too (it would otherwise let this through).
      expect((await (await api()).get("/api/users").set(auth)).status).toBe(403);
    } finally {
      await withoutTenant(() =>
        prisma.$executeRawUnsafe(
          `DELETE FROM role_permissions WHERE company_id = '${tenantA}'::uuid AND "roleId" = ${sales.roleId}`
        )
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE role_permissions ADD CONSTRAINT "${fkA}" FOREIGN KEY (company_id, "roleId") REFERENCES roles(company_id, id) ON DELETE CASCADE ON UPDATE CASCADE`
      );
    }
  });

  it("a removed or inactive role yields no permissions, whatever the token says", async () => {
    const prisma = await getPrisma();
    const token = await loginAs("rolesb.owner");
    const auth = { Authorization: `Bearer ${token}` };
    const ok = await (await api()).get("/api/users").set(auth);
    expect(ok.status).toBe(200);

    const user = await runAsTenant(tenantB, () =>
      prisma.user.findFirstOrThrow({ where: { username: "rolesb.owner" } })
    );
    try {
      await runAsTenant(tenantB, () =>
        prisma.role.update({ where: { id: user.roleId! }, data: { status: "inactive" } })
      );
      expect((await (await api()).get("/api/users").set(auth)).status).toBe(403);
    } finally {
      await runAsTenant(tenantB, () =>
        prisma.role.update({ where: { id: user.roleId! }, data: { status: "active" } })
      );
    }

    try {
      await runAsTenant(tenantB, () =>
        prisma.user.update({ where: { userId: user.userId }, data: { roleId: null } })
      );
      expect((await (await api()).get("/api/users").set(auth)).status).toBe(403);
    } finally {
      await runAsTenant(tenantB, () =>
        prisma.user.update({ where: { userId: user.userId }, data: { roleId: user.roleId } })
      );
    }
    expect((await (await api()).get("/api/users").set(auth)).status).toBe(200);
  });

  it("changing the password ends the user's other sessions but not the current one", async () => {
    const login = async () =>
      (
        await (
          await api()
        )
          .post("/api/auth/login")
          .send({ email: "rolesb.accounts", password: SEED_PASSWORD })
      ).body.data.accessToken as string;
    const t1 = await login();
    const t2 = await login();
    const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
    expect((await (await api()).get("/api/auth/me").set(bearer(t2))).status).toBe(200);

    const res = await (
      await api()
    )
      .post("/api/auth/change-password")
      .set(bearer(t1))
      .send({ oldPassword: SEED_PASSWORD, newPassword: "Changed#Pass2026" });
    expect(res.status).toBe(200);

    expect((await (await api()).get("/api/auth/me").set(bearer(t2))).status).toBe(401);
    expect((await (await api()).get("/api/auth/me").set(bearer(t1))).status).toBe(200);
  });
});

describe("credential limiter and URL redaction", () => {
  it("API-04: redacts capability query parameters", async () => {
    const { redactUrl } = await import("../../src/lib/redact-url");
    expect(redactUrl("/api/x/download?token=abc123&page=2")).toBe(
      "/api/x/download?token=[REDACTED]&page=2"
    );
    expect(redactUrl("/cb?a=1&code=zzz&signature=q")).toBe(
      "/cb?a=1&code=[REDACTED]&signature=[REDACTED]"
    );
    expect(redactUrl("/plain?x=1")).toBe("/plain?x=1");
  });

  it("API-02: the real reset routes are behind the tight limiter", async () => {
    // The limiter is skipped under NODE_ENV=test, so load a fresh app as a development one.
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    try {
      const { default: freshApp } = await import("../../src/app");
      const { env } = await import("../../src/config/env");
      const { default: request } = await import("supertest");
      for (const path of ["/api/auth/password-reset-request", "/api/auth/password-reset"]) {
        let limited = 0;
        for (let i = 0; i < env.AUTH_RATE_LIMIT_MAX + 3; i++) {
          // An invalid body is rejected by validation, after the limiter has counted it.
          const res = await request(freshApp).post(path).send({});
          if (res.status === 429) limited++;
        }
        expect(limited, path).toBeGreaterThan(0);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
