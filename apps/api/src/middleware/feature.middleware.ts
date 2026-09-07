import { NextFunction, Request, Response } from "express";
import { featureForPermission } from "@shiftline/shared";

import { entitlementService, type Entitlements } from "../modules/entitlements/entitlement.service";
import { ApiError } from "../utils/ApiError";

const isSuperAdmin = (req: Request) =>
  !!req.user && (req.user.isSuperAdmin || req.user.userId?.startsWith("admin_"));

/** Entitlements for the request's tenant, resolved once per request. */
export const entitlementsFor = async (req: Request): Promise<Entitlements> => {
  const r = req as Request & { entitlements?: Entitlements };
  if (!r.entitlements) r.entitlements = await entitlementService.resolve();
  return r.entitlements;
};

/**
 * Refuses when the tenant's plan does not include `feature` (403 FEATURE_NOT_IN_PLAN)
 * or when the subscription is suspended or cancelled and the request writes
 * (403 SUBSCRIPTION_INACTIVE). Platform admins pass.
 */
export const assertFeature = async (req: Request, feature: string): Promise<void> => {
  if (isSuperAdmin(req)) return;
  const e = await entitlementsFor(req);
  if (feature !== "core" && !e.features.includes(feature)) {
    throw new ApiError(
      403,
      `This part of Shiftline is not included in your ${e.plan?.name ?? "current"} plan`,
      "FEATURE_NOT_IN_PLAN",
      { feature }
    );
  }
  if (e.readOnly && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    throw new ApiError(
      403,
      "Your subscription is not active; data can be viewed and exported but not changed",
      "SUBSCRIPTION_INACTIVE"
    );
  }
};

/** Standalone gate for routes that carry no permission check. */
export const requireFeature =
  (feature: string) => (req: Request, _res: Response, next: NextFunction) => {
    assertFeature(req, feature).then(() => next(), next);
  };

/** Feature implied by a permission key, for the permission middleware. */
export const featureOf = (permission: string) => featureForPermission(permission);
