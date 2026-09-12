import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** Job work, delivery challans and ITC-04 (P1-14). */
export type ChallanKind =
  "JOB_WORK_OUT" | "JOB_WORK_RETURN" | "BRANCH_TRANSFER" | "EXHIBITION" | "LINE_SALES" | "OTHER";
export type ChallanStatus = "OPEN" | "PART_RETURNED" | "CLOSED" | "CANCELLED";

export interface JobWorkerRow {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  processType: string | null;
  isActive: boolean;
}
export interface ChallanItemRow {
  id: string;
  description: string | null;
  rawMaterialId: string | null;
  uom: string | null;
  hsnCode: string | null;
  quantitySent: number;
  quantityReturned: number;
  quantityConsumed: number;
  quantityScrap: number;
  balance: number;
  rate: number;
  taxableAmount: number;
}
export interface ChallanRow {
  id: string;
  challanNo: string;
  challanDate: string;
  kind: ChallanKind;
  status: ChallanStatus;
  jobWorkerId: string | null;
  jobWorker?: { id: string; code: string; name: string } | null;
  purpose: string | null;
  capitalGoods: boolean;
  returnDueDate: string | null;
  taxable: number;
  totalValue: number;
  items: ChallanItemRow[];
  pendingQuantity: number;
  daysToReturn: number | null;
  overdue: boolean;
}
export interface Itc04 {
  periodKey: string;
  from: string;
  to: string;
  table4: {
    challanNo: string;
    challanDate: string;
    jobWorkerName: string | null;
    registered: boolean;
    description: string;
    uom: string | null;
    quantity: number;
    taxable: number;
    capitalGoods: boolean;
  }[];
  table5A: {
    challanNo: string;
    challanDate: string;
    originalChallanNo: string | null;
    description: string;
    quantity: number;
  }[];
  totals: {
    challansIssued: number;
    quantitySent: number;
    valueSent: number;
    challansReceived: number;
  };
}

const p = API_PATHS.jobWork;

export const jobWorkService = {
  workers: async (all = false): Promise<JobWorkerRow[]> =>
    (await apiClient.get(p.workers, { params: { all } })).data.data,
  saveWorker: async (body: Partial<JobWorkerRow> & { name: string }): Promise<JobWorkerRow> =>
    (await apiClient.post(p.workers, body)).data.data,
  challans: async (
    q: { kind?: ChallanKind; status?: ChallanStatus; overdueOnly?: boolean } = {}
  ): Promise<ChallanRow[]> => (await apiClient.get(p.challans, { params: q })).data.data,
  challan: async (id: string): Promise<ChallanRow> =>
    (await apiClient.get(`${p.challans}/${id}`)).data.data,
  receive: async (
    id: string,
    lines: { itemId: string; returned?: number; consumed?: number; scrap?: number }[]
  ): Promise<ChallanRow> =>
    (await apiClient.post(`${p.challans}/${id}/receive`, { lines })).data.data,
  register: async (q: { from?: string; to?: string } = {}) =>
    (await apiClient.get(p.register, { params: q })).data.data,
  itc04: async (period: string): Promise<Itc04> =>
    (await apiClient.get(p.itc04, { params: { period } })).data.data,
  pdfUrl: (id: string) => `${p.challans}/${id}/pdf`,
};
