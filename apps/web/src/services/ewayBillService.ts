import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** E-way bills and the transporter master (P1-12). */
export type EwbDocType = "INV" | "CHL" | "JWC";
export type EwbStatus = "PENDING" | "ACTIVE" | "CANCELLED" | "EXPIRED" | "FAILED";
export interface EwayBillRow {
  id: string;
  docType: EwbDocType;
  docRef: string;
  docNo: string;
  docDate: string;
  irn: string | null;
  ewbNo: string | null;
  ewbDate: string | null;
  validUpto: string | null;
  status: EwbStatus;
  fromGstin: string;
  toGstin: string | null;
  distanceKm: number;
  transMode: string;
  transporterId: string | null;
  transporterName: string | null;
  transDocNo: string | null;
  vehicleNo: string | null;
  vehicleType: string;
  totalValue: string | number;
  error: string | null;
  updates: { at: string; kind: string; [k: string]: unknown }[];
  extensions: number;
  consolidatedNo: string | null;
  cancelledAt: string | null;
  cancelRemarks: string | null;
  createdAt: string;
}
export interface TransporterRow {
  id: string;
  code: string;
  name: string;
  transporterId: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}
export interface TripSheetRow {
  id: string;
  cewbNo: string;
  cewbDate: string;
  vehicleNo: string;
  fromPlace: string;
  ewbNos: string[];
  createdAt: string;
}
export interface GenerateInput {
  docType: EwbDocType;
  docRef: string;
  distanceKm: number;
  transMode: string;
  transporterId?: string | null;
  transporterName?: string | null;
  transDocNo?: string | null;
  transDocDate?: string | null;
  vehicleNo?: string | null;
  vehicleType: string;
}

const base = API_PATHS.ewayBill.base;
export const ewayBillService = {
  reasons: async (): Promise<{
    cancel: Record<string, string>;
    partB: Record<string, string>;
    extend: Record<string, string>;
  }> => (await apiClient.get(`${base}/reasons`)).data.data,
  list: async (
    q: { status?: EwbStatus; docType?: EwbDocType; expiringWithinHours?: number } = {}
  ): Promise<EwayBillRow[]> => (await apiClient.get(base, { params: q })).data.data,
  forDocument: async (docType: EwbDocType, docRef: string): Promise<EwayBillRow[]> =>
    (await apiClient.get(`${base}/document/${docType}/${docRef}`)).data.data,
  get: async (id: string): Promise<EwayBillRow> => (await apiClient.get(`${base}/${id}`)).data.data,
  generate: async (input: GenerateInput): Promise<EwayBillRow> =>
    (await apiClient.post(`${base}/generate`, input)).data.data,
  partB: async (id: string, input: Record<string, unknown>): Promise<EwayBillRow> =>
    (await apiClient.post(`${base}/${id}/part-b`, input)).data.data,
  extend: async (id: string, input: Record<string, unknown>): Promise<EwayBillRow> =>
    (await apiClient.post(`${base}/${id}/extend`, input)).data.data,
  cancel: async (id: string, reason: string, remarks: string): Promise<EwayBillRow> =>
    (await apiClient.post(`${base}/${id}/cancel`, { reason, remarks })).data.data,
  tripSheets: async (): Promise<TripSheetRow[]> =>
    (await apiClient.get(API_PATHS.ewayBill.consolidated)).data.data,
  consolidate: async (input: {
    fromPlace: string;
    fromState: number;
    vehicleNo: string;
    transMode: string;
    ewbIds: string[];
  }): Promise<TripSheetRow> =>
    (await apiClient.post(API_PATHS.ewayBill.consolidated, input)).data.data,
};

const tBase = API_PATHS.transporters.base;
export const transporterService = {
  list: async (includeInactive = false): Promise<TransporterRow[]> =>
    (await apiClient.get(tBase, { params: includeInactive ? { includeInactive: "true" } : {} }))
      .data.data,
  create: async (input: Partial<TransporterRow>): Promise<TransporterRow> =>
    (await apiClient.post(tBase, input)).data.data,
  update: async (id: string, input: Partial<TransporterRow>): Promise<TransporterRow> =>
    (await apiClient.put(`${tBase}/${id}`, input)).data.data,
  retire: async (id: string): Promise<TransporterRow> =>
    (await apiClient.delete(`${tBase}/${id}`)).data.data,
};
