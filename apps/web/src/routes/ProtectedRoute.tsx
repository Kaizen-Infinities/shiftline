import React, { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { featureForPermission } from "@shiftline/shared";
import { useAppSelector, useAppDispatch } from "../hooks/reduxHooks";
import { fetchCompany } from "../features/company/companySlice";
import CommonLoader from "../components/ui/Loader/CommonLoader";
import { usePermission } from "../hooks/usePermission";

interface ProtectedRouteProps {
  permission?: string;
  permissionAny?: string[];
  /** Plan feature the screen belongs to, for screens that carry no permission (P1-01). */
  feature?: string;
  redirectPath?: string;
}

const upgradeFor = (feature: string) => `/upgrade?feature=${encodeURIComponent(feature)}`;

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  permission,
  permissionAny,
  feature,
  redirectPath = "/unauthorized",
}) => {
  const dispatch = useAppDispatch();
  const { isAuthenticated, isInitialized } = useAppSelector((state) => state.auth);
  const { data: company, loading: companyLoading } = useAppSelector((state) => state.company);
  const { can, holds, hasFeature } = usePermission();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated && !company && !companyLoading) {
      dispatch(fetchCompany());
    }
  }, [isAuthenticated, company, companyLoading, dispatch]);

  // Show loading screen while auth or company details are initializing
  if (!isInitialized || (isAuthenticated && !company)) {
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
