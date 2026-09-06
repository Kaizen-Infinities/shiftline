import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { AccessTokenPayload } from "../types/auth.types";

let io: Server | undefined;

const allowedOrigins = [
  env.FRONTEND_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Socket.io server. Connections must present a valid access token in the
 * handshake (`auth.token`) and come from an allowed origin (SEC-05). Each
 * socket joins exactly one room: its tenant's (`tenant:<companyId>`), or the
 * platform room for admins without a tenant. Admin tokens may select a tenant
 * with `auth.companyId`. Emits go through lib/realtime.ts, never `io.emit`.
 */
export const initSocket = (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (typeof socket.handshake.headers.authorization === "string" &&
      socket.handshake.headers.authorization.startsWith("Bearer ")
        ? socket.handshake.headers.authorization.slice(7)
        : undefined);
    if (!token) return next(new Error("Unauthorized"));
    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
      let companyId = decoded.companyId ?? null;
      if (!companyId && decoded.isSuperAdmin) {
        const requested = socket.handshake.auth?.companyId as string | undefined;
        if (requested && UUID_RE.test(requested)) companyId = requested;
      }
      socket.data.user = decoded;
      socket.data.companyId = companyId;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const companyId = socket.data.companyId as string | null;
    void socket.join(companyId ? `tenant:${companyId}` : "platform");
  });

  return io;
};

/** Emits are dropped until initSocket runs (tests, one-off scripts, the worker). */
const noopIO = {
  emit: () => false,
  to: () => noopIO,
  in: () => noopIO,
  except: () => noopIO,
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
