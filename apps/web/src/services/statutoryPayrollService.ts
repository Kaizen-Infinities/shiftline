import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** The statutory half of payroll (P1-16). */
export interface StatutoryRuleRow {
  id: string;
  stateCode: string;
  stateName: string;
  ptSlabs: { upTo: number; amount: number; month?: number }[];
  ptEnabled: boolean;
  lwfEmployee: string;
  lwfEmployer: string;
  lwfFrequency: string;
  lwfMonths: number[];
  isActive: boolean;
}

export interface StatutorySummary {
  payrollRunId: number;
  periodKey: string | null;
  employees: number;
  gross: number;
  net: number;
  pf: {
    employee: number;
    vpf: number;
    pension: number;
    employer: number;
    edli: number;
    admin: number;
  };
  esi: { employee: number; employer: number };
  professionalTax: number;
  lwf: { employee: number; employer: number };
  incomeTax: number;
  wageCheckFailures: number;
}

export interface PtSummary {
  total: number;
  rows: { stateCode: string; stateName: string; employees: number; amount: number }[];
}

export interface PayrollRunRow {
  id: number;
  runCode: string;
  period: string;
  status: string;
  totalEmployees: number;
  totalGross: string;
  totalNetSalary: string;
}

const p = API_PATHS.payrollStatutory;

/** Streams a portal file through the signed-in session and hands it to the browser. */
const download = async (url: string, fileName: string) => {
  const res = await apiClient.get(url, { responseType: "blob" });
  const href = URL.createObjectURL(new Blob([res.data], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
};

export const statutoryPayrollService = {
  rules: async (all = false): Promise<StatutoryRuleRow[]> =>
    (await apiClient.get(p.rules, { params: { all } })).data.data,
  compute: async (runId: number) =>
    (await apiClient.post(`${p.runs}/${runId}/compute`)).data.data as {
      employees: number;
      wageCheckFailures: { employeeCode: string; sharePercent: number }[];
    },
  summary: async (runId: number): Promise<StatutorySummary> =>
    (await apiClient.get(`${p.runs}/${runId}/summary`)).data.data,
  ptSummary: async (runId: number): Promise<PtSummary> =>
    (await apiClient.get(`${p.runs}/${runId}/pt-summary`)).data.data,
  downloadEcr: (runId: number) => download(`${p.runs}/${runId}/ecr`, `ECR-${runId}.txt`),
  downloadEsic: (runId: number) => download(`${p.runs}/${runId}/esic`, `ESIC-${runId}.csv`),
  downloadBankFile: (runId: number) =>
    download(`${p.runs}/${runId}/bank-transfer`, `SALARY-${runId}.csv`),
  postJournal: async (runId: number) =>
    (await apiClient.post(`${p.runs}/${runId}/post-journal`)).data.data as {
      posted: boolean;
      voucherId: number;
      netPayable?: number;
    },
  registerFilings: async (runId: number) =>
    (await apiClient.post(`${p.runs}/${runId}/register-filings`)).data.data as {
      registered: number;
    },
  runs: async (): Promise<PayrollRunRow[]> => {
    // The payroll list is paged: { runs, total, page, limit }.
    const body = (await apiClient.get("/payroll/runs", { params: { limit: 100 } })).data.data as
      PayrollRunRow[] | { runs?: PayrollRunRow[] };
    return Array.isArray(body) ? body : (body?.runs ?? []);
  },
};
