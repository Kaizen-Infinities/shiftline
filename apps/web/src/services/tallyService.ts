import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Tally XML export (P1-06). */
export type TallyScope = "MASTERS" | "VOUCHERS" | "BOTH";
export type TallyNameKind = "GROUP" | "LEDGER" | "UNIT" | "STOCK_ITEM" | "VOUCHER_TYPE";

export interface TallyRunRow {
  id: string;
  scope: TallyScope;
  tallyCompany: string;
  fromDate: string | null;
  toDate: string | null;
  incremental: boolean;
  sinceAt: string | null;
  throughAt: string | null;
  counts: Record<string, number>;
  sizeBytes: number;
  payloadHash: string;
  status: "DRAFT" | "CONFIRMED" | "DISCARDED";
  notes: string | null;
  confirmedAt: string | null;
  downloads: number;
  createdAt: string;
}

export interface TallyMappingRow {
  id: string;
  kind: TallyNameKind;
  sourceCode: string;
  tallyName: string;
  tallyParent: string | null;
  isExported: boolean;
  notes: string | null;
}

export interface TallyPreview {
  scope: TallyScope;
  incremental: boolean;
  sinceAt: string | null;
  counts: Record<string, number>;
}

const p = API_PATHS.tally;

/** Streams a file through the signed-in session and hands it to the browser. */
const download = async (url: string, params: Record<string, unknown>, fileName: string) => {
  const res = await apiClient.get(url, { params, responseType: "blob" });
  const href = URL.createObjectURL(new Blob([res.data], { type: "application/xml" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
};

export const tallyService = {
  preview: async (q: {
    from: string;
    to: string;
    scope?: TallyScope;
    incremental?: boolean;
  }): Promise<TallyPreview> => (await apiClient.get(p.preview, { params: q })).data.data,

  downloadMasters: () => download(p.masters, {}, "tally-masters.xml"),
  downloadVouchers: (q: { from: string; to: string; incremental?: boolean }) =>
    download(p.vouchers, q, `tally-vouchers-${q.from}.xml`),

  runs: async (): Promise<TallyRunRow[]> => (await apiClient.get(p.runs)).data.data,
  createRun: async (body: {
    from: string;
    to: string;
    scope?: TallyScope;
    incremental?: boolean;
    notes?: string;
  }): Promise<TallyRunRow> => (await apiClient.post(p.runs, body)).data.data,
  downloadRun: (run: TallyRunRow) =>
    download(
      `${p.runs}/${run.id}/file`,
      {},
      `tally-${run.scope.toLowerCase()}-${run.id.slice(0, 8)}.xml`
    ),
  confirmRun: async (id: string): Promise<TallyRunRow> =>
    (await apiClient.post(`${p.runs}/${id}/confirm`)).data.data,
  discardRun: async (id: string, reason: string): Promise<TallyRunRow> =>
    (await apiClient.post(`${p.runs}/${id}/discard`, { reason })).data.data,

  settings: async (): Promise<{ autoExportEnabled: boolean }> =>
    (await apiClient.get(p.settings)).data.data,
  updateSettings: async (body: {
    autoExportEnabled: boolean;
  }): Promise<{ autoExportEnabled: boolean }> => (await apiClient.put(p.settings, body)).data.data,

  mappings: async (): Promise<TallyMappingRow[]> => (await apiClient.get(p.mappings)).data.data,
  saveMapping: async (body: {
    kind: TallyNameKind;
    sourceCode: string;
    tallyName: string;
    tallyParent?: string | null;
    isExported?: boolean;
  }): Promise<TallyMappingRow> => (await apiClient.post(p.mappings, body)).data.data,
  deleteMapping: async (id: string) => (await apiClient.delete(`${p.mappings}/${id}`)).data.data,
};
