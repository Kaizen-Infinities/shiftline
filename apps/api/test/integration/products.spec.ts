import { describe, expect, it } from "vitest";
import { api, authed } from "../helpers/app";
import { createProduct } from "../factories";

describe("products listing (PERF-01)", () => {
  it("returns the legacy array when unpaginated", async () => {
    const { auth } = await authed();
    const res = await (await api()).get("/api/products").set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
  });

  it("returns a paginated shape when page/limit are given", async () => {
    await createProduct();
    const { auth } = await authed();
    const res = await (await api()).get("/api/products?page=1&limit=2").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.pageSize).toBe(2);
    expect(res.body.data.total).toBeGreaterThanOrEqual(6);
  });

  it("finds a product by id", async () => {
    const product = await createProduct({ productName: "Findable Widget" });
    const { auth } = await authed();
    const res = await (await api()).get(`/api/products/${product.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.productName).toBe("Findable Widget");
  });
});
