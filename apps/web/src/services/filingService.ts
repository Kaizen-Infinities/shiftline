import apiClient from "../api/apiClient";
import { API_PATHS, type FilingDef, type FilingStatus } from "@shiftline/shared";

/** Approval gates on statutory filings (P1-04). */
export interface FilingHistoryEntry {
  at: string;
  event: string;
  by: string | null;
  note?: string | null;
}
export interface FilingApprovalRow {
  id: string;
  filingType: string;
  periodKey: string;
  businessPlaceId: string | number | null;
  status: FilingStatus;
  payloadHash: string;
  summary: Record<string, unknown>;
  notes: string | null;
  preparedBy: string | null;
  preparedAt: string | null;
  sentForApprovalAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  rejectReason: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  submissionRef: string | null;
  history: FilingHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}
export interface FilingListQuery {
  filingType?: string;
  status?: FilingStatus;
  periodKey?: string;
}

const base = API_PATHS.filings.approvals;
export const filingService = {
  registry: async (): Promise<FilingDef[]> =>
    (await apiClient.get(API_PATHS.filings.registry)).data.data,
  list: async (q: FilingListQuery = {}): Promise<FilingApprovalRow[]> =>
    (await apiClient.get(base, { params: q })).data.data,
  get: async (id: string): Promise<FilingApprovalRow> =>
    (await apiClient.get(`${base}/${id}`)).data.data,
  /** Registers or refreshes the draft for a period; used by the filing packages. */
  draft: async (input: {
    filingType: string;
    periodKey: string;
    businessPlaceId?: number | null;
    summary?: Record<string, unknown>;
    payloadHash?: string;
    notes?: string | null;
  }): Promise<FilingApprovalRow> => (await apiClient.post(base, input)).data.data,
  send: async (id: string): Promise<FilingApprovalRow> =>
    (await apiClient.post(`${base}/${id}/send`)).data.data,
  approve: async (id: string): Promise<FilingApprovalRow> =>
    (await apiClient.post(`${base}/${id}/approve`)).data.data,
  reject: async (id: string, reason: string): Promise<FilingApprovalRow> =>
    (await apiClient.post(`${base}/${id}/reject`, { reason })).data.data,
  markSubmitted: async (id: string, submissionRef?: string | null): Promise<FilingApprovalRow> =>
    (await apiClient.post(`${base}/${id}/submitted`, { submissionRef: submissionRef ?? null })).data
      .data,
};
