import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());

vi.mock("../api/apiClient", () => ({
  default: { get },
  apiClient: { get },
}));

import { SUPPLIER_LIST_MAX_LIMIT, supplierService } from "./supplierService";

const page = (suppliers: { id: number }[], totalPages: number) => ({
  data: { message: "ok", data: { suppliers, pagination: { total: 0, totalPages } } },
});

describe("supplierService list limit", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(page([], 1));
  });

  it("caps any limit above the API maximum of 100", async () => {
    expect(SUPPLIER_LIST_MAX_LIMIT).toBe(100);
    for (const limit of [1000, 10000, 100000]) {
      get.mockClear();
      await supplierService.fetchAll({ limit });
      expect(get).toHaveBeenCalledWith("/suppliers", { params: { limit: 100 } });
    }
  });

  it("leaves a limit at or under the cap unchanged and keeps other params", async () => {
    await supplierService.fetchAll({ limit: 15, page: 2, search: "ACME" });
    expect(get).toHaveBeenCalledWith("/suppliers", {
      params: { limit: 15, page: 2, search: "ACME" },
    });
  });

  it("does not add a limit when the caller sent none", async () => {
    await supplierService.fetchAll({ search: "ACME" });
    expect(get).toHaveBeenCalledWith("/suppliers", { params: { search: "ACME" } });
  });

  it("walks every page at the cap and returns all suppliers", async () => {
    get
      .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], 3))
      .mockResolvedValueOnce(page([{ id: 3 }, { id: 4 }], 3))
      .mockResolvedValueOnce(page([{ id: 5 }], 3));

    const rows = await supplierService.fetchAllSuppliers({ status: "Active" });

    expect(rows.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls.map((c) => c[1].params)).toEqual([
      { status: "Active", page: 1, limit: 100 },
      { status: "Active", page: 2, limit: 100 },
      { status: "Active", page: 3, limit: 100 },
    ]);
  });

  it("stops after one request when there is a single page", async () => {
    get.mockResolvedValueOnce(page([{ id: 1 }], 1));
    const rows = await supplierService.fetchAllSuppliers();
    expect(rows).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed page so the caller can show an error", async () => {
    get.mockRejectedValueOnce(new Error("Network Error"));
    await expect(supplierService.fetchAllSuppliers()).rejects.toThrow("Network Error");
  });
});
