import http from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { io as connect, Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getApp } from "../helpers/app";
import { demoCompany, demoOwner } from "../factories";

let server: http.Server;
let url: string;
let tenantA: string;
let tenantB: string;
let userB: string;
const clients: Socket[] = [];

const prismaOf = async () => (await import("../../src/config/prisma")).prisma;

interface SignInOptions {
  /** Whose session: the demo tenant's owner (default) or tenant B's user. */
  as?: "A" | "B";
  expiresIn?: string;
  deviceId?: string;
  extra?: Record<string, unknown>;
}

/** A signed-in user: a live session row plus an access token that names it. */
const signIn = async (opts: SignInOptions = {}) => {
  const prisma = await prismaOf();
  const { generateAccessToken } = await import("../../src/utils/generateAccessToken");
  const { withoutTenant } = await import("../../src/lib/tenant-context");
  const userId = opts.as === "B" ? userB : (await demoOwner()).userId;
  const companyId = opts.as === "B" ? tenantB : tenantA;
  const session = await withoutTenant(() =>
    prisma.userSession.create({
      data: {
        userId,
        sessionToken: randomUUID(),
        deviceId: opts.deviceId ?? null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
  );
  const token = generateAccessToken(
    {
      userId,
      email: "socket@test.shiftline.local",
      roleId: null,
      permissions: [],
      companyId,
      sessionId: session.id,
      ...opts.extra,
    },
    opts.expiresIn ? { expiresIn: opts.expiresIn } : {}
  );
  return { token, sessionId: session.id, userId };
};

const open = (auth: Record<string, unknown>) =>
  new Promise<Socket>((resolve, reject) => {
    const s = connect(url, { auth, transports: ["websocket"], reconnection: false });
    clients.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", (err) => reject(err));
  });

const received = (s: Socket, event: string, ms = 400) =>
  new Promise<unknown | undefined>((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    s.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });

const disconnected = (s: Socket, ms = 3000) =>
  new Promise<string | undefined>((resolve) => {
    if (s.disconnected) return resolve("already");
    const t = setTimeout(() => resolve(undefined), ms);
    s.once("disconnect", (reason) => {
      clearTimeout(t);
      resolve(reason);
    });
  });

describe("realtime rooms", () => {
  beforeAll(async () => {
    tenantA = (await demoCompany()).id;
    const prisma = await prismaOf();
    const { withoutTenant, runAsTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyCode: `RTB${randomUUID().slice(0, 5).toUpperCase()}`,
          companyName: "Realtime Other Co",
        },
      })
    );
    tenantB = other.id;
    userB = (
      await runAsTenant(other.id, () =>
        prisma.user.create({
          data: {
            companyId: other.id,
            username: `rt.${randomUUID().slice(0, 8)}`,
            email: `rt.${randomUUID().slice(0, 8)}@test.shiftline.local`,
            fullName: "Realtime Other User",
            passwordHash: "x",
          },
        })
      )
    ).userId;

    const { initSocket } = await import("../../src/socket/socket");
    server = http.createServer(await getApp());
    initSocket(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const c of clients) c.disconnect();
    const { closeSocket } = await import("../../src/socket/socket");
    await closeSocket();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("rejects a handshake without a valid token", async () => {
    await expect(open({})).rejects.toThrow(/Unauthorized/);
    await expect(open({ token: "not-a-jwt" })).rejects.toThrow(/Unauthorized/);
  });

  it("rejects a valid token whose session does not exist or was deactivated", async () => {
    const { generateAccessToken } = await import("../../src/utils/generateAccessToken");
    const ghost = generateAccessToken({
      userId: (await demoOwner()).userId,
      email: "socket@test.shiftline.local",
      roleId: null,
      permissions: [],
      companyId: tenantA,
      sessionId: randomUUID(),
    });
    await expect(open({ token: ghost })).rejects.toThrow(/Unauthorized/);

    const live = await signIn();
    const prisma = await prismaOf();
    const { withoutTenant } = await import("../../src/lib/tenant-context");
    await (await open({ token: live.token })).disconnect();
    await withoutTenant(() =>
      prisma.userSession.update({ where: { id: live.sessionId }, data: { isActive: false } })
    );
    await expect(open({ token: live.token })).rejects.toThrow(/Unauthorized/);
  });

  it("rejects an expired session row and a suspended company or user", async () => {
    const prisma = await prismaOf();
    const { withoutTenant } = await import("../../src/lib/tenant-context");

    const expired = await signIn();
    await withoutTenant(() =>
      prisma.userSession.update({
        where: { id: expired.sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
    );
    await expect(open({ token: expired.token })).rejects.toThrow(/Unauthorized/);

    const suspendedCompany = await signIn({ as: "B" });
    await withoutTenant(() =>
      prisma.company.update({ where: { id: tenantB }, data: { isActive: false } })
    );
    await expect(open({ token: suspendedCompany.token })).rejects.toThrow(/Unauthorized/);
    await withoutTenant(() =>
      prisma.company.update({ where: { id: tenantB }, data: { isActive: true } })
    );

    const inactiveUser = await signIn({ as: "B" });
    await withoutTenant(() =>
      prisma.user.update({ where: { userId: userB }, data: { status: "suspended" } })
    );
    await expect(open({ token: inactiveUser.token })).rejects.toThrow(/Unauthorized/);
    await withoutTenant(() =>
      prisma.user.update({ where: { userId: userB }, data: { status: "active" } })
    );
  });

  it("enforces device binding on the handshake", async () => {
    const bound = await signIn({ deviceId: "device-1" });
    await expect(open({ token: bound.token })).rejects.toThrow(/Unauthorized/);
    await expect(open({ token: bound.token, deviceId: "device-2" })).rejects.toThrow(
      /Unauthorized/
    );
    const ok = await open({ token: bound.token, deviceId: "device-1" });
    expect(ok.connected).toBe(true);
  });

  it("emitToTenant reaches only the tenant's sockets", async () => {
    const a1 = await open({ token: (await signIn()).token });
    const a2 = await open({ token: (await signIn()).token });
    const b = await open({ token: (await signIn({ as: "B" })).token });

    const { emitToTenant } = await import("../../src/lib/realtime");
    const { runAsTenant } = await import("../../src/lib/tenant-context");

    const waits = [received(a1, "test:ping"), received(a2, "test:ping"), received(b, "test:ping")];
    const sent = await runAsTenant(tenantA, async () => emitToTenant("test:ping", { id: 1 }));
    expect(sent).toBe(true);
    const [gotA1, gotA2, gotB] = await Promise.all(waits);
    expect(gotA1).toEqual({ id: 1 });
    expect(gotA2).toEqual({ id: 1 });
    expect(gotB).toBeUndefined();
  });

  it("an emitted payload carries only identifiers, never the record (F04)", async () => {
    const a = await open({ token: (await signIn()).token });
    const { emitToTenant } = await import("../../src/lib/realtime");

    const wait = received(a, "employee:updated");
    emitToTenant(
      "employee:updated",
      {
        id: 42,
        employeeCode: "E-001",
        fullName: "Asha Rao",
        panNumber: "ABCDE1234F",
        salary: "123456.00",
        departmentId: 7,
        nested: { passwordHash: "x" },
        items: [{ debitLedgerId: 5, creditLedgerId: 6, amount: "999.00" }],
      },
      tenantA
    );
    const got = (await wait) as Record<string, unknown>;
    expect(got).toEqual({ id: 42, departmentId: 7, ledgerIds: [5, 6] });
    expect(JSON.stringify(got)).not.toMatch(/Asha|ABCDE|123456|passwordHash|999/);
  });

  it("an explicit companyId targets that tenant from outside a request", async () => {
    const a = await open({ token: (await signIn()).token });
    const b = await open({ token: (await signIn({ as: "B" })).token });
    const { emitToTenant } = await import("../../src/lib/realtime");

    const waits = [received(a, "test:job"), received(b, "test:job")];
    expect(emitToTenant("test:job", { id: "done" }, tenantB)).toBe(true);
    const [gotA, gotB] = await Promise.all(waits);
    expect(gotA).toBeUndefined();
    expect(gotB).toEqual({ id: "done" });
  });

  it("an emit with no tenant in scope is dropped, never broadcast", async () => {
    const a = await open({ token: (await signIn()).token });
    const b = await open({ token: (await signIn({ as: "B" })).token });
    const { emitToTenant } = await import("../../src/lib/realtime");

    const waits = [received(a, "test:orphan"), received(b, "test:orphan")];
    expect(emitToTenant("test:orphan", { id: 1 })).toBe(false);
    const got = await Promise.all(waits);
    expect(got).toEqual([undefined, undefined]);
  });

  it("only a platform admin may pick a tenant room in the handshake", async () => {
    const { emitToTenant } = await import("../../src/lib/realtime");
    const prisma = await prismaOf();
    const { withoutTenant } = await import("../../src/lib/tenant-context");
    const { generateAccessToken } = await import("../../src/utils/generateAccessToken");

    // A tenant user asking for another tenant's room stays in its own.
    const impostor = await open({
      token: (await signIn()).token,
      companyId: tenantB,
    });
    const w1 = received(impostor, "test:admin");
    emitToTenant("test:admin", { id: "B" }, tenantB);
    expect(await w1).toBeUndefined();

    // An admin token (no companyId) with a requested tenant joins that room.
    const admin = await withoutTenant(() =>
      prisma.admin.create({
        data: {
          fullName: "Socket Admin",
          username: `sa.${randomUUID().slice(0, 8)}`,
          passwordHash: "x",
        },
      })
    );
    const adminUserId = `admin_${admin.id}`;
    const session = await withoutTenant(() =>
      prisma.userSession.create({
        data: {
          adminId: admin.id,
          sessionToken: randomUUID(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
    );
    const adminToken = generateAccessToken({
      userId: adminUserId,
      email: "admin@test.shiftline.local",
      roleId: null,
      permissions: [],
      isSuperAdmin: true,
      companyId: null,
      sessionId: session.id,
    });
    const adminSocket = await open({ token: adminToken, companyId: tenantB });
    const w2 = received(adminSocket, "test:admin");
    emitToTenant("test:admin", { id: "B" }, tenantB);
    expect(await w2).toEqual({ id: "B" });

    // A suspended admin is refused like any other account.
    await withoutTenant(() =>
      prisma.admin.update({ where: { id: admin.id }, data: { status: "suspended" } })
    );
    await expect(open({ token: adminToken, companyId: tenantB })).rejects.toThrow(/Unauthorized/);
  });

  it("disconnectSession drops only the sockets of that session", async () => {
    const one = await signIn();
    const two = await signIn();
    const s1a = await open({ token: one.token });
    const s1b = await open({ token: one.token });
    const s2 = await open({ token: two.token });
    const { disconnectSession } = await import("../../src/lib/realtime");

    const gone = [disconnected(s1a), disconnected(s1b)];
    disconnectSession(one.sessionId);
    expect(await Promise.all(gone)).toEqual(["io server disconnect", "io server disconnect"]);
    expect(s2.connected).toBe(true);
  });

  it("disconnectUser drops every socket of the user and spares other tenants", async () => {
    const a = await signIn();
    const b = await signIn({ as: "B" });
    const sa = await open({ token: a.token });
    const sb = await open({ token: b.token });
    const { disconnectUser } = await import("../../src/lib/realtime");

    const gone = disconnected(sa);
    disconnectUser(a.userId);
    expect(await gone).toBe("io server disconnect");
    expect(sb.connected).toBe(true);
  });

  it("a password change drops the other sessions' sockets and keeps the current one", async () => {
    const current = await signIn();
    const other = await signIn();
    const sCurrent = await open({ token: current.token });
    const sOther = await open({ token: other.token });
    const { authRepository } = await import("../../src/modules/auth/auth.repository");
    const { withoutTenant } = await import("../../src/lib/tenant-context");

    const gone = disconnected(sOther);
    const revoked = await withoutTenant(() =>
      authRepository.logoutOtherUserSessions(current.userId, current.sessionId)
    );
    expect(revoked).toBeGreaterThanOrEqual(1);
    expect(await gone).toBe("io server disconnect");
    expect(sCurrent.connected).toBe(true);
  });

  it("logout of one session and logout-all drop the matching sockets", async () => {
    const a = await signIn();
    const b = await signIn();
    const sa = await open({ token: a.token });
    const sb = await open({ token: b.token });
    const { authRepository } = await import("../../src/modules/auth/auth.repository");
    const { withoutTenant } = await import("../../src/lib/tenant-context");

    const goneA = disconnected(sa);
    await withoutTenant(() => authRepository.logoutSession(a.sessionId));
    expect(await goneA).toBe("io server disconnect");
    expect(sb.connected).toBe(true);

    const goneB = disconnected(sb);
    await withoutTenant(() => authRepository.logoutAllUserSessions(b.userId));
    expect(await goneB).toBe("io server disconnect");
  });

  it("drops the socket when its token expires", async () => {
    const short = await signIn({ expiresIn: "2s" });
    const s = await open({ token: short.token });
    expect(s.connected).toBe(true);
    expect(await disconnected(s, 5000)).toBe("io server disconnect");
    // The expired token cannot reconnect.
    await expect(open({ token: short.token })).rejects.toThrow(/Unauthorized/);
  });
});
