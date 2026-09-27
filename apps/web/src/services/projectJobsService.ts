import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";
import config from "../api/config";

/** Job / project costing (TN-09): per-job cost, margin vs quote, stages and billing. */
export type JobStatus = "QUOTED" | "IN_PROGRESS" | "COMPLETED" | "DELIVERED" | "CANCELLED";
export type StageStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "SKIPPED";
export type CostType = "MATERIAL" | "LABOUR" | "SUBCONTRACT" | "OVERHEAD";
export type BillingKind = "ADVANCE" | "STAGE_INVOICE" | "FINAL";
export type MarginBand = "HEALTHY" | "THIN" | "LOSS";

export interface JobSummary {
  quoted: number;
  costByType: Record<CostType, number>;
  costToDate: number;
  draftCost: number;
  margin: number;
  marginPct: number | null;
  percentComplete: number;
  advancesReceived: number;
  billed: number;
  advanceAdjusted: number;
  advanceBalance: number;
  billedVsCost: number;
  toBill: number;
  overQuote: boolean;
  marginBand: MarginBand;
}

export interface JobRow {
  id: string;
  jobNo: string;
  customerId: string;
  customerName: string | null;
  title: string;
  description: string | null;
  quotedAmount: number;
  quoteDate: string;
  targetDate: string | null;
  chassisNo: string | null;
  chassisMake: string | null;
  chassisReceivedOn: string | null;
  conditionNotes: string | null;
  status: JobStatus;
  stageCount: number;
  currentStage: string | null;
  summary: JobSummary;
}

export interface JobStage {
  id: string;
  seq: number;
  name: string;
  weight: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: StageStatus;
  remarks: string | null;
}

export interface JobCost {
  id: string;
  type: CostType;
  costDate: string;
  description: string;
  qty: number;
  uom: string | null;
  rate: number;
  amount: number;
  rawMaterialId: string | null;
  stockIssueId: string | null;
  employeeId: string | null;
  vendorName: string | null;
  status: "DRAFT" | "POSTED";
}

export interface JobBilling {
  id: string;
  kind: BillingKind;
  billDate: string;
  amount: number;
  advanceAdjusted: number;
  stageId: string | null;
  salesInvoiceId: string | null;
  reference: string | null;
  remarks: string | null;
}

export interface JobDetail extends JobRow {
  stages: JobStage[];
  costs: JobCost[];
  billings: JobBilling[];
}

export interface StagePlan {
  key: string;
  name: string;
  stages: string[];
}

export interface CreateJob {
  jobNo: string;
  customerId: string;
  title: string;
  description?: string;
  quotedAmount: number;
  quoteDate: string;
  targetDate?: string;
  chassisNo?: string;
  chassisMake?: string;
  chassisReceivedOn?: string;
  conditionNotes?: string;
  stagePlan?: string;
}

export interface AddCost {
  type: CostType;
  costDate: string;
  description: string;
  qty?: number;
  uom?: string;
  rate?: number;
  rawMaterialId?: string;
  stockIssueId?: string;
  employeeId?: string;
  vendorName?: string;
  post?: boolean;
}

export interface AddBilling {
  kind: BillingKind;
  billDate: string;
  amount: number;
  advanceAdjusted?: number;
  stageId?: string;
  salesInvoiceId?: string;
  reference?: string;
  remarks?: string;
}

export interface RawMaterialOption {
  id: string;
  code: string;
  name: string;
  rate: number | null;
  uom: string;
}

const p = API_PATHS.projectJobs;
const data = <T>(r: { data: { data: T } }): T => r.data.data;

export const projectJobsService = {
  stagePlans: async (): Promise<StagePlan[]> => data(await apiClient.get(p.stagePlans)),

  list: async (filters: { status?: JobStatus; q?: string } = {}): Promise<JobRow[]> =>
    data(await apiClient.get(p.base, { params: filters })),

  get: async (id: string): Promise<JobDetail> => data(await apiClient.get(`${p.base}/${id}`)),

  create: async (body: CreateJob): Promise<JobDetail> => data(await apiClient.post(p.base, body)),

  update: async (
    id: string,
    body: Partial<Omit<CreateJob, "jobNo" | "customerId" | "stagePlan">> & { status?: JobStatus }
  ): Promise<JobDetail> => data(await apiClient.patch(`${p.base}/${id}`, body)),

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`${p.base}/${id}`);
  },

  addStage: async (id: string, body: { name: string }): Promise<JobDetail> =>
    data(await apiClient.post(`${p.base}/${id}/stages`, body)),

  updateStage: async (
    id: string,
    stageId: string,
    body: {
      status?: StageStatus;
      actualStart?: string | null;
      actualEnd?: string | null;
      plannedStart?: string | null;
      plannedEnd?: string | null;
    }
  ): Promise<JobDetail> => data(await apiClient.patch(`${p.base}/${id}/stages/${stageId}`, body)),

  reorderStages: async (id: string, stageIds: string[]): Promise<JobDetail> =>
    data(await apiClient.put(`${p.base}/${id}/stages/order`, { stageIds })),

  addCost: async (id: string, body: AddCost): Promise<JobDetail> =>
    data(await apiClient.post(`${p.base}/${id}/costs`, body)),

  postCosts: async (id: string): Promise<JobDetail> =>
    data(await apiClient.post(`${p.base}/${id}/costs/post`, {})),

  removeCost: async (id: string, costId: string): Promise<JobDetail> =>
    data(await apiClient.delete(`${p.base}/${id}/costs/${costId}`)),

  addBilling: async (id: string, body: AddBilling): Promise<JobDetail> =>
    data(await apiClient.post(`${p.base}/${id}/billings`, body)),

  /** Raw materials for the material-cost picker (uuid id, rate and unit). */
  rawMaterials: async (): Promise<RawMaterialOption[]> => {
    const res = await apiClient.get(config.rawMaterial.base, { params: { limit: 200 } });
    const payload = res.data?.data ?? res.data;
    const rows: Record<string, unknown>[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rawMaterials)
        ? payload.rawMaterials
        : [];
    return rows
      .filter((r) => typeof r.id === "string")
      .map((r) => ({
        id: r.id as string,
        code: String(r.rawMaterialId ?? ""),
        name: String(r.materialName ?? ""),
        rate: r.rate == null ? null : Number(r.rate),
        uom: String(r.baseUom ?? ""),
      }));
  },
};
