import { describe, expect, it } from "vitest";
import { api, authed } from "../helpers/app";

describe("security posture", () => {
  const guardedGets = [
    "/api/companies",
    "/api/accounts/ledgers",
    "/api/accounts/trial-balance",
    "/api/vouchers",
    "/api/returns/sales",
    "/api/petty-cash",
    "/api/whatsapp/config",
    "/api/customer-types",
    "/api/customer-grades",
    "/api/products",
  ];

  it.each(guardedGets)("%s requires authentication", async (path) => {
    const res = await (await api()).get(path);
    expect(res.status).toBe(401);
  });

  it("SEC-04: public branding exposes name and logo only", async () => {
    const res = await (await api()).get("/api/companies/public");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual([
      "companyName",
      "faviconUrl",
      "isOnboarded",
      "logoUrl",
      "shortName",
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/gstin|mobile|addressLine1/);
  });

  it("SEC-06: helmet headers present, X-Powered-By absent", async () => {
    const res = await (await api()).get("/api/companies/public");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("F16: X-Frame-Options and CSP frame-ancestors both forbid framing", async () => {
    const res = await (await api()).get("/api/companies/public");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("permission denied returns 403 for a role without the key", async () => {
    const { auth } = await authed("demo.sales");
    const res = await (await api()).get("/api/accounts/trial-balance").set(auth);
    expect(res.status).toBe(403);
  });

  it("unknown routes return 404 JSON", async () => {
    const res = await (await api()).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("input pipeline (REL-01 / F6)", () => {
  it("clamps pagination with a 400", async () => {
    const { auth } = await authed();
    const res = await (await api()).get("/api/customers?page=-5&limit=99999").set(auth);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
  });

  it("rejects malformed JSON with 400", async () => {
    const { auth } = await authed();
    const res = await (
      await api()
    )
      .post("/api/customer-types")
      .set(auth)
      .set("content-type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Request body is not valid JSON.");
  });

  it("rejects oversize bodies with 413", async () => {
    const { auth } = await authed();
    const res = await (
      await api()
    )
      .post("/api/customer-types")
      .set(auth)
      .set("content-type", "application/json")
      .send(`{"name":"${"a".repeat(11 * 1024 * 1024)}"}`);
    expect(res.status).toBe(413);
  });

  it("returns 400, not 500, for out-of-range and non-numeric ids", async () => {
    const { auth } = await authed();
    const r1 = await (await api()).get("/api/products/999999999999999999999").set(auth);
    expect(r1.status).toBe(400);
    expect(r1.body.message).not.toMatch(/prisma|invocation|\.ts:/i);
    const r2 = await (await api()).get("/api/products/abc").set(auth);
    expect(r2.status).toBe(400);
  });

  it("strips a client-supplied companyId on validated routes", async () => {
    const { auth } = await authed();
    const res = await (
      await api()
    )
      .post("/api/customer-types")
      .set(auth)
      .send({ name: `Type ${Date.now()}`, companyId: "00000000-0000-0000-0000-000000000000" });
    expect([200, 201]).toContain(res.status);
  });
});
