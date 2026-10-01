import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Multi-step process routes and the lot board (TN-06). */
export type StepMode = "IN_HOUSE" | "JOB_WORK";
export type LotStatus = "OPEN" | "COMPLETED" | "CANCELLED";
export type Direction = "OUT" | "IN";
export type StepState = "NOT_STARTED" | "IN_PROCESS" | "DONE";
export type LocationKind = "JOB_WORKER" | "IN_HOUSE" | "IN_HAND" | "FINISHED";

export interface WorkerRef {
  id: string;
  code?: string;
  name: string;
}

export interface ProductRef {
  id: string;
  code: string;
  name: string;
}

export interface RouteStep {
  id: string;
  seq: number;
  name: string;
  mode: StepMode;
  defaultJobWorker: WorkerRef | null;
  lossNormPct: number;
  uomIn: string;
  uomOut: string;
  conversionFactor: number | null;
  remarks: string | null;
}

export interface ProcessRoute {
  id: string;
  routeCode: string;
  name: string;
  description: string | null;
  product: ProductRef | null;
  active: boolean;
  lotCount: number;
  locked: boolean;
  steps: RouteStep[];
}

export interface StepInput {
  name: string;
  mode: StepMode;
  defaultJobWorkerId?: string | null;
  lossNormPct: number;
  uomIn: string;
  uomOut: string;
  conversionFactor?: number | null;
}

export interface RouteTemplate {
  key: string;
  name: string;
  steps: {
    name: string;
    mode: StepMode;
    uomIn: string;
    uomOut: string;
    conversionFactor: number | null;
    lossNormPct: number;
  }[];
}

export interface RouteOptions {
  jobWorkers: (WorkerRef & { processType: string | null })[];
  products: ProductRef[];
  stepNames: string[];
  templates: RouteTemplate[];
  gainTolerancePct: number;
}

export interface Holder {
  jobWorkerId: string | null;
  jobWorkerName: string | null;
  sent: number;
  received: number;
  wip: number | null;
}

export interface StepProgress {
  id: string | null;
  seq: number;
  name: string;
  mode: StepMode;
  uomIn: string;
  uomOut: string;
  factor: number | null;
  lossNormPct: number;
  state: StepState;
  sent: number;
  received: number;
  expectedOut: number | null;
  lossQty: number | null;
  lossPct: number | null;
  overNorm: boolean;
  yieldPct: number | null;
  availableToSend: number;
  firstOutDate: string | null;
  firstInDate: string | null;
  defaultJobWorkerId: string | null;
  holders: Holder[];
}

export interface LotLocation {
  kind: LocationKind;
  stepSeq: number;
  stepName: string;
  jobWorkerId: string | null;
  jobWorkerName: string | null;
  qty: number | null;
  uom: string;
}

export interface LotCard {
  id: string;
  lotNo: string;
  route: { id: string; routeCode: string; name: string };
  product: ProductRef | null;
  inputQty: number;
  inputUom: string;
  startDate: string;
  status: LotStatus;
  remarks: string | null;
  closedAt: string | null;
  cancelReason: string | null;
  currentStepSeq: number;
  finalOutput: number;
  finalUom: string;
  cumulativeYieldPct: number | null;
  normYieldPct: number | null;
  overNormSteps: number;
  closeBlockers: string[];
  steps: StepProgress[];
  locations: LotLocation[];
}

export interface LotMovement {
  id: string;
  stepSeq: number;
  stepName: string | null;
  direction: Direction;
  qty: number;
  uom: string;
  movementDate: string;
  jobWorker: WorkerRef | null;
  challan: { id: string; challanNo: string; kind: string } | null;
  closesStep: boolean;
  remarks: string | null;
  createdAt: string;
  undoable: boolean;
}

export interface LotDetail extends LotCard {
  movements: LotMovement[];
}

export interface LotBoard {
  summary: {
    open: number;
    completed: number;
    cancelled: number;
    overNormLots: number;
    atJobWorkers: {
      jobWorkerId: string;
      name: string | null;
      lots: number;
      qty: { uom: string; qty: number }[];
    }[];
  };
  lots: LotCard[];
}

export interface ChallanOption {
  id: string;
  challanNo: string;
  challanDate: string;
  kind: "JOB_WORK_OUT" | "JOB_WORK_RETURN";
  status: string;
  jobWorker: { id: string; name: string } | null;
  qty: number;
  uom: string;
}

export interface MovementInput {
  stepSeq: number;
  direction: Direction;
  qty: number;
  movementDate: string;
  jobWorkerId?: string;
  challanId?: string;
  closesStep?: boolean;
  remarks?: string;
}

const r = API_PATHS.processRoutes;
const l = API_PATHS.processLots;
const data = <T>(res: { data: { data: T } }): T => res.data.data;

export const processRoutesService = {
  options: async (): Promise<RouteOptions> => data(await apiClient.get(r.options)),
  listRoutes: async (): Promise<ProcessRoute[]> => data(await apiClient.get(r.base)),
  createRoute: async (body: {
    routeCode: string;
    name: string;
    description?: string;
    productId?: string;
    steps: StepInput[];
  }): Promise<ProcessRoute> => data(await apiClient.post(r.base, body)),
  updateRoute: async (
    id: string,
    body: {
      name?: string;
      description?: string | null;
      productId?: string | null;
      active?: boolean;
    }
  ): Promise<ProcessRoute> => data(await apiClient.patch(`${r.base}/${id}`, body)),
  replaceSteps: async (id: string, steps: StepInput[]): Promise<ProcessRoute> =>
    data(await apiClient.put(`${r.base}/${id}/steps`, { steps })),
  removeRoute: async (id: string): Promise<void> => {
    await apiClient.delete(`${r.base}/${id}`);
  },

  board: async (): Promise<LotBoard> => data(await apiClient.get(l.board)),
  listLots: async (status?: LotStatus): Promise<LotCard[]> =>
    data(await apiClient.get(l.base, { params: status ? { status } : {} })),
  getLot: async (id: string): Promise<LotDetail> => data(await apiClient.get(`${l.base}/${id}`)),
  createLot: async (body: {
    lotNo: string;
    routeId: string;
    productId?: string;
    inputQty: number;
    startDate: string;
    remarks?: string;
  }): Promise<LotDetail> => data(await apiClient.post(l.base, body)),
  addMovement: async (id: string, body: MovementInput): Promise<LotDetail> =>
    data(await apiClient.post(`${l.base}/${id}/movements`, body)),
  undoMovement: async (id: string, movementId: string): Promise<LotDetail> =>
    data(await apiClient.delete(`${l.base}/${id}/movements/${movementId}`)),
  closeLot: async (id: string): Promise<LotDetail> =>
    data(await apiClient.post(`${l.base}/${id}/close`, {})),
  cancelLot: async (id: string, reason: string): Promise<LotDetail> =>
    data(await apiClient.post(`${l.base}/${id}/cancel`, { reason })),
  challans: async (params: {
    jobWorkerId?: string;
    kind?: "JOB_WORK_OUT" | "JOB_WORK_RETURN";
  }): Promise<ChallanOption[]> => data(await apiClient.get(l.challans, { params })),
};
