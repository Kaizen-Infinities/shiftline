import apiClient from "../api/apiClient";
import config from "../api/config";

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  example: string;
  description: string;
}

export interface ImportTypeDef {
  key: string;
  label: string;
  description: string;
  permissions: string[];
  columns: ImportColumn[];
}

export interface ImportRowResult {
  row: number;
  code: string | null;
  status: "ok" | "exists" | "error";
  messages: string[];
}

export interface ImportReport {
  type: string;
  dryRun: boolean;
  total: number;
  ok: number;
  exists: number;
  errors: number;
  imported: number;
  ignoredColumns: string[];
  rows: ImportRowResult[];
  failed: { row: number; message: string } | null;
}

const base = config.imports.base;

/** CSV imports (P1-00): templates, dry run, commit. */
export const importsService = {
  types: async (): Promise<ImportTypeDef[]> =>
    (await apiClient.get(`${base}/types`)).data?.data ?? [],

  template: async (type: string): Promise<Blob> =>
    (await apiClient.get(`${base}/templates/${type}`, { responseType: "blob" })).data as Blob,

  run: async (type: string, file: File, dryRun: boolean): Promise<ImportReport> => {
    const body = new FormData();
    body.append("file", file, file.name);
    const res = await apiClient.post(`${base}/${type}?dryRun=${dryRun}`, body, {
      headers: { "Content-Type": "multipart/form-data" },
      // A 400 on commit carries the report; surface it instead of throwing.
      validateStatus: (s) => (s >= 200 && s < 300) || s === 400,
    });
    return (res.data?.data ?? res.data) as ImportReport;
  },
};
