import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** Public platform status (P1-05); no sign-in needed. */
export type ComponentState = "ok" | "degraded" | "down" | "unknown";
export interface ComponentReport {
  state: ComponentState;
  detail: string;
  at: string | null;
}
export interface StatusReport {
  overall: "operational" | "degraded" | "down";
  components: Record<"api" | "database" | "migrations" | "worker" | "backups", ComponentReport>;
  checkedAt: string;
}

export const statusService = {
  report: async (): Promise<StatusReport> =>
    (await apiClient.get(API_PATHS.status, { validateStatus: (s) => s < 600 })).data,
};
