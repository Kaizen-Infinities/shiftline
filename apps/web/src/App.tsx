import React, { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "./hooks/reduxHooks";
import { initializeAuth, setAccessToken, clearUser } from "./features/auth/authSlice";
import { refreshAccessToken } from "./api/refresh";
import AppRoutes from "./routes/AppRoutes";
import CommonLoader from "./components/ui/Loader/CommonLoader";
import { SocketProvider } from "./providers/SocketProvider";

const App: React.FC = () => {
  const dispatch = useAppDispatch();
  const { isInitialized, isAuthenticated, accessTokenExpiresAt } = useAppSelector(
    (state) => state.auth
  );

  useEffect(() => {
    dispatch(initializeAuth());
  }, [dispatch]);

  // Renew the 15-minute access token a minute before it expires, so screens
  // and the socket never see a 401 in normal use (P0-13).
  useEffect(() => {
    if (!isAuthenticated || !accessTokenExpiresAt) return;
    const delay = Math.max(5_000, new Date(accessTokenExpiresAt).getTime() - Date.now() - 60_000);
    const timer = setTimeout(async () => {
      const refreshed = await refreshAccessToken();
      if (refreshed) dispatch(setAccessToken(refreshed));
      else dispatch(clearUser());
    }, delay);
    return () => clearTimeout(timer);
  }, [dispatch, isAuthenticated, accessTokenExpiresAt]);

  if (!isInitialized) {
    return <CommonLoader text="Loading..." />;
  }

  return (
    <SocketProvider>
      <AppRoutes />
    </SocketProvider>
  );
};

export default App;
