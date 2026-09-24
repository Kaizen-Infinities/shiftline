import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Customer (OEM) delivery schedules, the due list and schedule adherence (TN-02). */
export type ScheduleStatus = "OPEN" | "CLOSED" | "CANCELLED";
export type Firmness = "FIRM" | "TENTATIVE";
export type LineStatus = "PENDING" | "MET" | "LATE" | "SHORT" | "EXCESS";

export interface ScheduleRow {
  id: string;
  scheduleNo: string;
  revision: number;
  customerId: string;
  customerName: string;
  customerPoNo: string | null;
  periodMonth: string;
  receivedOn: string;
  status: ScheduleStatus;
  lineCount: number;
  adherencePct: number | null;
  otifPct: number | null;
}

export interface ScheduleLine {
  id: string;
  customerPartNo: string;
  description: string | null;
  dueDate: string;
  firmness: Firmness;
  scheduledQty: number;
  dispatches: { id: string; dispatchDate: string; qty: number; invoiceNo: string | null }[];
  metrics: {
    dispatched: number;
    onTime: number;
    late: number;
    short: number;
    remaining: number;
    status: LineStatus;
  };
}

export interface ScheduleDetail extends Omit<
  ScheduleRow,
  "lineCount" | "adherencePct" | "otifPct"
> {
  notes: string | null;
  lines: ScheduleLine[];
  totals: { adherencePct: number | null; otifPct: number | null };
}

export interface DueRow {
  lineId: string;
  scheduleId: string;
  scheduleNo: string;
  customerName: string;
  customerPartNo: string;
  description: string | null;
  dueDate: string;
  scheduledQty: number;
  dispatchedQty: number;
  remainingQty: number;
  overdue: boolean;
}

export interface AdherenceRow {
  customerId: string;
  customerName: string;
  month: string;
  firmLines: number;
  dueLines: number;
  metLines: number;
  scheduled: number;
  onTime: number;
  late: number;
  short: number;
  adherencePct: number | null;
  otifPct: number | null;
}

export interface NewLine {
  customerPartNo: string;
  dueDate: string;
  scheduledQty: number;
  firmness?: Firmness;
}

const p = API_PATHS.deliverySchedules;

export const deliveryScheduleService = {
  list: async (filters: { customerId?: string; month?: string; status?: ScheduleStatus }) =>
    (await apiClient.get(p.base, { params: filters })).data.data as ScheduleRow[],

  get: async (id: string) => (await apiClient.get(`${p.base}/${id}`)).data.data as ScheduleDetail,

  create: async (body: {
    scheduleNo: string;
    customerId: string;
    customerPoNo?: string;
    periodMonth: string;
    receivedOn: string;
    lines: NewLine[];
  }) => (await apiClient.post(p.base, body)).data.data as ScheduleDetail,

  setStatus: async (id: string, status: ScheduleStatus) =>
    (await apiClient.patch(`${p.base}/${id}`, { status })).data.data as ScheduleDetail,

  addDispatch: async (
    lineId: string,
    body: { dispatchDate: string; qty: number; invoiceNo?: string }
  ) => (await apiClient.post(`${p.lines}/${lineId}/dispatches`, body)).data.data,

  due: async (days = 7) => (await apiClient.get(p.due, { params: { days } })).data.data as DueRow[],

  adherence: async (from: string, to: string) =>
    (await apiClient.get(p.adherence, { params: { from, to } })).data.data as AdherenceRow[],
};

/**
 * Parses rows pasted from Excel in the column order `partNo \t dueDate \t qty \t F/T`. Dates may
 * be 2026-10-05 or 05/10/2026 (day first). Returns the lines and the 1-based rows it skipped.
 */
export const parseSchedulePaste = (text: string): { lines: NewLine[]; skipped: number[] } => {
  const lines: NewLine[] = [];
  const skipped: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const [part, date, qty, firm] = raw.split("\t").map((c) => c.trim());
    const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(date ?? "");
    const dueDate = dmy
      ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
      : (date ?? "");
    const n = Number((qty ?? "").replace(/,/g, ""));
    if (!part || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !(n > 0)) {
      skipped.push(i + 1);
      return;
    }
    lines.push({
      customerPartNo: part.slice(0, 40),
      dueDate,
      scheduledQty: n,
      firmness: (firm ?? "F").toUpperCase().startsWith("T") ? "TENTATIVE" : "FIRM",
    });
  });
  return { lines, skipped };
};
