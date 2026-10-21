import apiClient from "./apiClient";

/**
 * Downloads a file the API serves behind auth. A plain `<a href="/api/...">` carries no bearer
 * token (it lives in memory), so the request would 401; this goes through the client and hands
 * the browser a blob.
 */
export async function downloadFile(
  url: string,
  fallbackName: string,
  opts: { open?: boolean } = {}
): Promise<void> {
  const res = await apiClient.get(url, { responseType: "blob" });
  const disposition = String(res.headers?.["content-disposition"] ?? "");
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  const blob = res.data as Blob;
  const objectUrl = URL.createObjectURL(blob);
  if (opts.open) {
    window.open(objectUrl, "_blank", "noopener");
  } else {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = named ? decodeURIComponent(named) : fallbackName;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
