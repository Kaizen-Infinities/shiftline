import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Fixed assets and depreciation (P1-18). */
export type DepreciationMethod = "SLM" | "WDV";
export type AssetStatus = "ACTIVE" | "DISPOSED" | "WRITTEN_OFF";

export interface AssetClassRow {
  id: string;
  code: string;
  name: string;
  usefulLifeYears: number;
  method: DepreciationMethod;
  residualPercent: string;
  scheduleIiHead: string | null;
  itBlockName: string | null;
  itBlockRate: string;
  isActive: boolean;
}

export interface AssetRow {
  id: string;
  code: string;
  name: string;
  assetClass: { code: string; name: string; scheduleIiHead: string | null };
  capitalisedOn: string;
  cost: string;
  residualValue: string;
  accumulatedDepreciation: string;
  wdv: number;
  method: DepreciationMethod;
  status: AssetStatus;
  location: string | null;
  disposedOn: string | null;
}

export interface DepreciationPreview {
  periodKey: string;
  from: string;
  to: string;
  total: number;
  lines: {
    assetId: string;
    code: string;
    name: string;
    className: string;
    daysInUse: number;
    openingWdv: number;
    amount: number;
    closingWdv: number;
  }[];
}

export interface DepreciationRunRow {
  id: string;
  periodKey: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  totalAmount: string;
  assetCount: number;
  voucherId: number | null;
  postedAt: string | null;
}

export interface AssetRegister {
  fyCode: string;
  fyStart: string;
  fyEnd: string;
  rows: {
    classCode: string;
    className: string;
    scheduleIiHead: string | null;
    openingCost: number;
    additions: number;
    disposalsCost: number;
    closingCost: number;
    openingDep: number;
    chargeForYear: number;
    closingDep: number;
    closingWdv: number;
  }[];
  totals: {
    openingCost: number;
    additions: number;
    disposalsCost: number;
    closingCost: number;
    chargeForYear: number;
    closingDep: number;
    closingWdv: number;
  };
}

export interface ItBlocks {
  fyCode: string;
  total: number;
  note: string;
  rows: {
    block: string;
    rate: number;
    openingWdv: number;
    additionsFullRate: number;
    additionsHalfRate: number;
    deletions: number;
    depreciation: number;
    closingWdv: number;
  }[];
}

const p = API_PATHS.assets;

export const assetService = {
  classes: async (all = false): Promise<AssetClassRow[]> =>
    (await apiClient.get(p.classes, { params: { all } })).data.data,
  list: async (q: { status?: AssetStatus } = {}): Promise<AssetRow[]> =>
    (await apiClient.get(p.base, { params: q })).data.data,
  create: async (body: {
    code: string;
    name: string;
    classCode: string;
    cost: number;
    acquiredOn: string;
    capitalisedOn?: string;
    location?: string | null;
    serialNo?: string | null;
  }): Promise<AssetRow> => (await apiClient.post(p.base, body)).data.data,
  dispose: async (
    id: string,
    body: { disposedOn: string; proceeds?: number; moneyLedgerCode?: string }
  ) => (await apiClient.post(`${p.base}/${id}/dispose`, body)).data.data,
  preview: async (periodKey: string): Promise<DepreciationPreview> =>
    (await apiClient.get(`${p.depreciation}/preview/${periodKey}`)).data.data,
  runs: async (): Promise<DepreciationRunRow[]> =>
    (await apiClient.get(`${p.depreciation}/runs`)).data.data,
  prepare: async (periodKey: string): Promise<DepreciationRunRow> =>
    (await apiClient.post(`${p.depreciation}/${periodKey}/prepare`)).data.data,
  post: async (id: string): Promise<DepreciationRunRow> =>
    (await apiClient.post(`${p.depreciation}/runs/${id}/post`)).data.data,
  register: async (fyCode: string): Promise<AssetRegister> =>
    (await apiClient.get(`${p.register}/${fyCode}`)).data.data,
  itBlocks: async (fyCode: string): Promise<ItBlocks> =>
    (await apiClient.get(`${p.itBlocks}/${fyCode}`)).data.data,
};
