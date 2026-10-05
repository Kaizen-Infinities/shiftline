import { describe, expect, it } from "vitest";
import { api, authed } from "../helpers/app";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";
import { getPrisma } from "../helpers/db";

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

describe("product update keeps its recipe and tax fields (QA F2)", () => {
  const setup = async () => {
    const product = await createProduct({ productName: "Recipe Keeper" });
    const rm = await createRawMaterial();
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      await prisma.billOfMaterial.create({
        data: {
          productId: product.id,
          rawMaterialId: rm.rawMaterialId,
          requiredQuantity: 0.6,
          uom: "KG",
        },
      });
    });
    return { product, rm };
  };

  const bomOf = (id: bigint) =>
    asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.billOfMaterial.findMany({ where: { productId: id } });
    });

  it("leaves BOM lines untouched when the update does not send rawMaterials", async () => {
    const { product, rm } = await setup();
    const { auth } = await authed();
    const res = await (
      await api()
    )
      .put(`/api/products/${product.id}`)
      .set(auth)
      .send({ productName: "Recipe Keeper v2" });
    expect(res.status).toBe(200);
    const lines = await bomOf(product.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].rawMaterialId).toBe(rm.rawMaterialId);
    expect(Number(lines[0].requiredQuantity)).toBe(0.6);
    expect(res.body.data.billOfMaterials).toHaveLength(1);
  });

  it("keeps the stored quantity when the form re-sends a line without one", async () => {
    const { product, rm } = await setup();
    const { auth } = await authed();
    const res = await (
      await api()
    )
      .put(`/api/products/${product.id}`)
      .set(auth)
      .send({ rawMaterials: [{ rawMaterialId: rm.rawMaterialId, requiredQuantity: 0 }] });
    expect(res.status).toBe(200);
    const lines = await bomOf(product.id);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].requiredQuantity)).toBe(0.6);
    expect(lines[0].uom).toBe("KG");
  });

  it("persists HSN and GST rate, and rejects unknown ones", async () => {
    const { product } = await setup();
    const { auth } = await authed();
    const hsn = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.hsnCode.findFirstOrThrow({ where: { code: "3924" } });
    });
    const put = async (body: object) =>
      (await api()).put(`/api/products/${product.id}`).set(auth).send(body);

    expect((await put({ hsnCodeId: hsn.id, gstRate: 18 })).status).toBe(200);
    const got = await (await api()).get(`/api/products/${product.id}`).set(auth);
    expect(got.body.data.hsnCode.code).toBe("3924");
    expect(Number(got.body.data.gstRate)).toBe(18);

    expect((await put({ gstRate: 17 })).status).toBe(400);
    expect((await put({ hsnCodeId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);

    expect((await put({ gstRate: "" })).status).toBe(200);
    const after = await (await api()).get(`/api/products/${product.id}`).set(auth);
    expect(after.body.data.gstRate).toBeNull();
  });
});
