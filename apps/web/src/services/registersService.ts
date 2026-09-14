import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** The inspector's registers (P2-03): muster roll, wages, overtime, fines, deductions, advances. */
export interface MusterRollDay {
  date: string;
  code: string | null;
  otHours: number;
}

export interface MusterRollRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  designation: string;
  days: MusterRollDay[];
  totals: {
    present: number;
    absent: number;
    halfDay: number;
    leave: number;
    weekOff: number;
    otHours: number;
  };
}

export interface MusterRoll {
  month: string;
  totalDays: number;
  rows: MusterRollRow[];
}

export interface WagesRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  daysWorked: number;
  rate: number;
  basic: number;
  allowances: number;
  otWages: number;
  gross: number;
  pf: number;
  esi: number;
  professionalTax: number;
  tds: number;
  fines: number;
  advancesRecovered: number;
  others: number;
  totalDeductions: number;
  net: number;
  paymentMode: string;
  paymentDate: string | null;
}

export interface OvertimeRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  otHours: number;
  normalRate: number;
  otRate: number;
  otWages: number;
  cumulativeQuarterHours: number;
  quarterlyCap: number;
  overCap: boolean;
}

export interface FineDeductionRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  cause: string;
  amount: number;
  shownCauseGiven: boolean;
}

export interface CeilingCheck {
  employeeId: string;
  employeeCode: string;
  month: string;
  totalFines: number;
  wageCeiling: number | null;
  breach: boolean | null;
}

export interface AdvanceRow {
  id: number;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  amount: number;
  purpose: string;
  recoveredToDate: number;
  balance: number;
  status: string;
}

const p = API_PATHS.registers;

const downloadFile = async (
  url: string,
  params: Record<string, string | undefined>,
  fileName: string
) => {
  const res = await apiClient.get(url, {
    params: { ...params, format: params.format },
    responseType: "blob",
  });
  const contentType = params.format === "pdf" ? "application/pdf" : "text/csv";
  const href = URL.createObjectURL(new Blob([res.data], { type: contentType }));
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
};

export const registersService = {
  musterRoll: async (month: string, businessPlaceId?: string): Promise<MusterRoll> =>
    (await apiClient.get(p.musterRoll, { params: { month, businessPlaceId } })).data.data,
  wages: async (
    month: string,
    businessPlaceId?: string
  ): Promise<{ month: string; rows: WagesRow[] }> =>
    (await apiClient.get(p.wages, { params: { month, businessPlaceId } })).data.data,
  overtime: async (
    month: string,
    businessPlaceId?: string
  ): Promise<{ month: string; rows: OvertimeRow[] }> =>
    (await apiClient.get(p.overtime, { params: { month, businessPlaceId } })).data.data,
  fines: async (
    from: string,
    to: string,
    businessPlaceId?: string
  ): Promise<{ rows: FineDeductionRow[]; total: number; ceilingChecks: CeilingCheck[] }> =>
    (await apiClient.get(p.fines, { params: { from, to, businessPlaceId } })).data.data,
  deductions: async (
    from: string,
    to: string,
    businessPlaceId?: string
  ): Promise<{ rows: FineDeductionRow[]; total: number }> =>
    (await apiClient.get(p.deductions, { params: { from, to, businessPlaceId } })).data.data,
  advances: async (
    from: string,
    to: string,
    businessPlaceId?: string
  ): Promise<{ rows: AdvanceRow[]; total: number }> =>
    (await apiClient.get(p.advances, { params: { from, to, businessPlaceId } })).data.data,

  exportCsv: (
    register: "muster-roll" | "wages" | "overtime" | "fines" | "deductions" | "advances",
    params: Record<string, string | undefined>
  ) => downloadFile((p as any)[camel(register)], { ...params, format: "csv" }, `${register}.csv`),
  exportPdf: (
    register: "muster-roll" | "wages" | "overtime" | "fines" | "deductions" | "advances",
    params: Record<string, string | undefined>
  ) => downloadFile((p as any)[camel(register)], { ...params, format: "pdf" }, `${register}.pdf`),
};

function camel(register: string): keyof typeof p {
  return register.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) as keyof typeof p;
}
