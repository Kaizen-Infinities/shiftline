import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** TDS and TCS (P1-15). */
export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
export interface TdsSectionRow {
  id: string;
  code: string;
  actCode: string | null;
  name: string;
  isTcs: boolean;
  ledgerCode: string | null;
  rateCompany: number;
  rateIndividual: number;
  rateNoPan: number;
  thresholdSingle: number;
  thresholdAnnual: number;
  isActive: boolean;
}
export interface TdsDeductionRow {
  id: string;
  section: { code: string; name: string; isTcs: boolean };
  deducteeName: string;
  deducteePan: string | null;
  docNo: string;
  deductionDate: string;
  amountPaid: number;
  taxableAmount: number;
  rate: number;
  tdsAmount: number;
  rateReason: string | null;
  fyCode: string;
  quarter: Quarter;
  status: "PENDING" | "CHALLAN_PAID" | "RETURN_FILED" | "CANCELLED";
  challanId: string | null;
  challan: { bsrCode: string; challanSerial: string; challanDate: string } | null;
}
export interface TdsChallanRow {
  id: string;
  bsrCode: string;
  challanSerial: string;
  challanDate: string;
  periodKey: string;
  fyCode: string;
  quarter: Quarter;
  tdsAmount: number;
  interest: number;
  lateFee: number;
  totalAmount: number;
  isTcs: boolean;
  deductions: { id: string; docNo: string; tdsAmount: number }[];
}
export interface TdsReturnView {
  formType: "26Q" | "27Q";
  fyCode: string;
  quarter: Quarter;
  deductor: { name: string; tan: string | null; pan: string | null };
  challans: {
    bsrCode: string;
    serial: string;
    date: string;
    tdsAmount: number;
    deductees: number;
  }[];
  lines: {
    section: string;
    deducteeName: string;
    deducteePan: string | null;
    docNo: string;
    deductionDate: string;
    amountPaid: number;
    rate: number;
    tdsAmount: number;
    challan: { bsrCode: string; serial: string } | null;
  }[];
  totals: { deductees: number; amountPaid: number; tdsDeducted: number; challanTotal: number };
  warnings: string[];
  filing: { id: string; status: string } | null;
}

export interface TdsRateDecision {
  rate: number;
  reason: string;
  base: number;
  belowThreshold: boolean;
}

const p = API_PATHS.tds;

export const tdsService = {
  sections: async (all = false): Promise<TdsSectionRow[]> =>
    (await apiClient.get(p.sections, { params: { all } })).data.data,
  /** What would be deducted, without deducting it (P2-05) — the GRN form's live preview line. */
  preview: async (body: {
    sectionCode: string;
    supplierId?: number | null;
    deducteePan?: string | null;
    deducteeType?:
      "COMPANY" | "INDIVIDUAL_HUF" | "FIRM" | "AOP_BOI" | "LOCAL_AUTHORITY" | "NON_RESIDENT";
    higherRate?: boolean;
    amount: number;
    on?: string;
  }): Promise<TdsRateDecision> => (await apiClient.post(p.preview, body)).data.data,
  saveSection: async (body: Partial<TdsSectionRow> & { code: string; name: string }) =>
    (await apiClient.post(p.sections, body)).data.data,
  deductions: async (
    q: { fyCode?: string; quarter?: Quarter; unchallanedOnly?: boolean } = {}
  ): Promise<TdsDeductionRow[]> => (await apiClient.get(p.deductions, { params: q })).data.data,
  challans: async (q: { fyCode?: string; quarter?: Quarter } = {}): Promise<TdsChallanRow[]> =>
    (await apiClient.get(p.challans, { params: q })).data.data,
  payChallan: async (body: {
    bsrCode: string;
    challanSerial: string;
    challanDate: string;
    periodKey: string;
    deductionIds: string[];
    interest?: number;
    lateFee?: number;
  }): Promise<TdsChallanRow> => (await apiClient.post(p.challans, body)).data.data,
  return: async (form: "26Q" | "27Q", fyCode: string, quarter: Quarter): Promise<TdsReturnView> =>
    (await apiClient.get(`${p.returns}/${form}`, { params: { fyCode, quarter } })).data.data,
  registerReturn: async (form: "26Q" | "27Q", fyCode: string, quarter: Quarter) =>
    (await apiClient.post(`${p.returns}/${form}/register`, { fyCode, quarter })).data.data,
  fileUrl: (form: "26Q" | "27Q", fyCode: string, quarter: Quarter) =>
    `${p.returns}/${form}/file?fyCode=${fyCode}&quarter=${quarter}`,
};
