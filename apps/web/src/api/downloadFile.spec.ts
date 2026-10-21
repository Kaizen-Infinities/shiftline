import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("./apiClient", () => ({ default: { get } }));

import { downloadFile } from "./downloadFile";

describe("downloadFile", () => {
  it("fetches through the authenticated client as a blob and saves it under the server's name", async () => {
    get.mockResolvedValue({
      data: new Blob(["{}"]),
      headers: { "content-disposition": 'attachment; filename="gstr1-2026-08.json"' },
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ click }) });
    await downloadFile("/gst/gstr1/json?period=2026-08", "fallback.json");
    expect(get).toHaveBeenCalledWith("/gst/gstr1/json?period=2026-08", { responseType: "blob" });
    expect(click).toHaveBeenCalledOnce();
  });
});
