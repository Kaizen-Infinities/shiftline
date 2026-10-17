import apiClient from "../api/apiClient";
import config from "../api/config";
import type { LoginDto } from "../features/auth/types";

export const authService = {
  login: async (credentials: LoginDto) => {
    const response = await apiClient.post(`${config?.auth?.login}`, credentials);
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await apiClient.get(`${config?.auth?.getCurrentUser}`);
    return response.data;
  },

  /** Rotates the refresh cookie and returns a new access token; 401 when the session is gone. */
  refresh: async () => {
    const response = await apiClient.post(`${config?.auth?.refresh}`, {}, {
      skipAuthRefresh: true,
    } as never);
    return response.data;
  },

  logout: async () => {
    const response = await apiClient.post(`${config?.auth?.logout}`);
    return response.data;
  },

  getSessions: async () => {
    const response = await apiClient.get(`${config?.auth?.sessions}`);
    return response.data;
  },

  logoutAllSessions: async () => {
    const response = await apiClient.post(`${config?.auth?.logoutAllSessions}`);
    return response.data;
  },

  /** Emails a reset link. The API answers the same way whether or not the account exists. */
  requestPasswordReset: async (email: string) => {
    const response = await apiClient.post("/auth/password-reset-request", { email });
    return response.data;
  },

  /** Sets a new password from the token in the emailed link. */
  resetPassword: async (token: string, newPassword: string) => {
    const response = await apiClient.post("/auth/password-reset", { token, newPassword });
    return response.data;
  },
};

export default authService;
