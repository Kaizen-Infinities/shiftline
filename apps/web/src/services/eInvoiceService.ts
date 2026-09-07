import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** E-invoicing (P1-11): IRN per document and the tenant's provider settings. */
export type EInvoiceDocType = "INV" | "CRN" | "DBN";
export type EInvoiceStatus = "PENDING" | "GENERATED" | "FAILED" | "CANCELLED";
export interface EInvoiceRow {
  id: string;
  docType: EInvoiceDocType;
  docId: string;
  docNo: string;
  docDate: string;
  sellerGstin: string;
  buyerGstin: string;
  status: EInvoiceStatus;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  signedQr?: string | null;
  ewbNo: string | null;
  error: string | null;
  attempts: number;
  cancelledAt: string | null;
  cancelRemarks: string | null;
  createdAt: string;
  updatedAt: string;
  queued?: boolean;
}
export interface EInvoiceSettings {
  provider: "FIXTURE" | "GSP";
  enabled: boolean;
  applicableFrom: string | null;
  aatoCrore: number | null;
  baseUrl: string | null;
  clientId: string | null;
  username: string | null;
  hasClientSecret: boolean;
  hasPassword: boolean;
  lastVerifiedAt: string | null;
  thirtyDayWindow: boolean;
}
export interface Applicability {
  applies: boolean;
  reason: string | null;
  deadline: string | null;
}

const base = API_PATHS.eInvoice.base;
export const eInvoiceService = {
  settings: async (): Promise<EInvoiceSettings> =>
    (await apiClient.get(API_PATHS.eInvoice.settings)).data.data,
  saveSettings: async (
    input: Partial<EInvoiceSettings> & { clientSecret?: string; password?: string }
  ): Promise<EInvoiceSettings> =>
    (await apiClient.put(API_PATHS.eInvoice.settings, input)).data.data,
  verify: async (): Promise<{ ok: boolean; detail: string }> =>
    (await apiClient.post(`${API_PATHS.eInvoice.settings}/verify`)).data.data,
  cancelReasons: async (): Promise<Record<string, string>> =>
    (await apiClient.get(`${base}/cancel-reasons`)).data.data,
  applicability: async (date: string, buyerGstin?: string | null): Promise<Applicability> =>
    (
      await apiClient.get(`${base}/applicability`, {
        params: { date, buyerGstin: buyerGstin || undefined },
      })
    ).data.data,
  forDocument: async (docType: EInvoiceDocType, docId: string): Promise<EInvoiceRow | null> =>
    (await apiClient.get(`${base}/document/${docType}/${docId}`)).data.data,
  list: async (
    q: { status?: EInvoiceStatus; docType?: EInvoiceDocType; from?: string; to?: string } = {}
  ): Promise<EInvoiceRow[]> => (await apiClient.get(base, { params: q })).data.data,
  generate: async (docType: EInvoiceDocType, docId: string): Promise<EInvoiceRow> =>
    (await apiClient.post(`${base}/generate`, { docType, docId })).data.data,
  cancel: async (id: string, reason: string, remarks: string): Promise<EInvoiceRow> =>
    (await apiClient.post(`${base}/${id}/cancel`, { reason, remarks })).data.data,
};
