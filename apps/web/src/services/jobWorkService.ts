import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";
import type { FilingApprovalRow } from "./filingService";

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
  parentItemId: string | null;
  description: string | null;
  rawMaterialId: string | null;
  uom: string | null;
  hsnCode: string | null;
  quantitySent: number;
  quantityReturned: number;
  quantityConsumed: number;
  quantityScrap: number;
  quantityDirectSupply: number;
  directSupplyInvoiceNo: string | null;
  directSupplyInvoiceDate: string | null;
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
  fromJobWorkerId: string | null;
  jobWorker?: { id: string; code: string; name: string } | null;
  parentChallanId: string | null;
  purpose: string | null;
  capitalGoods: boolean;
  returnDueDate: string | null;
  taxable: number;
  totalValue: number;
  items: ChallanItemRow[];
  pendingQuantity: number;
  daysToReturn: number | null;
  overdue: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
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
  table5B: {
    challanNo: string;
    challanDate: string;
    fromJobWorkerGstin: string | null;
    toJobWorkerGstin: string | null;
    description: string;
    quantity: number;
    taxable: number;
  }[];
  table5C: {
    challanNo: string;
    challanDate: string;
    jobWorkerGstin: string | null;
    invoiceNo: string | null;
    invoiceDate: string | null;
    description: string;
    quantity: number;
  }[];
  totals: {
    challansIssued: number;
    quantitySent: number;
    valueSent: number;
    challansReceived: number;
    challansTransferred: number;
    directSupplyLines: number;
  };
}
export interface Itc04Registered extends Itc04 {
  json?: Record<string, unknown>;
  payloadHash?: string;
  filing?: FilingApprovalRow | null;
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
  /** ITC-04 is filed per registration, so a half-year is scoped to one business place's GSTIN
   * (undefined/null means the company's own GSTIN) — same shape as GSTR-1's GSTIN selector. */
  itc04: async (period: string, businessPlaceId?: string | null): Promise<Itc04Registered> =>
    (
      await apiClient.get(p.itc04, {
        params: { period, businessPlaceId: businessPlaceId || undefined },
      })
    ).data.data,
  registerItc04: async (
    period: string,
    businessPlaceId?: string | null
  ): Promise<Itc04Registered> =>
    (
      await apiClient.post(p.itc04Register, {
        period,
        businessPlaceId: businessPlaceId || undefined,
      })
    ).data.data,
  pdfUrl: (id: string) => `${p.challans}/${id}/pdf`,
  cancel: async (id: string, reason: string): Promise<ChallanRow> =>
    (await apiClient.post(`${p.challans}/${id}/cancel`, { reason })).data.data,
  /** The one-step receipt: a return challan raised against a parent posts to it directly. */
  createReturn: async (
    parentChallanId: string,
    jobWorkerId: string | null,
    challanDate: string,
    lines: {
      parentItemId: string;
      description: string | null;
      uom: string | null;
      quantity: number;
      scrap?: number;
    }[]
  ): Promise<ChallanRow> =>
    (
      await apiClient.post(p.challans, {
        kind: "JOB_WORK_RETURN",
        parentChallanId,
        jobWorkerId,
        challanDate,
        items: lines.map((l) => ({
          parentItemId: l.parentItemId,
          description: l.description,
          uom: l.uom,
          quantity: l.quantity,
          scrap: l.scrap ?? 0,
        })),
      })
    ).data.data,
};
