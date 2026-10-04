import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** A screen's opening request gives up after this long and shows its error state. */
const LOAD_TIMEOUT_MS = 30_000;

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
  status: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
  totalAmount: string;
  assetCount: number;
  voucherId: number | null;
  postedAt: string | null;
  reversedAt?: string | null;
}

export interface DepreciationRunDetail extends DepreciationRunRow {
  lines: {
    assetId: string;
    code: string;
    name: string;
    amount: number;
    accumulatedDepreciationBefore: number;
    accumulatedDepreciationAfter: number;
  }[];
}

export interface OpeningRowFields {
  classCode: string;
  code: string;
  name: string;
  businessPlaceCode?: string;
  capitalisedOn: string;
  cost: number | string;
  accumulatedDepreciation: number | string;
  method?: DepreciationMethod;
  remainingLifeMonths?: number | string;
  wdvRatePercent?: number | string;
  itBlockName?: string;
  quantity?: number | string;
  serialNo?: string;
  location?: string;
  residualValue?: number | string;
}

export interface OpeningImportResult {
  imported: number;
  vouchers: number;
  assets: { id: string; code: string; name: string }[];
}

export interface OpeningRowError {
  row: number;
  message: string;
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
    (await apiClient.get(p.classes, { params: { all }, timeout: LOAD_TIMEOUT_MS })).data.data,
  list: async (q: { status?: AssetStatus } = {}): Promise<AssetRow[]> =>
    (await apiClient.get(p.base, { params: q, timeout: LOAD_TIMEOUT_MS })).data.data,
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
    (await apiClient.get(`${p.depreciation}/preview/${periodKey}`, { timeout: LOAD_TIMEOUT_MS }))
      .data.data,
  runs: async (): Promise<DepreciationRunRow[]> =>
    (await apiClient.get(`${p.depreciation}/runs`, { timeout: LOAD_TIMEOUT_MS })).data.data,
  prepare: async (periodKey: string): Promise<DepreciationRunRow> =>
    (await apiClient.post(`${p.depreciation}/${periodKey}/prepare`)).data.data,
  post: async (id: string): Promise<DepreciationRunRow> =>
    (await apiClient.post(`${p.depreciation}/runs/${id}/post`)).data.data,
  register: async (fyCode: string): Promise<AssetRegister> =>
    (await apiClient.get(`${p.register}/${fyCode}`, { timeout: LOAD_TIMEOUT_MS })).data.data,
  itBlocks: async (fyCode: string): Promise<ItBlocks> =>
    (await apiClient.get(`${p.itBlocks}/${fyCode}`, { timeout: LOAD_TIMEOUT_MS })).data.data,
  upsertClass: async (body: {
    id?: string;
    code: string;
    name: string;
    usefulLifeYears: number;
    method?: DepreciationMethod;
    residualPercent?: number;
    scheduleIiHead?: string | null;
    itBlockName?: string | null;
    itBlockRate?: number;
    isActive?: boolean;
  }): Promise<AssetClassRow> => (await apiClient.post(p.classes, body)).data.data,
  reverseRun: async (id: string): Promise<DepreciationRunRow> =>
    (await apiClient.post(`${p.depreciationRuns}/${id}/reverse`)).data.data,
  runDetail: async (id: string): Promise<DepreciationRunDetail> =>
    (await apiClient.get(`${p.depreciationRuns}/${id}`)).data.data,
  createOpening: async (row: OpeningRowFields) =>
    (await apiClient.post(p.opening, row)).data.data as { id: string; code: string; name: string },
  importOpeningRows: async (rows: OpeningRowFields[]): Promise<OpeningImportResult> =>
    (await apiClient.post(p.openingImport, { rows })).data.data,
  importOpeningCsv: async (csv: string): Promise<OpeningImportResult> =>
    (await apiClient.post(p.openingImport, { csv })).data.data,
  openingTemplate: async (): Promise<Blob> =>
    (await apiClient.get(p.openingTemplate, { responseType: "blob" })).data as Blob,
  capitalise: async (body: {
    sourceDocType: "GRN_INVOICE" | "EXPENSE";
    sourceDocId: string;
    lineId?: string;
    classId: string;
    code: string;
    name: string;
    capitalisedOn?: string;
    businessPlaceId?: string | null;
    cost?: number;
    notes?: string | null;
  }): Promise<AssetRow & { voucherId: string | null }> =>
    (await apiClient.post(p.capitalise, body)).data.data,
};
