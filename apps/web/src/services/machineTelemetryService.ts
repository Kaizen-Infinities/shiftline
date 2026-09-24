import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** Machine telemetry (P2-01): gateways, the signal-map translation, cycles, gateway health. */
export type GatewayAdapterKind = "SIMULATOR" | "OPCUA_EUROMAP77" | "EUROMAP63_FILE" | "MODBUS_MQTT";

export interface MachineGatewayRow {
  id: string;
  code: string;
  machineId: string;
  adapterKind: GatewayAdapterKind;
  connectionSettings: Record<string, unknown>;
  hasCredentials: boolean;
  pollIntervalSeconds: number;
  isActive: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayInput {
  code?: string;
  machineId?: string;
  adapterKind?: GatewayAdapterKind;
  connectionSettings?: Record<string, unknown>;
  credentials?: Record<string, unknown> | null;
  pollIntervalSeconds?: number;
  isActive?: boolean;
}

export interface SignalMapRow {
  id: string;
  gatewayId: string;
  vendorTag: string;
  canonicalSignal: string;
  unit: string | null;
  dataType: "NUMERIC" | "TEXT";
  isActive: boolean;
}

export interface CanonicalSignalRef {
  signal: string;
  unit: string | null;
  dataType: "NUMERIC" | "TEXT";
  description: string;
}

const base = API_PATHS.machineGateway.base;

export const machineGatewayService = {
  list: async (): Promise<MachineGatewayRow[]> => (await apiClient.get(base)).data.data,
  get: async (id: string): Promise<MachineGatewayRow> =>
    (await apiClient.get(`${base}/${id}`)).data.data,
  create: async (input: GatewayInput): Promise<MachineGatewayRow> =>
    (await apiClient.post(base, input)).data.data,
  update: async (id: string, input: GatewayInput): Promise<MachineGatewayRow> =>
    (await apiClient.put(`${base}/${id}`, input)).data.data,
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`${base}/${id}`);
  },
  testConnection: async (id: string): Promise<{ ok: boolean; detail: string }> =>
    (await apiClient.post(`${base}/${id}/test-connection`, {})).data.data,
  signalMap: async (id: string): Promise<SignalMapRow[]> =>
    (await apiClient.get(`${base}/${id}/signal-map`)).data.data,
  replaceSignalMap: async (
    id: string,
    rows: {
      vendorTag: string;
      canonicalSignal: string;
      unit?: string | null;
      dataType?: "NUMERIC" | "TEXT";
    }[]
  ): Promise<SignalMapRow[]> =>
    (await apiClient.put(`${base}/${id}/signal-map`, { rows })).data.data,
};

export const machineTelemetryReadService = {
  canonicalSignals: async (): Promise<CanonicalSignalRef[]> =>
    (await apiClient.get(`${API_PATHS.machineTelemetry.base}/canonical-signals`)).data.data,
  health: async (): Promise<MachineGatewayRow[]> =>
    (await apiClient.get(API_PATHS.machineTelemetry.health)).data.data,
  cycles: async (params: { machineId?: string; gatewayId?: string; limit?: number }) =>
    (await apiClient.get(API_PATHS.machineTelemetry.cycles, { params })).data.data,
};
