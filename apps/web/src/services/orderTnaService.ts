import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Export order time-and-action calendar (TN-03). */
export type Rag = "RED" | "AMBER" | "GREEN";
export type OrderTnaStatus = "ACTIVE" | "SHIPPED" | "CANCELLED";
export type MilestoneStatus = "PENDING" | "DONE" | "SKIPPED";

export interface TnaTemplate {
  key: string;
  name: string;
  steps: { name: string; offsetDays: number }[];
}

export interface OrderTnaRow {
  id: string;
  tnaNo: string;
  customerId: string;
  customerName: string | null;
  buyerPoNo: string;
  styleRef: string;
  description: string | null;
  orderQty: number;
  uom: string | null;
  orderDate: string;
  exFactoryDate: string;
  template: string;
  merchandiser: string | null;
  status: OrderTnaStatus;
  rag: Rag;
  nextMilestone: { name: string; plannedDate: string } | null;
  overdueCount: number;
}

export interface TnaMilestone {
  id: string;
  seq: number;
  name: string;
  plannedDate: string;
  actualDate: string | null;
  status: MilestoneStatus;
  owner: string | null;
  remarks: string | null;
  delayDays: number | null;
}

export interface OrderTnaDetail extends OrderTnaRow {
  milestones: TnaMilestone[];
}

export interface TnaAlert {
  tnaId: string;
  tnaNo: string;
  buyerPoNo: string;
  styleRef: string;
  customerName: string | null;
  exFactoryDate: string;
  milestoneId: string;
  milestone: string;
  plannedDate: string;
  kind: "OVERDUE" | "DUE_SOON";
  daysLate: number;
}

export interface CreateOrderTna {
  tnaNo?: string;
  customerId: string;
  buyerPoNo: string;
  styleRef: string;
  orderQty: number;
  uom?: string;
  orderDate: string;
  exFactoryDate: string;
  template: string;
  merchandiser?: string;
}

const p = API_PATHS.orderTna;

export const orderTnaService = {
  templates: async (): Promise<TnaTemplate[]> => (await apiClient.get(p.templates)).data.data,

  list: async (filters: {
    status?: OrderTnaStatus;
    customerId?: string;
    from?: string;
    to?: string;
  }): Promise<OrderTnaRow[]> => (await apiClient.get(p.base, { params: filters })).data.data,

  get: async (id: string): Promise<OrderTnaDetail> =>
    (await apiClient.get(`${p.base}/${id}`)).data.data,

  create: async (body: CreateOrderTna): Promise<OrderTnaDetail> =>
    (await apiClient.post(p.base, body)).data.data,

  update: async (
    id: string,
    body: { exFactoryDate?: string; status?: OrderTnaStatus; merchandiser?: string | null }
  ): Promise<OrderTnaDetail> => (await apiClient.patch(`${p.base}/${id}`, body)).data.data,

  updateMilestone: async (
    id: string,
    milestoneId: string,
    body: {
      status?: MilestoneStatus;
      actualDate?: string | null;
      owner?: string | null;
      remarks?: string | null;
    }
  ): Promise<OrderTnaDetail> =>
    (await apiClient.patch(`${p.base}/${id}/milestones/${milestoneId}`, body)).data.data,

  alerts: async (days = 3): Promise<TnaAlert[]> =>
    (await apiClient.get(p.alerts, { params: { days } })).data.data,
};
