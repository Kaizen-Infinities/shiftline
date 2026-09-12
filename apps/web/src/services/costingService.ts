import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Valuation, cost centres, budgets and cost sheets (P1-19). */
export interface ValuationEntry {
  id: string;
  itemType: string;
  itemId: string;
  storeId: string | null;
  movedOn: string;
  kind: string;
  quantity: string;
  rate: string;
  value: string;
  balanceQuantity: string;
  balanceValue: string;
  avgRate: string;
  wentNegative: boolean;
  narration: string | null;
}

export interface ClosingStock {
  asOn: string;
  total: number;
  negatives: number;
  rows: {
    itemType: string;
    itemId: string;
    storeId: string | null;
    quantity: number;
    value: number;
    avgRate: number;
  }[];
}

export interface CostCentreRow {
  id: string;
  code: string;
  name: string;
  kind: "PRODUCTION" | "SERVICE" | "ADMIN" | "SALES";
  isActive: boolean;
}

export interface CostCentrePl {
  from: string;
  to: string;
  rows: {
    costCentreId: string | null;
    code: string;
    name: string;
    income: number;
    expense: number;
    result: number;
  }[];
  totals: { income: number; expense: number; result: number };
  allocatedCentres: number;
  unallocatedResult: number;
}

export interface VarianceReport {
  fyCode: string;
  periodKey: string | null;
  rows: {
    id: string;
    periodKey: string | null;
    ledgerCode: string;
    ledgerName: string;
    ledgerType: string;
    costCentre: string | null;
    budget: number;
    actual: number;
    variance: number;
    favourable: boolean;
    usedPercent: number | null;
  }[];
  totals: { budget: number; actual: number; adverse: number };
}

export interface CostSheetRow {
  id: string;
  productId: string;
  periodKey: string;
  product?: { productCode: string; productName: string };
  quantityProduced: string;
  materialCost: string;
  labourCost: string;
  overheadCost: string;
  scrapCredit: string;
  totalCost: string;
  perUnitCost: string;
  overheadBasis: string | null;
}

const p = API_PATHS.costing;

export const costingService = {
  ledger: async (q: { itemType?: string; itemId?: string } = {}): Promise<ValuationEntry[]> =>
    (await apiClient.get(`${p.valuation}/ledger`, { params: q })).data.data,
  closingStock: async (asOn?: string): Promise<ClosingStock> =>
    (await apiClient.get(`${p.valuation}/closing-stock`, { params: { asOn } })).data.data,
  postClosingStock: async (periodKey: string) =>
    (await apiClient.post(`${p.valuation}/${periodKey}/post-closing-stock`)).data.data as {
      posted: boolean;
      opening: number;
      closing: number;
      movement: number;
    },
  costCentres: async (all = false): Promise<CostCentreRow[]> =>
    (await apiClient.get(p.costCentres, { params: { all } })).data.data,
  saveCostCentre: async (body: {
    code: string;
    name: string;
    kind?: CostCentreRow["kind"];
  }): Promise<CostCentreRow> => (await apiClient.post(p.costCentres, body)).data.data,
  costCentrePl: async (from: string, to: string): Promise<CostCentrePl> =>
    (await apiClient.get(`${p.costCentres}/profit-loss`, { params: { from, to } })).data.data,
  variance: async (fyCode: string, periodKey?: string): Promise<VarianceReport> =>
    (await apiClient.get(`${p.budgets}/${fyCode}/variance`, { params: { periodKey } })).data.data,
  setBudget: async (body: {
    fyCode: string;
    periodKey?: string | null;
    ledgerId: number;
    costCentreId?: string | null;
    amount: number;
  }) => (await apiClient.post(p.budgets, body)).data.data,
  costSheets: async (periodKey?: string): Promise<CostSheetRow[]> =>
    (await apiClient.get(p.costSheets, { params: { periodKey } })).data.data,
};
