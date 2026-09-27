import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** MSME delayed-payment claims, receivable side (TN-05). */
export type ClaimStatus = "DRAFT" | "FILED" | "HEARING" | "SETTLED" | "WITHDRAWN";
export type ClaimForum = "SAMADHAAN" | "MSEFC" | "DIRECT";

export interface MsmeClaimSettings {
  bankRate: number;
  annualRate: number;
  bankRateNote: string | null;
  udyamNumber: string | null;
  enterpriseCategory: "MICRO" | "SMALL" | "MEDIUM" | null;
  isDefault: boolean;
  verifyNote: string;
  updatedAt: string | null;
}

export interface EligibleInvoice {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  customerId: string;
  customerName: string;
  amount: number;
  paid: number;
  principalOutstanding: number;
  limitDays: number;
  dueDate: string;
  daysLate: number;
  interest: number;
  treds: { flag: "CHECK" | "NO"; reason: string };
  claim: { id: string; claimNo: string; status: ClaimStatus } | null;
}

export interface EligibleReport {
  asOf: string;
  bankRate: number;
  annualRate: number;
  rows: EligibleInvoice[];
  buyers: {
    customerId: string;
    customerName: string;
    invoices: number;
    principal: number;
    interest: number;
  }[];
  totals: { invoices: number; principal: number; interest: number; tredsCheck: number };
}

export interface ClaimLine {
  id: string;
  salesInvoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  acceptedOn: string;
  invoiceAmount: number;
  paidAmount: number;
  principalOutstanding: number;
  limitDays: number;
  dueDate: string;
  daysLate: number;
  interest: number;
}

export interface MsmeClaim {
  id: string;
  claimNo: string;
  customerId: string;
  customerName: string | null;
  customerGstin: string | null;
  status: ClaimStatus;
  nextStatuses: ClaimStatus[];
  forum: ClaimForum;
  asOfDate: string;
  bankRate: number;
  annualRate: number;
  principalTotal: number;
  interestTotal: number;
  claimTotal: number;
  filedOn: string | null;
  referenceNo: string | null;
  hearingOn: string | null;
  settledOn: string | null;
  settledAmount: number | null;
  notes: string | null;
  invoiceCount: number;
  createdAt: string;
}

export interface MsmeClaimDetail extends MsmeClaim {
  lines: ClaimLine[];
}

export interface StatusChange {
  status: ClaimStatus;
  filedOn?: string;
  referenceNo?: string;
  hearingOn?: string;
  settledOn?: string;
  settledAmount?: number;
  notes?: string;
}

const p = API_PATHS.msmeClaims;

export const msmeClaimsService = {
  settings: async (): Promise<MsmeClaimSettings> => (await apiClient.get(p.settings)).data.data,

  saveSettings: async (body: {
    bankRate: number;
    bankRateNote?: string | null;
    udyamNumber?: string | null;
    enterpriseCategory?: "MICRO" | "SMALL" | "MEDIUM" | null;
  }): Promise<MsmeClaimSettings> => (await apiClient.put(p.settings, body)).data.data,

  eligible: async (params: { customerId?: string; asOf?: string } = {}): Promise<EligibleReport> =>
    (await apiClient.get(p.eligible, { params })).data.data,

  list: async (params: { status?: ClaimStatus; customerId?: string } = {}): Promise<MsmeClaim[]> =>
    (await apiClient.get(p.base, { params })).data.data,

  get: async (id: string): Promise<MsmeClaimDetail> =>
    (await apiClient.get(`${p.base}/${id}`)).data.data,

  create: async (body: {
    customerId: string;
    invoiceIds: string[];
    forum?: ClaimForum;
    asOf?: string;
    notes?: string;
  }): Promise<MsmeClaimDetail> => (await apiClient.post(p.base, body)).data.data,

  updateStatus: async (id: string, body: StatusChange): Promise<MsmeClaimDetail> =>
    (await apiClient.patch(`${p.base}/${id}/status`, body)).data.data,

  recompute: async (id: string, asOf: string): Promise<MsmeClaimDetail> =>
    (await apiClient.post(`${p.base}/${id}/recompute`, { asOf })).data.data,

  downloadPdf: async (id: string, claimNo: string): Promise<void> => {
    const res = await apiClient.get(`${p.base}/${id}/pdf`, { responseType: "blob" });
    const href = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = `MSME-claim-${claimNo.replace(/[^\w.-]+/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },
};
