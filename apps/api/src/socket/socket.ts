import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { AccessTokenPayload } from "../types/auth.types";

let io: Server;

const allowedOrigins = [
  env.FRONTEND_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

/**
 * Socket.io server. Connections must present a valid access token in the
 * handshake (`auth.token`) and come from an allowed origin (SEC-05). Per-tenant
 * rooms arrive in P0-10.
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
      socket.data.user = decoded;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("disconnect", () => {
      /* per-tenant presence tracking arrives with rooms in P0-10 */
    });
  });

  return io;
};

/** Emits are dropped until initSocket runs (tests, one-off scripts). */
const noopIO = {
  emit: () => false,
  to: () => noopIO,
  in: () => noopIO,
  except: () => noopIO,
} as unknown as Server;

export const getIO = (): Server => io ?? noopIO;
