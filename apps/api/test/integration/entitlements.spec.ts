import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import { resetApiCaps } from "../../src/lib/tenant-rate-limit";
import { entitlementService } from "../../src/modules/entitlements/entitlement.service";

/**
 * Plan tiers and entitlements (P1-01): a permission is only usable when the
 * tenant's plan includes its feature; overrides, seats and the API cap follow
 * the subscription; the profile and the mobile bootstrap carry entitlements.
 */
const adminAuth = async () => {
  const login = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: ADMIN.email, password: ADMIN.password });
  return { Authorization: `Bearer ${login.body.data.accessToken}` };
};

describe("plans and entitlements", () => {
  const sfx = randomUUID().slice(0, 6);
  let tenantId: string;
  let owner: { Authorization: string };

  it("the catalogue exists and the demo tenant is on Enterprise with everything", async () => {
    const admin = await adminAuth();
    const plans = await (await api()).get("/api/platform/plans").set(admin);
    expect(plans.status).toBe(200);
    expect(plans.body.data.plans.map((p: { code: string }) => p.code)).toEqual([
      "STARTER",
      "GROWTH",
      "ENTERPRISE",
    ]);
    expect(plans.body.data.features.some((f: { key: string }) => f.key === "production")).toBe(
      true
    );

    const demo = await authed("demo.owner");
    const me = await (await api()).get("/api/auth/me").set(demo.auth);
    expect(me.body.data.entitlements).toMatchObject({
      plan: { code: "ENTERPRISE" },
      status: "ACTIVE",
      readOnly: false,
    });
    expect(me.body.data.entitlements.features).toContain("payroll");
    expect(me.body.data.entitlements.seatLimit).toBeNull();

    const own = await (await api()).get("/api/entitlements").set(demo.auth);
    expect(own.status).toBe(200);
    expect(own.body.data.plan.code).toBe("ENTERPRISE");
  });

  it("a Starter trial tenant is refused features outside its plan with a machine-readable code", async () => {
    const admin = await adminAuth();
    const created = await (
      await api()
    )
      .post("/api/platform/tenants")
      .set(admin)
      .send({
        companyCode: `E${sfx.toUpperCase()}`,
        companyName: "Entitled Ltd",
        slug: `ent-${sfx}`,
        owner: { email: `owner.${sfx}@ent.example`, fullName: "Ent Owner" },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    tenantId = created.body.data.company.id;
    expect(created.body.data.entitlements).toMatchObject({
      plan: { code: "STARTER" },
      status: "TRIALING",
    });
    expect(created.body.data.entitlements.trialEndsAt).toBeTruthy();

    const token = new URL(created.body.data.ownerInvitation.acceptUrl).searchParams.get("token")!;
    const accepted = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "EntOwner#2026!!" });
    owner = { Authorization: `Bearer ${accepted.body.data.accessToken}` };

    // Core and Starter features work; production does not.
    expect((await (await api()).get("/api/customers").set(owner)).status).toBe(200);
    expect((await (await api()).get("/api/raw-materials").set(owner)).status).toBe(200);
    const denied = await (await api()).get("/api/production-orders").set(owner);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("FEATURE_NOT_IN_PLAN");
    expect(denied.body.details).toEqual({ feature: "production" });
    const payroll = await (await api()).get("/api/payroll/runs").set(owner);
    expect(payroll.status).toBe(403);
    expect(payroll.body.code).toBe("FEATURE_NOT_IN_PLAN");

    // The mobile app is a Growth feature.
    const boot = await (await api()).get("/api/mobile/bootstrap").set(owner);
    expect(boot.status).toBe(403);
  });

  it("upgrading the plan opens the feature; an override closes it again and can expire", async () => {
    const admin = await adminAuth();
    const up = await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/subscription`)
      .set(admin)
      .send({ planCode: "GROWTH", status: "ACTIVE" });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data.entitlements.features).toContain("production");
    expect((await (await api()).get("/api/production-orders").set(owner)).status).toBe(200);

    const off = await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/overrides/production`)
      .set(admin)
      .send({ enabled: false, reason: "pilot paused" });
    expect(off.status).toBe(200);
    expect(off.body.data.entitlements.features).not.toContain("production");
    const denied = await (await api()).get("/api/production-orders").set(owner);
    expect(denied.status).toBe(403);

    // An expired override no longer counts.
    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    await runAsTenant(tenantId, () =>
      prisma.featureFlagOverride.updateMany({
        where: { feature: "production" },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
    );
    entitlementService.invalidate(tenantId);
    expect((await (await api()).get("/api/production-orders").set(owner)).status).toBe(200);

    // An enabling override adds a feature the plan lacks.
    const on = await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/overrides/payroll`)
      .set(admin)
      .send({ enabled: true, reason: "paid add-on" });
    expect(on.body.data.entitlements.features).toContain("payroll");
    expect((await (await api()).get("/api/payroll/runs").set(owner)).status).toBe(200);
    const gone = await (
      await api()
    )
      .delete(`/api/platform/tenants/${tenantId}/overrides/payroll`)
      .set(admin);
    expect(gone.status).toBe(200);
    expect((await (await api()).get("/api/payroll/runs").set(owner)).status).toBe(403);

    const detail = await (
      await api()
    )
      .get(`/api/platform/tenants/${tenantId}/subscription`)
      .set(admin);
    expect(detail.body.data.subscription.plan.code).toBe("GROWTH");
    expect(detail.body.data.overrides).toHaveLength(1);
  });

  it("seats: invitations stop at the plan's seat limit", async () => {
    const admin = await adminAuth();
    const set = await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/subscription`)
      .set(admin)
      .send({ seats: 2 });
    expect(set.status).toBe(200);
    expect(set.body.data.entitlements).toMatchObject({ seatLimit: 2, seatsUsed: 1 });

    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    const role = await runAsTenant(tenantId, () =>
      prisma.role.findFirstOrThrow({ where: { code: "ACCOUNTS" } })
    );
    const second = await (
      await api()
    )
      .post("/api/invitations")
      .set(owner)
      .send({ email: `two.${sfx}@ent.example`, roleId: role.id });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const third = await (
      await api()
    )
      .post("/api/invitations")
      .set(owner)
      .send({ email: `three.${sfx}@ent.example`, roleId: role.id });
    expect(third.status).toBe(403);
    expect(third.body.code).toBe("SEAT_LIMIT_REACHED");
    // Re-inviting a pending address replaces it and needs no extra seat.
    const again = await (
      await api()
    )
      .post("/api/invitations")
      .set(owner)
      .send({ email: `two.${sfx}@ent.example`, roleId: role.id });
    expect(again.status).toBe(201);
  });

  it("the API cap answers 429 with RateLimit headers once the window is spent", async () => {
    const admin = await adminAuth();
    const set = await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/subscription`)
      .set(admin)
      .send({ apiLimit: 3 });
    expect(set.status).toBe(200);
    resetApiCaps();
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      results.push((await (await api()).get("/api/customers").set(owner)).status);
    }
    expect(results).toEqual([200, 200, 200, 429, 429]);
    const last = await (await api()).get("/api/customers").set(owner);
    expect(last.body.code).toBe("API_LIMIT_REACHED");
    expect(last.headers["retry-after"]).toBeTruthy();
    expect(last.headers["ratelimit-limit"]).toBe("3");
    // Platform admins are never counted.
    expect((await (await api()).get("/api/platform/plans").set(admin)).status).toBe(200);
    await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/subscription`)
      .set(admin)
      .send({ apiLimit: null });
    resetApiCaps();
  });

  it("a suspended subscription is read-only; the demo tenant is unaffected", async () => {
    const admin = await adminAuth();
    await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/subscription`)
      .set(admin)
      .send({ status: "SUSPENDED" });
    expect((await (await api()).get("/api/customers").set(owner)).status).toBe(200);
    const write = await (
      await api()
    )
      .post("/api/customers")
      .set(owner)
      .send({ customerCode: `S${sfx}`, firmName: "Blocked" });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("SUBSCRIPTION_INACTIVE");

    const demo = await authed("demo.owner");
    expect((await (await api()).get("/api/production-orders").set(demo.auth)).status).toBe(200);
    expect(await asDemoTenant(async () => (await entitlementService.resolve()).readOnly)).toBe(
      false
    );
  });
});
