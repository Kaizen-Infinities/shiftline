import React, { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { featureForPermission } from "@shiftline/shared";
import { useAppSelector, useAppDispatch } from "../hooks/reduxHooks";
import { endSessionSwitch } from "../features/auth/authSlice";
import { fetchCompany } from "../features/company/companySlice";
import CommonLoader from "../components/ui/Loader/CommonLoader";
import { usePermission } from "../hooks/usePermission";

interface ProtectedRouteProps {
  permission?: string;
  permissionAny?: string[];
  /** Plan feature the screen belongs to, for screens that carry no permission (P1-01). */
  feature?: string;
  /** Platform console screens (P1-02): only a super admin passes. */
  superAdmin?: boolean;
  redirectPath?: string;
}

const upgradeFor = (feature: string) => `/upgrade?feature=${encodeURIComponent(feature)}`;

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  permission,
  permissionAny,
  feature,
  superAdmin,
  redirectPath = "/unauthorized",
}) => {
  const dispatch = useAppDispatch();
  const { isAuthenticated, isInitialized, sessionSwitchTarget } = useAppSelector(
    (state) => state.auth
  );
  const { data: company, loading: companyLoading } = useAppSelector((state) => state.company);
  const { can, holds, hasFeature, isSuperAdmin } = usePermission();
  const location = useLocation();

  // Platform admins have no tenant company (P1-02): fetching one would fail and, because a
  // rejected fetch leaves `company` null, loop for ever and trip the rate limiter.
  // Mid-swap the user object can still describe the old identity while the token is already
  // the new one, so the company is only fetched once the switch has landed.
  const switching = sessionSwitchTarget !== null && location.pathname !== sessionSwitchTarget;
  useEffect(() => {
    if (switching) return;
    if (isAuthenticated && !company && !companyLoading && !isSuperAdmin) {
      dispatch(fetchCompany());
    }
  }, [switching, isAuthenticated, company, companyLoading, isSuperAdmin, dispatch]);

  // A session swap (impersonation start or stop) ends when the router shows its target path.
  useEffect(() => {
    if (sessionSwitchTarget !== null && location.pathname === sessionSwitchTarget) {
      dispatch(endSessionSwitch());
    }
  }, [sessionSwitchTarget, location.pathname, dispatch]);

  // Until then no protected screen is mounted: one for the old identity would otherwise
  // re-render, and fetch, under the new one (see AuthState.sessionSwitchTarget).
  if (switching) {
    return <CommonLoader text="Switching session..." />;
  }

  // Show loading screen while auth or company details are initializing
  if (!isInitialized || (isAuthenticated && !company && !isSuperAdmin)) {
    return <CommonLoader text="Loading..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A tenant that has not finished onboarding sees only the wizard (P1-00).
  if (company) {
    const isOnboardingPath = location.pathname.startsWith("/onboarding");
    if (!company.isOnboarded && !isOnboardingPath) {
      return <Navigate to="/onboarding" replace />;
    }
    if (company.isOnboarded && isOnboardingPath) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // Plan feature (P1-01): a screen outside the plan goes to the upgrade page, not to 403.
  if (feature && !hasFeature(feature)) {
    return <Navigate to={upgradeFor(feature)} replace />;
  }

  // RBAC permission check — Super Admin bypasses automatically via usePermission
  if (superAdmin && !isSuperAdmin) {
    return <Navigate to={redirectPath} replace />;
  }

  if (permission && !can(permission)) {
    if (holds(permission)) {
      return <Navigate to={upgradeFor(featureForPermission(permission))} replace />;
    }
    return <Navigate to={redirectPath} replace />;
  }
  if (permissionAny && permissionAny.length > 0 && !permissionAny.some((p) => can(p))) {
    const heldOnly = permissionAny.find((p) => holds(p));
    if (heldOnly) {
      return <Navigate to={upgradeFor(featureForPermission(heldOnly))} replace />;
    }
    return <Navigate to={redirectPath} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
