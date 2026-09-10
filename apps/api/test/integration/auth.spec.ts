import { describe, expect, it, beforeAll } from "vitest";
import jwt from "jsonwebtoken";
import { api, ADMIN, SEED_PASSWORD } from "../helpers/app";
import { getPrisma } from "../helpers/db";

describe("authentication", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    await prisma.loginAttempt.deleteMany();
  });

  it("logs in a seeded user and returns a bearer token", async () => {
    const res = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: "demo.owner", password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe("string");
  });

  it("rejects a wrong password without leaking which part was wrong", async () => {
    const res = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: "demo.owner", password: "nope-nope-nope" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("rejects an unknown user with the same message", async () => {
    const res = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: "ghost", password: "nope-nope-nope" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("rejects tampered and alg=none tokens", async () => {
    const forged = jwt.sign(
      { userId: "admin_1", isSuperAdmin: true, permissions: [], sessionId: "x" },
      "wrong-secret"
    );
    const r1 = await (await api()).get("/api/companies").set("Authorization", `Bearer ${forged}`);
    expect(r1.status).toBe(401);
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ userId: "admin_1", isSuperAdmin: true, permissions: [], sessionId: "x" })
    ).toString("base64url");
    const r2 = await (
      await api()
    )
      .get("/api/companies")
      .set("Authorization", `Bearer ${header}.${payload}.`);
    expect(r2.status).toBe(401);
  });

  it("SEC-01: records admin failures and rate-limits after 10 within the window", async () => {
    const prisma = await getPrisma();
    await prisma.loginAttempt.deleteMany();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await (
        await api()
      )
        .post("/api/auth/login")
        .send({ email: ADMIN.email, password: "wrong-password-!!" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const recorded = await prisma.loginAttempt.count({
      where: { success: false, adminId: { not: null } },
    });
    expect(recorded).toBeGreaterThanOrEqual(10);
    await prisma.loginAttempt.deleteMany();
  });
});
