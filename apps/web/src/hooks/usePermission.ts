import { useCallback } from "react";
import { featureForPermission } from "@shiftline/shared";
import { useAppSelector } from "./reduxHooks";

/**
 * usePermission — Single Source of Truth for frontend authorization.
 *
 * Reads the permissions[] array from Redux auth state (decoded from JWT) and, since
 * P1-01, the tenant's plan entitlements: a permission is usable only when the plan
 * includes the feature its module belongs to. Super Admins bypass every check.
 *
 * Usage:
 *   const { can, canAny, canAll, holds, hasFeature, isSuperAdmin } = usePermission();
 *   if (can("users.create")) { ... }
 */
export const usePermission = () => {
  const { permissions, user, entitlements } = useAppSelector((state) => state.auth);

  // Super Admin check — isSuperAdmin flag is set at login for ROLE_ADMIN accounts
  const isSuperAdmin = !!user?.isSuperAdmin;

  /**
   * Plan features. Until the profile has loaded every feature counts as available so
   * the first render does not flicker; the API is the authority either way.
   */
  const hasFeature = useCallback(
    (feature: string): boolean => {
      if (isSuperAdmin || feature === "core") return true;
      if (!entitlements) return true;
      return entitlements.features.includes(feature);
    },
    [entitlements, isSuperAdmin]
  );

  /** Holds the permission regardless of plan: distinguishes "upgrade" from "ask your admin". */
  const holds = useCallback(
    (permission: string): boolean => isSuperAdmin || permissions.includes(permission),
    [permissions, isSuperAdmin]
  );

  /** True when the user holds the permission AND the tenant's plan includes its feature. */
  const can = useCallback(
    (permission: string): boolean => {
      if (isSuperAdmin) return true;
      return permissions.includes(permission) && hasFeature(featureForPermission(permission));
    },
    [permissions, isSuperAdmin, hasFeature]
  );

  /** True when the user can use AT LEAST ONE of the listed permissions. */
  const canAny = useCallback(
    (...perms: string[]): boolean => isSuperAdmin || perms.some((p) => can(p)),
    [can, isSuperAdmin]
  );

  /** True when the user can use ALL listed permissions. */
  const canAll = useCallback(
    (...perms: string[]): boolean => isSuperAdmin || perms.every((p) => can(p)),
    [can, isSuperAdmin]
  );

  return { can, canAny, canAll, holds, hasFeature, entitlements, isSuperAdmin, permissions };
};
