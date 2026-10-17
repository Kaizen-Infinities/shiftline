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
    await withoutTenant(() =>
      prisma.user.update({ where: { username: "demo.owner" }, data: { email } })
    );
    const client = await api();

    const real = await client.post("/api/auth/password-reset-request").send({ email });
    const ghost = await client
      .post("/api/auth/password-reset-request")
      .send({ email: "nobody-here@test.shiftline.local" });

    for (const res of [real, ghost]) {
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(GENERIC);
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
      expect(res.body.data ?? null).toBeNull();
    }
    await vi.waitFor(() => expect(sendResendEmail).toHaveBeenCalledTimes(1));
    const sent = sendResendEmail.mock.calls[0][0] as { to: string; text: string };
    expect(sent.to).toBe(email);
    expect(sent.text).toMatch(/\/reset\?token=[0-9a-f]{64}/);
  });
});
