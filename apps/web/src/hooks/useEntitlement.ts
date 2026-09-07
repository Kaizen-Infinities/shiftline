import { featureForPermission } from "@shiftline/shared";
import { usePermission } from "./usePermission";

/**
 * Plan awareness for screens (P1-01): which features the tenant has, whether a
 * permission is blocked only by the plan, and the subscription state for banners.
 */
export const useEntitlement = () => {
  const { hasFeature, holds, entitlements, isSuperAdmin } = usePermission();
  return {
    entitlements,
    hasFeature,
    /** The user holds the permission but the plan lacks its feature. */
    needsUpgradeFor: (permission: string) =>
      !isSuperAdmin && holds(permission) && !hasFeature(featureForPermission(permission)),
    featureOf: featureForPermission,
    readOnly: !!entitlements?.readOnly,
    pastDue: !!entitlements?.pastDue,
    trialEndsAt: entitlements?.trialEndsAt ?? null,
    planName: entitlements?.plan?.name ?? null,
  };
};
