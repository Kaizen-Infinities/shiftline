import apiClient from "../api/apiClient";

/** Full account export (P1-03): request, list and download. */
export interface AccountExportRow {
  id: string;
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED" | "EXPIRED";
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  tableCounts: Record<string, number> | null;
  attachmentCount: number;
  downloads: number;
  lastDownloadedAt: string | null;
  error: string | null;
}

export const accountExportService = {
  list: async (): Promise<AccountExportRow[]> => (await apiClient.get("/account-export")).data.data,
  request: async (): Promise<AccountExportRow & { queued: boolean }> =>
    (await apiClient.post("/account-export")).data.data,
  get: async (id: string): Promise<AccountExportRow> =>
    (await apiClient.get(`/account-export/${id}`)).data.data,
  /** Streams the archive through the signed-in session and hands it to the browser. */
  download: async (row: AccountExportRow) => {
    const res = await apiClient.get(`/account-export/${row.id}/file`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/gzip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = row.fileName ?? "shiftline-export.tar.gz";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
