import apiClient from "../api/apiClient";
import type { DeviceRow } from "./platformService";

/** A tenant's own field devices (P1-02 B1): list, revoke-and-wipe, restore. */
export const deviceService = {
  list: async (includeRevoked = true): Promise<DeviceRow[]> =>
    (
      await apiClient.get("/mobile/admin/devices", {
        params: includeRevoked ? { includeRevoked: "true" } : {},
      })
    ).data.data,
  revoke: async (id: string): Promise<DeviceRow> =>
    (await apiClient.post(`/mobile/admin/devices/${id}/revoke`)).data.data,
  restore: async (id: string): Promise<DeviceRow> =>
    (await apiClient.post(`/mobile/admin/devices/${id}/restore`)).data.data,
};
