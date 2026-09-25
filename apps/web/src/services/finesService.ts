import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Fines (Payment of Wages Act s.8) and deductions for damage/loss (s.10) — entry, the
 *  employee's show-cause, approval, cancellation and the recovery status a payroll run leaves
 *  behind (P2-13). */
export type FineKind = "FINE" | "DEDUCTION";
export type FineStatus = "PENDING" | "APPROVED" | "CANCELLED";

export interface FineRow {
  id: string;
  employeeId: string;
  employee: { empCode: string; fullName: string };
  kind: FineKind;
  occurredOn: string;
  cause: string;
  amount: string;
  status: FineStatus;
  wagePeriod: string;
  shownCauseGiven: boolean;
  showCauseDate: string | null;
  showCauseRemarks: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  recoveredInPayrollResultId: number | null;
  recoveredAt: string | null;
  recovered: boolean;
}

const p = API_PATHS.fines;

export const finesService = {
  list: async (filters: {
    employeeId?: string;
    kind?: FineKind;
    status?: FineStatus;
    wagePeriod?: string;
    from?: string;
    to?: string;
  }): Promise<FineRow[]> => (await apiClient.get(p.base, { params: filters })).data.data,

  create: async (body: {
    employeeId: string;
    kind: FineKind;
    occurredOn: string;
    cause: string;
    amount: number;
    wagePeriod: string;
  }): Promise<FineRow> => (await apiClient.post(p.base, body)).data.data,

  /** Edits a still-PENDING item (P2-15) — refused once a show-cause is recorded or it is
   *  approved. */
  update: async (
    id: string,
    body: Partial<{
      occurredOn: string;
      cause: string;
      amount: number;
      wagePeriod: string;
    }>
  ): Promise<FineRow> => (await apiClient.patch(`${p.base}/${id}`, body)).data.data,

  showCause: async (
    id: string,
    body: { showCauseDate: string; showCauseRemarks: string }
  ): Promise<FineRow> => (await apiClient.post(`${p.base}/${id}/show-cause`, body)).data.data,

  approve: async (id: string): Promise<FineRow> =>
    (await apiClient.post(`${p.base}/${id}/approve`)).data.data,

  cancel: async (id: string, reason: string): Promise<FineRow> =>
    (await apiClient.post(`${p.base}/${id}/cancel`, { reason })).data.data,
};
