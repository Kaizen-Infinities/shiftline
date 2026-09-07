import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed, ADMIN, SEED_PASSWORD } from "../helpers/app";
import { demoCompany } from "../factories";

/**
 * Platform console (P1-02): fleet overview, one tenant's detail with usage, users, overrides,
 * audit trail and devices, and suspend/activate that locks the tenant out at once.
 */
const adminLogin = async () => {
  const res = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: ADMIN.email, password: ADMIN.password });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
};

describe("platform console", () => {
  it("is super-admin only and describes the fleet and one tenant", async () => {
    const admin = await adminLogin();
    const owner = await authed("demo.owner");
    const client = await api();
    const company = await demoCompany();

    expect((await client.get("/api/platform/overview").set(owner.auth)).status).toBe(403);
    const overview = await client.get("/api/platform/overview").set(admin);
    expect(overview.status).toBe(200);
    expect(overview.body.data.tenants.total).toBeGreaterThanOrEqual(1);
    expect(overview.body.data.activeUsers).toBeGreaterThanOrEqual(1);

    const detail = await client.get(`/api/platform/tenants/${company.id}`).set(admin);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.company.id).toBe(company.id);
    expect(detail.body.data.usage.users).toBeGreaterThanOrEqual(6);
    expect(
      detail.body.data.owners.some((o: { username: string }) => o.username === "demo.owner")
    ).toBe(true);
    expect(detail.body.data.entitlements).toBeTruthy();
    expect((await client.get(`/api/platform/tenants/${randomUUID()}`).set(admin)).status).toBe(404);

    const users = await client.get(`/api/platform/tenants/${company.id}/users`).set(admin);
    expect(users.status).toBe(200);
    expect(users.body.data.map((u: { username: string }) => u.username)).toContain("demo.accounts");

    const overrides = await client.get(`/api/platform/tenants/${company.id}/overrides`).set(admin);
    expect(overrides.status).toBe(200);
    expect(Array.isArray(overrides.body.data)).toBe(true);

    const audit = await client
      .get(`/api/platform/tenants/${company.id}/audit`)
      .query({ pageSize: 5 })
      .set(admin);
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    expect(Array.isArray(audit.body.data.data)).toBe(true);
    expect(audit.body.data.total).toBeGreaterThan(0);

    const devices = await client.get(`/api/platform/tenants/${company.id}/devices`).set(admin);
    expect(devices.status).toBe(200);
    expect(Array.isArray(devices.body.data)).toBe(true);
  });

  it("suspending a tenant locks its users out until it is activated again", async () => {
    const admin = await adminLogin();
    const client = await api();
    const company = await demoCompany();
    const stores = await authed("demo.stores");
    expect((await client.get("/api/auth/me").set(stores.auth)).status).toBe(200);

    expect(
      (await client.put(`/api/platform/tenants/${company.id}`).set(admin).send({})).status
    ).toBe(400);
    const suspended = await client
      .put(`/api/platform/tenants/${company.id}`)
      .set(admin)
      .send({ isActive: false, suspendReason: "Invoice unpaid" });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.isActive).toBe(false);
    try {
      // Existing tokens stop working and a fresh login is refused with the tenant code.
      const locked = await client.get("/api/auth/me").set(stores.auth);
      expect([401, 403]).toContain(locked.status);
      const login = await client
        .post("/api/auth/login")
        .send({ email: "demo.stores", password: SEED_PASSWORD });
      expect(login.status).toBe(403);
      expect(login.body.code).toBe("TENANT_SUSPENDED");
      // The admin still sees the tenant.
      expect((await client.get(`/api/platform/tenants/${company.id}`).set(admin)).status).toBe(200);
    } finally {
      const back = await client
        .put(`/api/platform/tenants/${company.id}`)
        .set(admin)
        .send({ isActive: true });
      expect(back.status).toBe(200);
    }
    const login = await client
      .post("/api/auth/login")
      .send({ email: "demo.stores", password: SEED_PASSWORD });
    expect(login.status).toBe(200);
  });
});
