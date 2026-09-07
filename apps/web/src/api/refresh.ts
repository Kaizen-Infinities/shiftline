import axios from "axios";

/**
 * One refresh at a time. Every caller that hits a 401 (axios interceptor, RTK
 * base query, the proactive timer) awaits the same in-flight request, so a
 * burst of expired calls costs one rotation, not ten. Uses a bare axios
 * instance: the shared client's interceptors must not recurse into this.
 */
let inflight: Promise<RefreshResult | null> | null = null;

export interface RefreshResult {
  accessToken: string;
  accessTokenExpiresAt: string | null;
}

export const refreshAccessToken = (): Promise<RefreshResult | null> => {
  if (!inflight) {
    inflight = axios
      .post(`${import.meta.env.VITE_API_URL}/auth/refresh`, {}, { withCredentials: true })
      .then((res) => {
        const data = res.data?.data ?? res.data;
        return data?.accessToken
          ? {
              accessToken: data.accessToken as string,
              accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
            }
          : null;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
};
