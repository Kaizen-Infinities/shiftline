/**
 * Entitlements (P1-01): what a tenant may use right now. Plan features plus
 * per-tenant overrides, seats and the API cap, resolved once per request and
 * cached for a minute per tenant. Platform changes call `invalidate()`.
 */
import { FEATURE_KEYS } from "@shiftline/shared";
import type { SubscriptionStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { emitToTenant } from "../../lib/realtime";
import { getTenant, runAsTenant } from "../../lib/tenant-context";

export interface Entitlements {
  plan: { code: string; name: string } | null;
  status: SubscriptionStatus | "NONE";
  /** Effective feature keys; `core` is always present. */
  features: string[];
  seatLimit: number | null;
  seatsUsed: number;
  apiLimit: number | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Suspended or cancelled: reads work, writes are refused so the tenant can still export. */
  readOnly: boolean;
  /** Past due inside the grace window: full access, the web shows a banner. */
  pastDue: boolean;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Entitlements }>();

const CORE_ONLY: Omit<Entitlements, "seatsUsed"> = {
  plan: null,
  status: "NONE",
  features: ["core"],
  seatLimit: null,
  apiLimit: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  readOnly: false,
  pastDue: false,
};

class EntitlementService {
  /** Entitlements of the current tenant (or of `companyId` from platform code and jobs). */
  async resolve(companyId?: string): Promise<Entitlements> {
    const cid = companyId ?? getTenant()?.companyId ?? null;
    if (!cid) return { ...CORE_ONLY, seatsUsed: 0 };
    const hit = cache.get(cid);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await runAsTenant(cid, () => this.compute(cid));
    cache.set(cid, { at: Date.now(), value });
    return value;
  }

  invalidate(companyId?: string) {
    if (companyId) cache.delete(companyId);
    else cache.clear();
  }

  /** Invalidate and tell the tenant's open sessions to refresh their profile. */
  changed(companyId: string) {
    this.invalidate(companyId);
    emitToTenant("entitlements:updated", { companyId }, companyId);
  }

  private async compute(companyId: string): Promise<Entitlements> {
    const [subscription, overrides, users, invitations] = await Promise.all([
      prisma.subscription.findUnique({ where: { companyId }, include: { plan: true } }),
      prisma.featureFlagOverride.findMany({
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      }),
      prisma.user.count({ where: { status: "active" } }),
      prisma.invitation.count({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    const seatsUsed = users + invitations;
    if (!subscription) return { ...CORE_ONLY, seatsUsed };

    const features = new Set<string>(["core", ...subscription.plan.features]);
    for (const o of overrides) {
      if (!FEATURE_KEYS.includes(o.feature)) continue;
      if (o.enabled) features.add(o.feature);
      else if (o.feature !== "core") features.delete(o.feature);
    }
    const status = subscription.status;
    return {
      plan: { code: subscription.plan.code, name: subscription.plan.name },
      status,
      features: FEATURE_KEYS.filter((k) => features.has(k)),
      seatLimit: subscription.seats ?? subscription.plan.seatLimit,
      seatsUsed,
      apiLimit: subscription.apiLimit ?? subscription.plan.apiLimit,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
      readOnly: status === "SUSPENDED" || status === "CANCELLED",
      pastDue: status === "PAST_DUE",
    };
  }

  /** Active users plus live invitations, counted now (the cached figure may be a minute old). */
  async seatsUsed(): Promise<number> {
    const [users, invitations] = await Promise.all([
      prisma.user.count({ where: { status: "active" } }),
      prisma.invitation.count({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    return users + invitations;
  }

  /** Throws when adding one more seat would exceed the plan. Call inside the tenant context. */
  async assertSeatAvailable(companyId?: string) {
    const e = await this.resolve(companyId);
    if (e.seatLimit === null) return;
    const used = await this.seatsUsed();
    if (used >= e.seatLimit) {
      throw new ApiError(
        403,
        `Your ${e.plan?.name ?? "current"} plan includes ${e.seatLimit} seat(s) and all are in use. Remove a user or upgrade the plan.`,
        "SEAT_LIMIT_REACHED",
        { seatLimit: e.seatLimit, seatsUsed: used }
      );
    }
  }
}

export const entitlementService = new EntitlementService();
