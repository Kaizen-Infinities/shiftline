import http from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { io as connect, Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getApp } from "../helpers/app";
import { demoCompany } from "../factories";

let server: http.Server;
let url: string;
let tenantA: string;
const tenantB = randomUUID();
const clients: Socket[] = [];

const token = async (companyId: string | null, extra: Record<string, unknown> = {}) => {
  const { generateAccessToken } = await import("../../src/utils/generateAccessToken");
  return generateAccessToken({
    userId: randomUUID(),
    email: "socket@test.shiftline.local",
    roleId: null,
    permissions: [],
    companyId,
    sessionId: randomUUID(),
    ...extra,
  });
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

describe("realtime rooms", () => {
  beforeAll(async () => {
    tenantA = (await demoCompany()).id;
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

  it("emitToTenant reaches only the tenant's sockets", async () => {
    const a1 = await open({ token: await token(tenantA) });
    const a2 = await open({ token: await token(tenantA) });
    const b = await open({ token: await token(tenantB) });

    const { emitToTenant } = await import("../../src/lib/realtime");
    const { runAsTenant } = await import("../../src/lib/tenant-context");

    const waits = [received(a1, "test:ping"), received(a2, "test:ping"), received(b, "test:ping")];
    const sent = await runAsTenant(tenantA, async () => emitToTenant("test:ping", { n: 1 }));
    expect(sent).toBe(true);
    const [gotA1, gotA2, gotB] = await Promise.all(waits);
    expect(gotA1).toEqual({ n: 1 });
    expect(gotA2).toEqual({ n: 1 });
    expect(gotB).toBeUndefined();
  });

  it("an explicit companyId targets that tenant from outside a request", async () => {
    const a = await open({ token: await token(tenantA) });
    const b = await open({ token: await token(tenantB) });
    const { emitToTenant } = await import("../../src/lib/realtime");

    const waits = [received(a, "test:job"), received(b, "test:job")];
    expect(emitToTenant("test:job", { done: true }, tenantB)).toBe(true);
    const [gotA, gotB] = await Promise.all(waits);
    expect(gotA).toBeUndefined();
    expect(gotB).toEqual({ done: true });
  });

  it("an emit with no tenant in scope is dropped, never broadcast", async () => {
    const a = await open({ token: await token(tenantA) });
    const b = await open({ token: await token(tenantB) });
    const { emitToTenant } = await import("../../src/lib/realtime");

    const waits = [received(a, "test:orphan"), received(b, "test:orphan")];
    expect(emitToTenant("test:orphan", { leak: true })).toBe(false);
    const got = await Promise.all(waits);
    expect(got).toEqual([undefined, undefined]);
  });

  it("only a platform admin may pick a tenant room in the handshake", async () => {
    const { emitToTenant } = await import("../../src/lib/realtime");

    // A tenant user asking for another tenant's room stays in its own.
    const impostor = await open({ token: await token(tenantA), companyId: tenantB });
    const w1 = received(impostor, "test:admin");
    emitToTenant("test:admin", { secret: "B" }, tenantB);
    expect(await w1).toBeUndefined();

    // An admin token (no companyId) with a requested tenant joins that room.
    const admin = await open({
      token: await token(null, { isSuperAdmin: true }),
      companyId: tenantB,
    });
    const w2 = received(admin, "test:admin");
    emitToTenant("test:admin", { secret: "B" }, tenantB);
    expect(await w2).toEqual({ secret: "B" });
  });
});
