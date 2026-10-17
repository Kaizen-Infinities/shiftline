import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import { ADMIN, api, SEED_PASSWORD } from "../helpers/app";
import { getPrisma } from "../helpers/db";

const OWNER = { email: "owner@demo.shiftline.local", password: SEED_PASSWORD };
const COOKIE = "shiftline_rt";

const cookieOf = (res: { headers: Record<string, string | string[]> }) => {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith(`${COOKIE}=`));
};
const cookieValue = (c: string) => c.split(";")[0].split("=")[1];

describe("access tokens and refresh sessions", () => {
  it("login issues a 15-minute access token and an httpOnly refresh cookie", async () => {
    const res = await (await api()).post("/api/auth/login").send(OWNER);
    expect(res.status).toBe(200);
    const token = res.body.data.accessToken as string;
    const decoded = jwt.decode(token) as { exp: number; iat: number };
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
    expect(res.body.data.refreshToken).toBeUndefined(); // browsers never see it
    const cookie = cookieOf(res);
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookieValue(cookie!)).toHaveLength(64);
  });

  it("refresh rotates the cookie, returns a new access token and keeps the session", async () => {
    const login = await (await api()).post("/api/auth/login").send(OWNER);
    const first = cookieOf(login)!;
    const sessionId = (jwt.decode(login.body.data.accessToken) as { sessionId: string }).sessionId;

    const refreshed = await (
      await api()
    )
      .post("/api/auth/refresh")
      .set("Cookie", first.split(";")[0]);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    expect(refreshed.body.data.accessToken).not.toBe(login.body.data.accessToken);
    expect(refreshed.body.data.user.email).toBe(OWNER.email);
    const second = cookieOf(refreshed)!;
    expect(cookieValue(second)).not.toBe(cookieValue(first));
    expect((jwt.decode(refreshed.body.data.accessToken) as { sessionId: string }).sessionId).toBe(
      sessionId
    );

    // The new access token works; the session row rotated.
    const me = await (
      await api()
    )
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.status).toBe(200);
    const prisma = await getPrisma();
    const session = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.rotatedAt).toBeTruthy();
    expect(session.prevTokenHash).toHaveLength(64);
    expect(session.isActive).toBe(true);
  });

  it("replaying a rotated-away refresh token revokes the whole session", async () => {
    const login = await (await api()).post("/api/auth/login").send(OWNER);
    const first = cookieOf(login)!.split(";")[0];
    const sessionId = (jwt.decode(login.body.data.accessToken) as { sessionId: string }).sessionId;
    const rotated = await (await api()).post("/api/auth/refresh").set("Cookie", first);
    expect(rotated.status).toBe(200);
    const second = cookieOf(rotated)!.split(";")[0];

    // Push the rotation outside the grace window, then replay the old token.
    const prisma = await getPrisma();
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });
    const replay = await (await api()).post("/api/auth/refresh").set("Cookie", first);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/reuse/i);
    expect(cookieOf(replay)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);

    // The legitimate holder is locked out too: the session is gone.
    const afterReplay = await (await api()).post("/api/auth/refresh").set("Cookie", second);
    expect(afterReplay.status).toBe(401);
    const session = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.isActive).toBe(false);
    const me = await (
      await api()
    )
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${rotated.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });

  it("a replay inside the grace window is treated as a concurrent tab", async () => {
    const login = await (await api()).post("/api/auth/login").send(OWNER);
    const first = cookieOf(login)!.split(";")[0];
    const rotated = await (await api()).post("/api/auth/refresh").set("Cookie", first);
    expect(rotated.status).toBe(200);
    const again = await (await api()).post("/api/auth/refresh").set("Cookie", first);
    expect(again.status).toBe(200);
    expect(again.body.data.accessToken).toBeTruthy();
  });

  it("two concurrent refreshes with the same token both succeed and the session survives", async () => {
    const login = await (await api()).post("/api/auth/login").send(OWNER);
    const first = cookieOf(login)!.split(";")[0];
    const sessionId = (jwt.decode(login.body.data.accessToken) as { sessionId: string }).sessionId;
    const client = await api();
    const [a, b] = await Promise.all([
      client.post("/api/auth/refresh").set("Cookie", first),
      client.post("/api/auth/refresh").set("Cookie", first),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const prisma = await getPrisma();
    const session = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.isActive).toBe(true);
  });

  it("the previous token is good for one grace use only; a second replay revokes the session", async () => {
    const login = await (await api()).post("/api/auth/login").send(OWNER);
    const first = cookieOf(login)!.split(";")[0];
    const sessionId = (jwt.decode(login.body.data.accessToken) as { sessionId: string }).sessionId;
    const client = await api();
    expect((await client.post("/api/auth/refresh").set("Cookie", first)).status).toBe(200);
    expect((await client.post("/api/auth/refresh").set("Cookie", first)).status).toBe(200); // grace use
    const replay = await client.post("/api/auth/refresh").set("Cookie", first);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/reuse/i);
    const prisma = await getPrisma();
    const session = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.isActive).toBe(false);
  });

  it("an admin token on a tenant route is refused with 403, not a 500", async () => {
    const res = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: ADMIN.password });
    const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
    for (const path of ["/api/customers", "/api/roles"]) {
      const r = await (await api()).get(path).set(auth);
      expect(r.status).toBe(403);
      expect(r.body.message).toMatch(/impersonation/i);
    }
  });

  it("logout clears the cookie and ends the session", async () => {
    const login = await (await api()).post("/api/auth/login").send(OWNER);
    const cookie = cookieOf(login)!.split(";")[0];
    const out = await (
      await api()
    )
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(out.status).toBe(200);
    expect(cookieOf(out)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
    const refreshed = await (await api()).post("/api/auth/refresh").set("Cookie", cookie);
    expect(refreshed.status).toBe(401);
  });

  it("refuses a refresh without a token", async () => {
    const res = await (await api()).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("devices receive the refresh token in the body and may refresh with it", async () => {
    const login = await (
      await api()
    )
      .post("/api/auth/login")
      .set("x-device-id", "test-device-refresh-0001")
      .send(OWNER);
    expect(login.status).toBe(200);
    const refreshToken = login.body.data.refreshToken as string;
    expect(refreshToken).toHaveLength(64);
    const refreshed = await (
      await api()
    )
      .post("/api/auth/refresh")
      .set("x-device-id", "test-device-refresh-0001")
      .send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).toHaveLength(64);
    expect(refreshed.body.data.refreshToken).not.toBe(refreshToken);
  });
});
