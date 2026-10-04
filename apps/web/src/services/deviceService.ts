import apiClient from "../api/apiClient";
import type { DeviceRow } from "./platformService";

/** A screen's opening request gives up after this long and shows its error state. */
const LOAD_TIMEOUT_MS = 30_000;

/** A tenant's own field devices (P1-02 B1): list, revoke-and-wipe, restore. */
export const deviceService = {
  list: async (includeRevoked = true): Promise<DeviceRow[]> =>
    (
      await apiClient.get("/mobile/admin/devices", {
        params: includeRevoked ? { includeRevoked: "true" } : {},
        timeout: LOAD_TIMEOUT_MS,
      })
    ).data.data,
  revoke: async (id: string): Promise<DeviceRow> =>
    (await apiClient.post(`/mobile/admin/devices/${id}/revoke`)).data.data,
  restore: async (id: string): Promise<DeviceRow> =>
    (await apiClient.post(`/mobile/admin/devices/${id}/restore`)).data.data,
};
