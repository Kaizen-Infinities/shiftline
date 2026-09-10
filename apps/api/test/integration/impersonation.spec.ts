import { describe, expect, it } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * Impersonation and device-bound sessions (P1-02). A platform admin acts as a tenant user for
 * thirty minutes with a reason; every audit row written meanwhile names the admin. A native
 * client's refresh token is bound to its device id and dies when the device is revoked.
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

describe("impersonation", () => {
  it("lets an admin act as a tenant user, marks the audit rows, and ends on request", async () => {
    const admin = await adminLogin();
    const client = await api();
    const company = await demoCompany();
    const prisma = await getPrisma();

    // Reason is required; tenant users cannot impersonate.
    expect(
      (await client.post(`/api/platform/tenants/${company.id}/impersonate`).set(admin).send({}))
        .status
    ).toBe(400);
    const owner = await authed("demo.owner");
    expect(
      (
        await client
          .post(`/api/platform/tenants/${company.id}/impersonate`)
          .set(owner.auth)
          .send({ reason: "should be refused" })
      ).status
    ).toBe(403);

    const started = await client
      .post(`/api/platform/tenants/${company.id}/impersonate`)
      .set(admin)
      .send({ reason: "Support ticket 4711: reproduce the GST split" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const { accessToken, impersonation, user } = started.body.data;
    expect(user.username).toBe("demo.owner");
    const cap =
      new Date(impersonation.expiresAt).getTime() - new Date(impersonation.startedAt).getTime();
    expect(cap).toBeLessThanOrEqual(30 * 60 * 1000);
    const asOwner = { Authorization: `Bearer ${accessToken}` };

    // The token works as the owner, inside the tenant, without platform powers.
    const me = await client.get("/api/auth/me").set(asOwner);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.data.user.username).toBe("demo.owner");
    expect(me.body.data.isSuperAdmin).toBe(false);
    expect((await client.get("/api/platform/tenants").set(asOwner)).status).toBe(403);

    // A write during impersonation is audited with the admin as impersonator.
    const created = await client
      .post("/api/accounts/groups")
      .set(asOwner)
      .send({ name: `Impersonated group ${Date.now().toString(36)}`, parentId: 1 });
    if (created.status !== 201) {
      // parentId 1 may not be this tenant's; fall back to any group.
      const groups = await client.get("/api/accounts/groups?flat=true").set(asOwner);
      const parent = groups.body.data[0];
      const again = await client
        .post("/api/accounts/groups")
        .set(asOwner)
        .send({ name: `Impersonated group ${Date.now().toString(36)}`, parentId: parent.id });
      expect(again.status).toBe(201);
      created.body = again.body;
    }
    const groupId = String(created.body.data.id);
    const audit = await asDemoTenant(() =>
      prisma.auditLog.findFirst({
        where: { entityName: "ledger_groups", entityId: groupId, action: "CREATE" },
        orderBy: { changedAt: "desc" },
      })
    );
    expect(audit).not.toBeNull();
    expect(audit!.impersonatedBy).toBe(impersonation.impersonatedBy);
    expect(audit!.changedBy).toBe(user.userId);

    // The console lists it as active; the impersonator can end it; the token then dies.
    const list = await client.get("/api/platform/impersonations?active=true").set(admin);
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: { id: string }) => r.id === impersonation.id)).toBe(true);
    expect((await client.post("/api/auth/impersonation/end").set(owner.auth)).status).toBe(400);
    expect((await client.post("/api/auth/impersonation/end").set(asOwner)).status).toBe(200);
    const after = await client.get("/api/auth/me").set(asOwner);
    expect(after.status).toBe(401);
    expect(after.body.code ?? after.body.error?.code).toBe("IMPERSONATION_ENDED");
    const history = await client
      .get(`/api/platform/impersonations?companyId=${company.id}`)
      .set(admin);
    const row = history.body.data.find((r: { id: string }) => r.id === impersonation.id);
    expect(row).toMatchObject({ active: false, endedReason: "ended by impersonator" });
  });

  it("an admin can end a session from the console and cannot impersonate an unknown user", async () => {
    const admin = await adminLogin();
    const client = await api();
    const company = await demoCompany();
    expect(
      (
        await client
          .post(`/api/platform/tenants/${company.id}/impersonate`)
          .set(admin)
          .send({ reason: "nobody home", userId: "00000000-0000-0000-0000-000000000000" })
      ).status
    ).toBe(404);
    const started = await client
      .post(`/api/platform/tenants/${company.id}/impersonate`)
      .set(admin)
      .send({ reason: "Console-ended session" });
    expect(started.status).toBe(200);
    const id = started.body.data.impersonation.id as string;
    const ended = await client.post(`/api/platform/impersonations/${id}/end`).set(admin);
    expect(ended.status).toBe(200);
    expect(ended.body.data.endedReason).toBe("ended by admin");
    expect(
      (
        await client
          .get("/api/auth/me")
          .set({ Authorization: `Bearer ${started.body.data.accessToken}` })
      ).status
    ).toBe(401);
  });
});

describe("device-bound sessions", () => {
  const DEVICE = `test-device-bind-${Date.now().toString(36)}`;
  const dev = {
    "x-device-id": DEVICE,
    "x-app-version": "1.0.0-test",
    "x-device-platform": "android",
  };

  it("binds a native login to its device, refuses other devices, and dies when the device is revoked", async () => {
    const client = await api();
    const login = await client
      .post("/api/auth/login")
      .set(dev)
      .send({ email: "demo.sales", password: "Test@12345678" });
    expect(login.status).toBe(200);
    const { accessToken, refreshToken } = login.body.data;
    expect(refreshToken).toBeTruthy();
    const auth = { Authorization: `Bearer ${accessToken}` };

    // Registers the device with the tenant; the access token only works with the device header.
    expect((await client.get("/api/mobile/bootstrap").set(auth).set(dev)).status).toBe(200);
    const bare = await client.get("/api/auth/me").set(auth);
    expect(bare.status).toBe(401);
    expect(bare.body.code ?? bare.body.error?.code).toBe("DEVICE_MISMATCH");
    expect((await client.get("/api/auth/me").set(auth).set(dev)).status).toBe(200);

    // Refresh needs the same device.
    const wrong = await client
      .post("/api/auth/refresh")
      .set({ "x-device-id": "someone-elses-phone" })
      .send({ refreshToken });
    expect(wrong.status).toBe(401);
    const ok = await client.post("/api/auth/refresh").set(dev).send({ refreshToken });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const rotated = ok.body.data.refreshToken as string;
    expect(rotated).toBeTruthy();

    // Revoke from the office: the session is gone and the refresh is refused with the wipe code.
    const owner = await authed("demo.owner");
    const devices = await client.get("/api/mobile/admin/devices").set(owner.auth);
    const mine = devices.body.data.find((d: { deviceId: string }) => d.deviceId === DEVICE);
    expect(mine).toBeTruthy();
    expect(
      (await client.post(`/api/mobile/admin/devices/${mine.id}/revoke`).set(owner.auth)).status
    ).toBe(200);
    const dead = await client
      .get("/api/auth/me")
      .set({ Authorization: `Bearer ${ok.body.data.accessToken}` })
      .set(dev);
    expect(dead.status).toBe(401);
    const refused = await client.post("/api/auth/refresh").set(dev).send({ refreshToken: rotated });
    expect([401, 403]).toContain(refused.status);
  });
});
