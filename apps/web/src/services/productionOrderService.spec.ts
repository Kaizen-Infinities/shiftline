import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../api/apiClient", () => ({
  default: http,
  apiClient: http,
}));

import config from "../api/config";
import { productionOrderService } from "./productionOrderService";

// Production order numbers are business codes that contain "/" (e.g. MO/2026-27/0001-1).
// Sent raw in a path they split into extra segments and Express answers "Route not found".
const orderNo = "MO/2026-27/0001-1";
const encoded = "MO%2F2026-27%2F0001-1";
const base = config.productionOrder.base;

describe("productionOrderService paths for order numbers containing '/'", () => {
  beforeEach(() => {
    for (const fn of Object.values(http)) fn.mockReset();
    for (const fn of Object.values(http)) fn.mockResolvedValue({ data: { data: {} } });
  });

  it("getById encodes the order number segment", async () => {
    await productionOrderService.getById(orderNo);
    expect(http.get).toHaveBeenCalledWith(`${base}/${encoded}`);
  });

  it("update encodes the order number segment", async () => {
    await productionOrderService.update(orderNo, { remarks: "x" });
    expect(http.put).toHaveBeenCalledWith(`${base}/${encoded}`, { remarks: "x" });
  });

  it("delete encodes the order number segment", async () => {
    await productionOrderService.delete(orderNo);
    expect(http.delete).toHaveBeenCalledWith(`${base}/${encoded}`);
  });

  it("issueMaterials encodes the order number segment", async () => {
    const body = { items: [] };
    await productionOrderService.issueMaterials(orderNo, body);
    expect(http.post).toHaveBeenCalledWith(`${base}/${encoded}/issue-materials`, body);
  });

  it("checkMaterialAvailability encodes the order number segment", async () => {
    await productionOrderService.checkMaterialAvailability(orderNo);
    expect(http.post).toHaveBeenCalledWith(`${base}/${encoded}/check-materials`);
  });

  it("startProduction encodes the order number segment", async () => {
    await productionOrderService.startProduction(orderNo, "DP0002");
    expect(http.post).toHaveBeenCalledWith(`${base}/${encoded}/start-production`, { dailyPlanId: "DP0002" });
  });

  it("completePostProduction encodes the order number segment", async () => {
    await productionOrderService.completePostProduction(orderNo, 10);
    expect(http.post).toHaveBeenCalledWith(`${base}/${encoded}/complete-post-production`, { producedQty: 10 });
  });

  it("getHistory encodes the order number segment", async () => {
    await productionOrderService.getHistory(orderNo);
    expect(http.get).toHaveBeenCalledWith(`${base}/${encoded}/history`);
  });

  it("leaves plain order numbers unchanged", async () => {
    await productionOrderService.getById("MO-1");
    expect(http.get).toHaveBeenCalledWith(`${base}/MO-1`);
  });
});
