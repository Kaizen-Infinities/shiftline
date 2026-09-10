/**
 * Per-tenant API cap (P1-01): requests per 15 minutes across all of a tenant's
 * users, from the plan (or the subscription's override). In-memory sliding
 * windows are enough for one API process; a shared store arrives with
 * horizontal scaling. Platform admins and tenants without a cap are not counted.
 */
import type { Request, Response } from "express";

import { ApiError } from "../utils/ApiError";
import { entitlementService } from "../modules/entitlements/entitlement.service";

export const API_CAP_WINDOW_MS = 15 * 60 * 1000;

const windows = new Map<string, { count: number; resetAt: number }>();

const hit = (key: string, now = Date.now()) => {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + API_CAP_WINDOW_MS };
    windows.set(key, fresh);
    return fresh;
  }
  w.count++;
  return w;
};

/** Test hook: forget every window. */
export const resetApiCaps = () => windows.clear();

/**
 * Counts the request against the tenant's cap and throws 429 when it is exceeded.
 * Call after the tenant context is set. Sets RateLimit headers when a cap applies.
 */
export const enforceTenantApiCap = async (req: Request, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || !user.companyId || user.isSuperAdmin || user.userId.startsWith("admin_")) return;
  const e = await entitlementService.resolve(user.companyId);
  if (e.apiLimit === null) return;
  const w = hit(user.companyId);
  const remaining = Math.max(0, e.apiLimit - w.count);
  res.setHeader("RateLimit-Limit", String(e.apiLimit));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil((w.resetAt - Date.now()) / 1000)));
  if (w.count > e.apiLimit) {
    res.setHeader("Retry-After", String(Math.ceil((w.resetAt - Date.now()) / 1000)));
    throw new ApiError(
      429,
      `Your plan allows ${e.apiLimit} API requests per 15 minutes; the limit has been reached`,
      "API_LIMIT_REACHED"
    );
  }
};
