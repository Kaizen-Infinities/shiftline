import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";

import { env } from "../config/env";
import { logger } from "../lib/logger";
import { authenticateSocket, SocketAuthError } from "./socket-auth";
import {
  tenantRoom,
  PLATFORM_ROOM,
  userRoom,
  sessionRoom,
  deviceRoom,
  impersonationRoom,
} from "./rooms";

let io: Server | undefined;

const allowedOrigins = [
  env.FRONTEND_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

/** setTimeout cannot take more than 2^31-1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Socket.io server. A handshake must present a valid access token (`auth.token`) from an
 * allowed origin (SEC-05) and pass the same live checks as the HTTP middleware (F05): active
 * session, device binding, active account, company not suspended, impersonation still live.
 * Each socket joins its tenant's room (`tenant:<companyId>`), or the platform room for admins
 * without a tenant, plus rooms for its user, session, device and impersonation so that
 * `disconnectSession` and friends in lib/realtime.ts can revoke it. A socket is dropped when
 * its token expires; the client reconnects with the refreshed token. Admin tokens may select
 * a tenant with `auth.companyId`. Emits go through lib/realtime.ts, never `io.emit`.
 */
export const initSocket = (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    const bearer =
      typeof socket.handshake.headers.authorization === "string" &&
      socket.handshake.headers.authorization.startsWith("Bearer ")
        ? socket.handshake.headers.authorization.slice(7)
        : undefined;
    const header = socket.handshake.headers["x-device-id"];
    const deviceId =
      (socket.handshake.auth?.deviceId as string | undefined) ??
      (typeof header === "string" ? header : undefined);
    try {
      const identity = await authenticateSocket({
        token: (socket.handshake.auth?.token as string | undefined) ?? bearer,
        deviceId,
        requestedCompanyId: socket.handshake.auth?.companyId as string | undefined,
      });
      socket.data.user = identity.user;
      socket.data.companyId = identity.companyId;
      socket.data.sessionId = identity.sessionId;
      socket.data.deviceId = identity.deviceId;
      socket.data.impersonationId = identity.impersonationId;
      socket.data.expiresAtMs = identity.expiresAtMs;
      return next();
    } catch (err) {
      if (!(err instanceof SocketAuthError)) logger.warn({ err }, "socket handshake failed");
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const companyId = socket.data.companyId as string | null;
    void socket.join(companyId ? tenantRoom(companyId) : PLATFORM_ROOM);
    // Personal room for notifications; the user id is the verified token's.
    const userId = (socket.data.user as { userId?: string } | undefined)?.userId;
    if (userId) void socket.join(userRoom(userId));
    void socket.join(sessionRoom(socket.data.sessionId as string));
    if (socket.data.deviceId) void socket.join(deviceRoom(socket.data.deviceId as string));
    if (socket.data.impersonationId) {
      void socket.join(impersonationRoom(socket.data.impersonationId as string));
    }

    // Access tokens are short-lived; a socket must not outlive its token.
    const remaining = (socket.data.expiresAtMs as number) - Date.now();
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.min(Math.max(remaining, 0), MAX_TIMER_MS)
    );
    socket.on("disconnect", () => clearTimeout(timer));
  });

  return io;
};

/** Emits are dropped until initSocket runs (tests, one-off scripts, the worker). */
const noopIO = {
  emit: () => false,
  to: () => noopIO,
  in: () => noopIO,
  except: () => noopIO,
  disconnectSockets: () => undefined,
} as unknown as Server;

/** Internal: only lib/realtime.ts may call this (lint rule). */
export const getIO = (): Server => io ?? noopIO;

/** Closes the server (tests). */
export const closeSocket = async (): Promise<void> => {
  if (!io) return;
  const s = io;
  io = undefined;
  await s.close();
};
