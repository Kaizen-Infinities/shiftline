import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** MSME dues and section 43B(h) (P1-07). */
export type MsmeCategory = "MICRO" | "SMALL" | "MEDIUM" | "NOT_REGISTERED";

export interface MsmeBillRow {
  grnId: string;
  grnNumber: string;
  invoiceNo: string;
  supplierId: number;
  supplierName: string;
  udyamNumber: string | null;
  category: MsmeCategory;
  acceptedOn: string;
  limitDays: number;
  dueDate: string;
  billAmount: number;
  paid: number;
  outstanding: number;
  settledOn: string | null;
  daysLeft: number;
  overdue: boolean;
  paidLate: boolean;
}

export interface MsmeSupplierTotal {
  supplierId: number;
  supplierName: string;
  udyamNumber: string | null;
  category: MsmeCategory;
  bills: number;
  amount: number;
}

export interface MsmeDisallowance {
  fyCode: string;
  fyStart: string;
  fyEnd: string;
  disallowed: { total: number; bills: MsmeBillRow[]; suppliers: MsmeSupplierTotal[] };
  allowedOnPayment: { total: number; bills: MsmeBillRow[]; suppliers: MsmeSupplierTotal[] };
}

export interface MsmeForm1 {
  periodKey: string;
  from: string;
  to: string;
  total: number;
  lines: {
    supplierName: string;
    udyamNumber: string | null;
    invoiceNo: string;
    amountOutstanding: number;
    dueSince: string;
    reason: string;
  }[];
  filing: { id: string; status: string } | null;
}

const p = API_PATHS.msme;

export const msmeService = {
  bills: async (
    q: { openOnly?: boolean; overdueOnly?: boolean; supplierId?: number } = {}
  ): Promise<MsmeBillRow[]> => (await apiClient.get(p.bills, { params: q })).data.data,
  disallowance: async (fyCode: string): Promise<MsmeDisallowance> =>
    (await apiClient.get(`${p.disallowance}/${fyCode}`)).data.data,
  form1: async (periodKey: string): Promise<MsmeForm1> =>
    (await apiClient.get(`${p.form1}/${periodKey}`)).data.data,
  registerForm1: async (periodKey: string): Promise<MsmeForm1> =>
    (await apiClient.post(`${p.form1}/${periodKey}/register`)).data.data,
};
