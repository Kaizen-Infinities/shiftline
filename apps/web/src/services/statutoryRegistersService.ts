import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** The inspector's registers (P2T-03): muster roll, wages, overtime, deductions, fines, advances. */
export interface MusterRollDay {
  date: string;
  status: string | null;
  otHours: number;
  lateMinutes: number;
  permissionMinutes: number;
}
export interface MusterRollEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  days: MusterRollDay[];
  totals: Record<string, number>;
}
export interface MusterRoll {
  period: string;
  days: number;
  employees: MusterRollEmployee[];
}

export interface WagesRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  daysPaid: number;
  grossWages: number;
  totalDeductions: number;
  netWages: number;
  paymentMode: string;
}
export interface WagesRegister {
  runId: number;
  runCode: string;
  period: string;
  type: string;
  employees: WagesRow[];
}

export interface OvertimeRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  days: { date: string; otHours: number }[];
  totalOtHours: number;
  otWagesPaid: number;
}
export interface OvertimeRegister {
  runId: number;
  runCode: string;
  period: string;
  employees: OvertimeRow[];
}

export interface DeductionsRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  providentFund: number;
  esi: number;
  professionalTax: number;
  lateEntry: number;
  permission: number;
  salaryAdvance: number;
  loanRecovery: number;
  other: { type: string; label: string; amount: number }[];
  total: number;
}
export interface DeductionsRegister {
  runId: number;
  runCode: string;
  period: string;
  employees: DeductionsRow[];
}

export interface FineRow {
  employeeCode: string;
  employeeName: string;
  label: string;
  amount: number;
  isActive: boolean;
  recordedAt: string;
}
export interface AdvanceRow {
  employeeCode: string;
  employeeName: string;
  disbursedDate: string;
  amount: number;
  recovered: number;
  outstanding: number;
  status: string;
}

const p = API_PATHS.statutoryRegisters;

export const statutoryRegistersService = {
  musterRoll: async (period: string): Promise<MusterRoll> =>
    (await apiClient.get(p.musterRoll, { params: { period } })).data.data,
  wages: async (runId: number): Promise<WagesRegister> =>
    (await apiClient.get(p.wages, { params: { runId } })).data.data,
  overtime: async (runId: number): Promise<OvertimeRegister> =>
    (await apiClient.get(p.overtime, { params: { runId } })).data.data,
  deductions: async (runId: number): Promise<DeductionsRegister> =>
    (await apiClient.get(p.deductions, { params: { runId } })).data.data,
  fines: async (from: string, to: string): Promise<{ from: string; to: string; rows: FineRow[] }> =>
    (await apiClient.get(p.fines, { params: { from, to } })).data.data,
  advances: async (
    from: string,
    to: string
  ): Promise<{ from: string; to: string; rows: AdvanceRow[] }> =>
    (await apiClient.get(p.advances, { params: { from, to } })).data.data,
};
