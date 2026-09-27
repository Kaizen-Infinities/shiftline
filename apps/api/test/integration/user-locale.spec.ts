import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN, api, authed, loginAs } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Per-user UI language (TN-04): PATCH /api/users/me/locale changes only the caller's row,
 * validates the value, and the login and profile responses carry the locale the web reads.
 */
const sfx = Date.now().toString(36).slice(-5);

let PRODUCTION: { auth: Record<string, string> };
let STORES: { auth: Record<string, string> };

const localeOf = async (username: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    return user.locale;
  });
};

describe("user UI language (TN-04)", () => {
  beforeAll(async () => {
    PRODUCTION = await authed("demo.production");
    STORES = await authed("demo.stores");
  });

  afterAll(async () => {
    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.user.updateMany({
        where: { username: { in: ["demo.production", "demo.stores"] } },
        data: { locale: "en" },
      })
    );
  });

  it("defaults to English in the profile", async () => {
    const res = await (await api()).get("/api/auth/me").set(STORES.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.user.locale).toBe("en");
  });

  it("sets the caller's own language to Tamil and returns the updated profile", async () => {
    const res = await (
      await api()
    )
      .patch("/api/users/me/locale")
      .set(PRODUCTION.auth)
      .send({ locale: "ta" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ username: "demo.production", locale: "ta" });
    expect(await localeOf("demo.production")).toBe("ta");

    const me = await (await api()).get("/api/auth/me").set(PRODUCTION.auth);
    expect(me.body.data.user.locale).toBe("ta");
    const profile = await (await api()).get("/api/users/profile").set(PRODUCTION.auth);
    expect(profile.body.data.locale).toBe("ta");
  });

  it("returns the locale in the login response", async () => {
    const res = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: "demo.production", password: "Test@12345678" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.locale).toBe("ta");
  });

  it("switches back to English", async () => {
    const res = await (
      await api()
    )
      .patch("/api/users/me/locale")
      .set(PRODUCTION.auth)
      .send({ locale: "en" });
    expect(res.status).toBe(200);
    expect(res.body.data.locale).toBe("en");
    expect(await localeOf("demo.production")).toBe("en");
  });

  it.each([
    ["an unsupported language", { locale: "fr" }],
    ["a missing value", {}],
    ["a non-string value", { locale: 1 }],
    ["an empty string", { locale: "" }],
    ["a different case", { locale: "TA" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await (await api()).patch("/api/users/me/locale").set(STORES.auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    expect(await localeOf("demo.stores")).toBe("en");
  });

  it("refuses an unauthenticated call with 401", async () => {
    const res = await (await api()).patch("/api/users/me/locale").send({ locale: "ta" });
    expect(res.status).toBe(401);
  });

  it("cannot change another user's language", async () => {
    const prisma = await getPrisma();
    const storesId = await asDemoTenant(
      async () =>
        (await prisma.user.findUniqueOrThrow({ where: { username: "demo.stores" } })).userId
    );
    // Naming another user in the body is refused outright...
    const named = await (
      await api()
    )
      .patch("/api/users/me/locale")
      .set(PRODUCTION.auth)
      .send({ locale: "ta", userId: storesId });
    expect(named.status).toBe(400);
    // ...there is no per-id variant...
    const byId = await (
      await api()
    )
      .patch(`/api/users/${storesId}/locale`)
      .set(PRODUCTION.auth)
      .send({ locale: "ta" });
    expect(byId.status).toBe(404);
    // ...and a valid call touches only the caller.
    await (await api()).patch("/api/users/me/locale").set(PRODUCTION.auth).send({ locale: "ta" });
    expect(await localeOf("demo.stores")).toBe("en");
    expect(await localeOf("demo.production")).toBe("ta");
  });

  it("keeps platform admins in English", async () => {
    const token = await loginAs(ADMIN.email, ADMIN.password);
    const res = await (
      await api()
    )
      .patch("/api/users/me/locale")
      .set({ Authorization: `Bearer ${token}` })
      .send({ locale: "ta" });
    expect(res.status).toBe(403);
    const me = await (await api()).get("/api/auth/me").set({ Authorization: `Bearer ${token}` });
    expect(me.body.data.user.locale).toBe("en");
  });

  it("a foreign company cannot see the demo user's language", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Locale Tenant B", companyCode: `LCB-${sfx}` } })
    );
    expect(
      await runAsTenant(other.id, () =>
        prisma.user.findFirst({ where: { username: "demo.production" } })
      )
    ).toBeNull();
    expect(await runAsTenant(other.id, () => prisma.user.count({ where: { locale: "ta" } }))).toBe(
      0
    );
  });
});
