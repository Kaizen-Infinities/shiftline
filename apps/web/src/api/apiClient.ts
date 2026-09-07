import axios from "axios";

let storeRef: any;

export const injectStore = (_store: any) => {
  storeRef = _store;
};

const apiUrl = import.meta.env.VITE_API_URL;

export const apiClient = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor: Attach bearer token from Redux state dynamically
apiClient.interceptors.request.use(
  (config) => {
    if (storeRef) {
      const token = storeRef.getState().auth.accessToken;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    const isFormData = config.data instanceof FormData;

    if (isFormData) {
      // Let browser set multipart boundary automatically
      delete config.headers["Content-Type"];
    } else {
      config.headers["Content-Type"] = "application/json";
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: on 401, rotate the refresh cookie once and retry; only
// when that fails is the session really over.
const AUTH_ENDPOINTS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/logout-all-sessions",
];

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config ?? {};
    const url: string = config.url ?? "";
    const isAuthCall = AUTH_ENDPOINTS.some((p) => url.includes(p));
    if (error.response?.status === 401 && !isAuthCall && !config.__retried) {
      const { refreshAccessToken } = await import("./refresh");
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        if (storeRef) {
          const { setAccessToken } = await import("../features/auth/authSlice");
          storeRef.dispatch(setAccessToken(refreshed));
        }
        config.__retried = true;
        config.headers = {
          ...(config.headers ?? {}),
          Authorization: `Bearer ${refreshed.accessToken}`,
        };
        return apiClient.request(config);
      }
      if (storeRef) {
        const { clearUser } = await import("../features/auth/authSlice");
        storeRef.dispatch(clearUser());
      }
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
