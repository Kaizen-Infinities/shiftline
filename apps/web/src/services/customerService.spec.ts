import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_LIST_MAX_LIMIT } from "@shiftline/shared";

const get = vi.hoisted(() => vi.fn());

vi.mock("../api/apiClient", () => ({
  default: { get },
  apiClient: { get },
}));

import { customerService } from "./customerService";

// The API rejects GET /api/customers with limit > CUSTOMER_LIST_MAX_LIMIT (400), and the
// pickers swallowed that error, so the lists came back empty (QA C01).
describe("customerService.fetchAll limit", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { data: { customers: [], total: 0, page: 1, totalPages: 1 } } });
  });

  const sentLimit = () => get.mock.calls[0][1].params.limit;

  it("never asks the API for more than the shared cap", async () => {
    await customerService.fetchAll({ limit: 1000 });
    expect(sentLimit()).toBe(CUSTOMER_LIST_MAX_LIMIT);
  });

  it.each([200, 500])("clamps a limit of %i to the cap", async (limit) => {
    await customerService.fetchAll({ limit });
    expect(sentLimit()).toBe(CUSTOMER_LIST_MAX_LIMIT);
  });

  it("keeps a limit that is already within the cap", async () => {
    await customerService.fetchAll({ limit: 20 });
    expect(sentLimit()).toBe(20);
  });

  it("defaults to 10 rows when no limit is given", async () => {
    await customerService.fetchAll();
    expect(sentLimit()).toBe(10);
  });

  it("uses a cap of 100, matching the API validation", () => {
    expect(CUSTOMER_LIST_MAX_LIMIT).toBe(100);
  });
});
