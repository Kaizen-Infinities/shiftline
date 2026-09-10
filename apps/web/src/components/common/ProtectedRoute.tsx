import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

interface ProtectedRouteProps {
  permission?: string;
  permissionAny?: string[];
  superAdmin?: boolean;
  redirectPath?: string;
}

import { useAppSelector } from "../../hooks/reduxHooks";
import { usePermission } from "../../hooks/usePermission";

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  permission,
  permissionAny,
  superAdmin,
  redirectPath = "/dashboard",
}) => {
  const { accessToken } = useAppSelector((state) => state.auth);
  const isAuthenticated = Boolean(accessToken);
  const { can, isSuperAdmin } = usePermission();
  const location = useLocation();

  // Not Logged In
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (superAdmin && !isSuperAdmin) {
    return <Navigate to={redirectPath} replace />;
  }

  // Permission Check
  if (permission && !can(permission)) {
    return <Navigate to={redirectPath} replace />;
  }

  if (permissionAny && permissionAny.length > 0 && !permissionAny.some((p) => can(p))) {
    return <Navigate to={redirectPath} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
