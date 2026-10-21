import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());

vi.mock("../api/apiClient", () => ({
  default: { post },
  apiClient: { post },
}));
vi.mock("../api/config", () => ({
  default: { imports: { base: "/api/imports" } },
}));

import { importsService } from "./importsService";

const file = new File(["code\n"], "customers.csv", { type: "text/csv" });

// H42: a 400 without a report (missing columns, empty file) came back as the error envelope and
// the Data imports page crashed reading `rows`. Such a 400 must reject with its message instead.
describe("importsService.run", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("rejects with the API message when a 400 carries no report", async () => {
    post.mockResolvedValue({
      status: 400,
      data: { success: false, message: "Missing required column(s): customer_code" },
    });
    await expect(importsService.run("customers", file, true)).rejects.toThrow(
      "Missing required column(s): customer_code"
    );
  });

  it("returns the report when a 400 carries one (rows failed validation)", async () => {
    const report = { total: 1, ok: 0, errors: 1, rows: [{ row: 2, status: "error" }] };
    post.mockResolvedValue({
      status: 400,
      data: { success: false, message: "Fix the rows marked as errors", data: report },
    });
    await expect(importsService.run("customers", file, false)).resolves.toMatchObject({
      errors: 1,
      rows: [{ row: 2, status: "error" }],
    });
  });

  it("returns the report for a successful dry run", async () => {
    const report = { total: 1, ok: 1, errors: 0, rows: [{ row: 2, status: "ok" }] };
    post.mockResolvedValue({ status: 200, data: { success: true, data: report } });
    await expect(importsService.run("customers", file, true)).resolves.toMatchObject({ ok: 1 });
  });
});
