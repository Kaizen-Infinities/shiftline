import { getTenant } from "./tenant-context";
import { getIO } from "../socket/socket";

/** Socket.io room for one tenant. Every authenticated socket joins its own. */
export const tenantRoom = (companyId: string) => `tenant:${companyId}`;

/** Room for platform admins (no tenant selected). */
export const PLATFORM_ROOM = "platform";

/**
 * Emits an event to every socket of the current tenant (or of `companyId`
 * when given, e.g. from a job that runs outside a request). Emits with no
 * tenant in scope are dropped rather than broadcast, so a bug can never leak
 * one tenant's data to another.
 */
export const emitToTenant = (event: string, payload?: unknown, companyId?: string): boolean => {
  const cid = companyId ?? getTenant()?.companyId ?? null;
  if (!cid) return false;
  getIO().to(tenantRoom(cid)).emit(event, payload);
  return true;
};

/** Emits to platform admins only (tenant health, job failures). */
export const emitToPlatform = (event: string, payload?: unknown): void => {
  getIO().to(PLATFORM_ROOM).emit(event, payload);
};

/** Room for one signed-in user across all their sockets (notifications). */
export const userRoom = (userId: string) => `user:${userId}`;

/** Emits to one user's sockets only (personal notices). */
export const emitToUser = (userId: string, event: string, payload?: unknown): void => {
  getIO().to(userRoom(userId)).emit(event, payload);
};
