import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { demoCompany } from "../factories";

const adminAuth = async () => {
  const login = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: ADMIN.email, password: ADMIN.password });
  expect(login.status).toBe(200);
  return { Authorization: `Bearer ${login.body.data.accessToken}` };
};

describe("tenant provisioning and invitations", () => {
  const suffix = randomUUID().slice(0, 6);
  const companyCode = `T${suffix.toUpperCase()}`;
  const slug = `t-${suffix}`;
  const ownerEmail = `owner.${suffix}@newco.example`;
  let companyId: string;
  let ownerAcceptUrl: string;

  it("a platform admin provisions a tenant with everything a company needs on day one", async () => {
    const auth = await adminAuth();
    const res = await (
      await api()
    )
      .post("/api/platform/tenants")
      .set(auth)
      .send({
        companyCode,
        companyName: "New Company Industries",
        slug,
        gstin: "29AAAAA0000A1Z5",
        owner: { email: ownerEmail, fullName: "New Owner" },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    companyId = res.body.data.company.id;
    expect(res.body.data.roles).toMatchObject({
      OWNER: expect.any(Number),
      ACCOUNTS: expect.any(Number),
      SALES_EXEC: expect.any(Number),
    });
    expect(res.body.data.ownerInvitation).toMatchObject({ email: ownerEmail });
    expect(res.body.data.ownerInvitation.acceptUrl).toMatch(
      /accept-invitation\?token=[0-9a-f]{64}$/
    );
    ownerAcceptUrl = res.body.data.ownerInvitation.acceptUrl;

    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    await runAsTenant(companyId, async () => {
      expect(await prisma.role.count()).toBe(5);
      expect(
        await prisma.accountLedger.count({ where: { code: { in: ["CASH-001", "BANK-001"] } } })
      ).toBe(2);
      const ho = await prisma.businessPlace.findFirstOrThrow({ where: { code: "HO" } });
      expect(ho.gstPlaceCode).toBe("29"); // derived from the GSTIN
      expect(await prisma.unitOfMeasure.count()).toBeGreaterThanOrEqual(5);
      expect(await prisma.accountingPeriod.count()).toBe(1);
      expect(await prisma.invoiceSetting.count()).toBe(1);
      expect(await prisma.documentSequence.count()).toBeGreaterThanOrEqual(10);
      expect(await prisma.systemSetting.count({ where: { key: "MOBILE_ORDER_STATUS" } })).toBe(1);
      expect(await prisma.invitation.count()).toBe(1);
    });

    // Re-running is idempotent: same company, defaults ensured, nothing duplicated.
    const again = await (
      await api()
    )
      .post("/api/platform/tenants")
      .set(auth)
      .send({
        companyCode,
        companyName: "New Company Industries",
        slug,
        owner: { email: ownerEmail, fullName: "New Owner" },
      });
    expect(again.status).toBe(200);
    // The re-run replaced the pending owner invitation; use the live link from here on.
    ownerAcceptUrl = again.body.data.ownerInvitation.acceptUrl;
    await runAsTenant(companyId, async () => {
      expect(await prisma.role.count()).toBe(5);
      expect(await prisma.accountingPeriod.count()).toBe(1);
      // The earlier pending invitation was replaced, not duplicated.
      expect(await prisma.invitation.count({ where: { revokedAt: null } })).toBe(1);
    });

    const list = await (await api()).get("/api/platform/tenants").set(auth);
    expect(list.status).toBe(200);
    const row = list.body.data.find((t: { id: string }) => t.id === companyId);
    expect(row).toMatchObject({ slug, isOnboarded: false, onboardingStep: "company" });
  });

  it("refuses a slug that is already taken and tenants cannot reach platform routes", async () => {
    const auth = await adminAuth();
    const dup = await (
      await api()
    )
      .post("/api/platform/tenants")
      .set(auth)
      .send({
        companyCode: `X${suffix.toUpperCase()}`,
        companyName: "Copycat",
        slug,
        owner: { email: `x.${suffix}@newco.example`, fullName: "Copycat Owner" },
      });
    expect(dup.status).toBe(409);
    const tenant = await authed("demo.owner");
    expect((await (await api()).get("/api/platform/tenants").set(tenant.auth)).status).toBe(403);
  });

  it("the invited owner accepts, gets the OWNER role and is signed in", async () => {
    const token = new URL(ownerAcceptUrl).searchParams.get("token")!;
    const preview = await (await api()).get(`/api/invitations/token/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      email: ownerEmail,
      companyName: "New Company Industries",
      roleName: "Owner",
    });

    const weak = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "short" });
    expect(weak.status).toBe(400);

    const accept = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "NewOwner#2026!!" });
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    expect(accept.body.data.accessToken).toBeTruthy();
    expect(String(accept.headers["set-cookie"])).toMatch(/shiftline_rt=/);

    // The new owner works inside their own tenant only.
    const me = await (
      await api()
    )
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accept.body.data.accessToken}`);
    expect(me.status).toBe(200);
    const customers = await (
      await api()
    )
      .get("/api/customers")
      .set("Authorization", `Bearer ${accept.body.data.accessToken}`);
    expect(customers.status).toBe(200);
    const list = Array.isArray(customers.body.data)
      ? customers.body.data
      : (customers.body.data?.data ?? []);
    expect(list).toHaveLength(0);

    // The link is single-use.
    const twice = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "NewOwner#2026!!" });
    expect(twice.status).toBe(410);
  });

  it("an owner invites a colleague; revoked and expired links are refused", async () => {
    const { auth } = await authed("demo.owner");
    const prisma = await getPrisma();
    const demo = await demoCompany();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    const role = await runAsTenant(demo.id, () =>
      prisma.role.findFirstOrThrow({ where: { code: "ACCOUNTS" } })
    );
    const email = `colleague.${suffix}@demo.shiftline.local`;

    const created = await (
      await api()
    )
      .post("/api/invitations")
      .set(auth)
      .send({ email, fullName: "New Colleague", roleId: role.id });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.acceptUrl).toBeTruthy();

    const listed = await (await api()).get("/api/invitations").set(auth);
    expect(listed.body.data.some((i: { email: string }) => i.email === email)).toBe(true);

    // Inviting the same email again replaces the pending one.
    const replaced = await (
      await api()
    )
      .post("/api/invitations")
      .set(auth)
      .send({ email, roleId: role.id });
    expect(replaced.status).toBe(201);
    const firstToken = new URL(created.body.data.acceptUrl).searchParams.get("token")!;
    expect((await (await api()).get(`/api/invitations/token/${firstToken}`)).status).toBe(404);

    // Revoke the live one; the link dies.
    const revoked = await (
      await api()
    )
      .post(`/api/invitations/${replaced.body.data.id}/revoke`)
      .set(auth);
    expect(revoked.status).toBe(200);
    const liveToken = new URL(replaced.body.data.acceptUrl).searchParams.get("token")!;
    expect((await (await api()).get(`/api/invitations/token/${liveToken}`)).status).toBe(404);

    // Expired invitations answer 410.
    const third = await (
      await api()
    )
      .post("/api/invitations")
      .set(auth)
      .send({ email, roleId: role.id });
    await runAsTenant(demo.id, () =>
      prisma.invitation.update({
        where: { id: third.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
    );
    const expiredToken = new URL(third.body.data.acceptUrl).searchParams.get("token")!;
    expect((await (await api()).get(`/api/invitations/token/${expiredToken}`)).status).toBe(410);

    // Field users cannot invite.
    const sales = await authed("demo.sales");
    const denied = await (
      await api()
    )
      .post("/api/invitations")
      .set(sales.auth)
      .send({ email: `nope.${suffix}@demo.shiftline.local`, roleId: role.id });
    expect(denied.status).toBe(403);
  });
});
