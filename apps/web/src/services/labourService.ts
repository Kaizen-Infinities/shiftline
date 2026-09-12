import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Leave, gratuity, bonus and settlements (P1-17b). */
export interface HolidayRow {
  id: string;
  holidayOn: string;
  name: string;
  kind: string;
  stateCode: string | null;
  isPaid: boolean;
}

export interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  daysPerYear: string;
  basis: "ANNUAL" | "MONTHLY" | "DAYS_WORKED";
  daysWorkedPerDay: number;
  carryForwardMax: string;
  encashable: boolean;
  isActive: boolean;
}

export interface LeaveBalanceRow {
  id: string;
  employeeId: string;
  fyCode: string;
  opening: string;
  accrued: string;
  taken: string;
  encashed: string;
  lapsed: string;
  closing: string;
  leaveType: { code: string; name: string; encashable: boolean };
}

export interface GratuityReport {
  asOn: string;
  employees: number;
  eligible: number;
  total: number;
  rows: {
    employeeCode: string;
    employeeName: string;
    joinedOn: string | null;
    lastDrawnWage: number;
    serviceYears: number;
    countedYears: number;
    eligible: boolean;
    amount: number;
    cappedAtCeiling: boolean;
  }[];
}

export interface BonusReport {
  fyCode: string;
  percent: number;
  eligible: number;
  total: number;
  rows: {
    employeeCode: string;
    employeeName: string;
    monthlyWage: number;
    calculationWage: number;
    percent: number;
    amount: number;
  }[];
}

export interface SettlementRow {
  id: string;
  employeeCode: string;
  separationOn: string;
  lastWorkingDay: string;
  salaryDue: string;
  leaveEncashment: string;
  gratuity: string;
  bonus: string;
  noticeRecovery: string;
  advanceRecovery: string;
  netPayable: string;
  status: "DRAFT" | "APPROVED" | "PAID" | "CANCELLED";
  voucherId: number | null;
}

const p = API_PATHS.labour;

export const labourService = {
  holidays: async (fyCode?: string): Promise<HolidayRow[]> =>
    (await apiClient.get(p.holidays, { params: { fyCode } })).data.data,
  addHoliday: async (body: { holidayOn: string; name: string; kind?: string }) =>
    (await apiClient.post(p.holidays, body)).data.data,
  leaveTypes: async (all = false): Promise<LeaveTypeRow[]> =>
    (await apiClient.get(p.leaveTypes, { params: { all } })).data.data,
  balances: async (fyCode: string, employeeId?: string): Promise<LeaveBalanceRow[]> =>
    (await apiClient.get(`${p.leaveBalances}/${fyCode}`, { params: { employeeId } })).data.data,
  closeLeaveYear: async (fyCode: string) =>
    (await apiClient.post(`${p.leaveBalances}/${fyCode}/close`)).data.data as {
      balances: number;
      lapsedDays: number;
    },
  gratuity: async (asOn?: string): Promise<GratuityReport> =>
    (await apiClient.get(p.gratuity, { params: { asOn } })).data.data,
  bonus: async (fyCode: string, percent?: number): Promise<BonusReport> =>
    (await apiClient.get(`${p.bonus}/${fyCode}`, { params: { percent } })).data.data,
  settlements: async (status?: string): Promise<SettlementRow[]> =>
    (await apiClient.get(p.settlements, { params: { status } })).data.data,
  approveSettlement: async (id: string): Promise<SettlementRow> =>
    (await apiClient.post(`${p.settlements}/${id}/approve`)).data.data,
};
