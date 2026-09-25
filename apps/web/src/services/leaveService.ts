import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Leave requests: approval, the calendar, and self-service on top of the leave ledger (P2-09). */
export type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveRequestRow {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  fyCode: string;
  fromDate: string;
  toDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  days: string;
  reason: string | null;
  status: LeaveRequestStatus;
  approverId: string | null;
  decidedAt: string | null;
  comments: string | null;
  createdAt: string;
  leaveType: { code: string; name: string };
  employee: { empCode: string; fullName: string };
}

export interface CalendarRow {
  requestId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  leaveTypeCode: string | null;
  fromDate: string;
  toDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  days: number;
}

export interface CalendarReport {
  month: string;
  from: string;
  to: string;
  count: number;
  rows: CalendarRow[];
}

export interface MyLeaveBalance {
  id: string;
  fyCode: string;
  opening: string;
  accrued: string;
  taken: string;
  encashed: string;
  closing: string;
  leaveType: { code: string; name: string; encashable: boolean };
}

export interface MyLeave {
  linked: boolean;
  employee?: { id: string; empCode: string; fullName: string };
  balances: MyLeaveBalance[];
  requests: LeaveRequestRow[];
}

const p = API_PATHS.leave;

export const leaveService = {
  listRequests: async (filters: {
    employeeId?: string;
    status?: LeaveRequestStatus;
    fyCode?: string;
  }): Promise<LeaveRequestRow[]> =>
    (await apiClient.get(p.requests, { params: filters })).data.data,

  createRequest: async (body: {
    employeeId: string;
    leaveTypeCode: string;
    fromDate: string;
    toDate: string;
    halfDayStart?: boolean;
    halfDayEnd?: boolean;
    reason?: string;
  }): Promise<LeaveRequestRow> => (await apiClient.post(p.requests, body)).data.data,

  approve: async (id: string, comments?: string): Promise<LeaveRequestRow> =>
    (await apiClient.post(`${p.requests}/${id}/approve`, { comments })).data.data,

  reject: async (id: string, comments?: string): Promise<LeaveRequestRow> =>
    (await apiClient.post(`${p.requests}/${id}/reject`, { comments })).data.data,

  cancel: async (id: string, comments?: string): Promise<LeaveRequestRow> =>
    (await apiClient.post(`${p.requests}/${id}/cancel`, { comments })).data.data,

  calendar: async (month: string, departmentId?: number): Promise<CalendarReport> =>
    (await apiClient.get(p.calendar, { params: { month, departmentId } })).data.data,

  me: async (): Promise<MyLeave> => (await apiClient.get(p.me)).data.data,
};
