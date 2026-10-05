import { getTenant } from "./tenant-context";
import { getIO } from "../socket/socket";

import {
  tenantRoom,
  PLATFORM_ROOM,
  userRoom,
  sessionRoom,
  deviceRoom,
  impersonationRoom,
} from "../socket/rooms";

export { tenantRoom, PLATFORM_ROOM, userRoom, sessionRoom, deviceRoom, impersonationRoom };

/**
 * Realtime events are invalidation-only (F04). Every socket of a tenant joins the same room
 * whatever its permissions, so a payload must never carry business data. The client reacts to
 * an event by refetching through the authorised REST API. Only opaque identifiers and a few
 * non-sensitive discriminators survive: `id`, any `<name>Id` key, `source`, `type` and
 * `runCode`, and only when the value is a string, number or bigint. A payload with journal
 * `items` also yields `ledgerIds` (the ledgers touched, no amounts) so that the accounts
 * screens can refresh only what changed.
 */
const MAX_LEDGER_IDS = 50;

const KEPT_KEYS = /^(id|[a-z][A-Za-z0-9]*Id|source|type|runCode)$/;

type Invalidation = Record<string, string | number | number[]>;

const ledgerIdsOf = (items: unknown): number[] => {
  const ids = new Set<number>();
  if (!Array.isArray(items)) return [];
  for (const item of items) {
    for (const key of ["debitLedgerId", "creditLedgerId"]) {
      const n = Number((item as Record<string, unknown> | null)?.[key]);
      if (Number.isInteger(n)) ids.add(n);
    }
    if (ids.size >= MAX_LEDGER_IDS) break;
  }
  return [...ids].slice(0, MAX_LEDGER_IDS);
};

export const toInvalidation = (payload: unknown): Invalidation | undefined => {
  if (payload === null || payload === undefined) return undefined;
  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "bigint") {
    return { id: typeof payload === "bigint" ? payload.toString() : payload };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) return {};
  const out: Invalidation = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!KEPT_KEYS.test(key)) continue;
    if (typeof value === "string" || typeof value === "number") out[key] = value;
    else if (typeof value === "bigint") out[key] = value.toString();
  }
  const ledgerIds = ledgerIdsOf((payload as { items?: unknown }).items);
  if (ledgerIds.length) out.ledgerIds = ledgerIds;
  return out;
};

/**
 * Emits an invalidation event to every socket of the current tenant (or of `companyId`
 * when given, e.g. from a job that runs outside a request). The payload is reduced to
 * identifiers by `toInvalidation`. Emits with no tenant in scope are dropped rather than
 * broadcast, so a bug can never leak one tenant's data to another.
 */
export const emitToTenant = (event: string, payload?: unknown, companyId?: string): boolean => {
  const cid = companyId ?? getTenant()?.companyId ?? null;
  if (!cid) return false;
  getIO().to(tenantRoom(cid)).emit(event, toInvalidation(payload));
  return true;
};

/** Emits to platform admins only (tenant health, job failures). Invalidation-only as well. */
export const emitToPlatform = (event: string, payload?: unknown): void => {
  getIO().to(PLATFORM_ROOM).emit(event, toInvalidation(payload));
};

/**
 * Emits to one user's sockets only (personal notices). The room is private to that user, so
 * the payload is delivered as given.
 */
export const emitToUser = (userId: string, event: string, payload?: unknown): void => {
  getIO().to(userRoom(userId)).emit(event, payload);
};

/** Drops every socket opened with this login session (logout, session revoked). */
export const disconnectSession = (sessionId: string): void => {
  getIO().in(sessionRoom(sessionId)).disconnectSockets(true);
};

/** Drops every socket of this user (deactivation, password change or reset, logout-all). */
export const disconnectUser = (userId: string): void => {
  getIO().in(userRoom(userId)).disconnectSockets(true);
};

/** Drops every socket of a tenant (suspension). */
export const disconnectCompany = (companyId: string): void => {
  getIO().in(tenantRoom(companyId)).disconnectSockets(true);
};

/** Drops the sockets bound to one native device (revoke and wipe). */
export const disconnectDevice = (deviceId: string): void => {
  getIO().in(deviceRoom(deviceId)).disconnectSockets(true);
};

/** Drops the sockets of an impersonation session (it ended or expired). */
export const disconnectImpersonation = (impersonationId: string): void => {
  getIO().in(impersonationRoom(impersonationId)).disconnectSockets(true);
};
