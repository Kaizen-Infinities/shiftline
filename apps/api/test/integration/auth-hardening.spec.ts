import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { demoCompany } from "../factories";
import { withoutTenant } from "../../src/lib/tenant-context";

const sendResendEmail = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../src/utils/resend", () => ({ sendResendEmail }));

const GENERIC = "If an account exists for this email, you will receive a reset link";

const adminHeader = async () => {
  const res = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: ADMIN.email, password: ADMIN.password });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
};

describe("platform admin X-Company-Id", () => {
  it("is refused on tenant routes and still honoured on platform routes", async () => {
    const admin = await adminHeader();
    const company = await demoCompany();
    const client = await api();

    const tenantRoute = await client
      .get("/api/companies")
      .set(admin)
      .set("X-Company-Id", company.id);
    expect(tenantRoute.status).toBe(403);
    expect(tenantRoute.body.message).toBe(
      "Platform admins act on a tenant only through impersonation"
    );

    const platformRoute = await client
      .get("/api/platform/tenants")
      .set(admin)
      .set("X-Company-Id", company.id);
    expect(platformRoute.status).toBe(200);
  });
});

describe("password reset request", () => {
  beforeEach(() => sendResendEmail.mockClear());

  it("answers identically, never returns a token, and emails real accounts only", async () => {
    const prisma = await getPrisma();
    const email = "demo.owner@test.shiftline.local";
    // demo.owner is shared with other specs on this worker: restore its email afterwards.
    const original = await withoutTenant(() =>
      prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" }, select: { email: true } })
    );
    await withoutTenant(() =>
      prisma.user.update({ where: { username: "demo.owner" }, data: { email } })
    );
    const client = await api();

    let real, ghost;
    try {
      real = await client.post("/api/auth/password-reset-request").send({ email });
      ghost = await client
        .post("/api/auth/password-reset-request")
        .send({ email: "nobody-here@test.shiftline.local" });
    } finally {
      await withoutTenant(() =>
        prisma.user.update({
          where: { username: "demo.owner" },
          data: { email: original.email },
        })
      );
    }

    for (const res of [real, ghost]) {
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(GENERIC);
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
      expect(res.body.data ?? null).toBeNull();
    }
    await vi.waitFor(() => expect(sendResendEmail).toHaveBeenCalledTimes(1));
    const sent = (sendResendEmail.mock.calls as unknown as [{ to: string; text: string }][])[0][0];
    expect(sent.to).toBe(email);
    expect(sent.text).toMatch(/\/reset\?token=[0-9a-f]{64}/);
  });
});

describe("account lockout (H44)", () => {
  it("locks after the threshold, refuses even the right password, and unlocks after the window", async () => {
    const prisma = await getPrisma();
    const username = "demo.owner";
    const reset = () =>
      withoutTenant(() =>
        prisma.user.update({
          where: { username },
          data: { status: "active", failedAttempts: 0, lockedUntil: null },
        })
      );
    await reset();
    const client = await api();
    try {
      for (let i = 0; i < 5; i++) {
        const bad = await client
          .post("/api/auth/login")
          .send({ email: username, password: "wrong-pass-1" });
        expect(bad.status).toBe(401);
      }
      const locked = await client
        .post("/api/auth/login")
        .send({ email: username, password: "Test@12345678" });
      expect(locked.status).toBe(423);
      expect(locked.body.code ?? locked.body.errorCode).toBe("ACCOUNT_LOCKED");

      await withoutTenant(() =>
        prisma.user.update({
          where: { username },
          data: { lockedUntil: new Date(Date.now() - 1000) },
        })
      );
      const ok = await client
        .post("/api/auth/login")
        .send({ email: username, password: "Test@12345678" });
      expect(ok.status).toBe(200);
    } finally {
      await reset();
    }
  });
});
