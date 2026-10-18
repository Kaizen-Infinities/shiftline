import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { foreignTenant } from "../helpers/foreign-tenant";
import { asDemoTenant, createRawMaterial } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * Raw material references (apps/api/src/modules/raw-material). Category, storage location and HSN
 * code ids come from the request body, so each must belong to the caller's tenant: a foreign id
 * is refused with 400 rather than linked across tenants.
 */
const sfx = randomUUID().slice(0, 6).toUpperCase();

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;
let foreignCategoryId: number;
let foreignHsnId: string;

describe("raw material references are tenant-scoped", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant("xrm");
    const prisma = await getPrisma();
    const cat = await runAsTenant(FOREIGN.companyId, () =>
      prisma.category.create({
        data: { code: `XRM${sfx}`, name: "Foreign category", type: "RAW_MATERIAL" },
      })
    );
    foreignCategoryId = cat.id;
    const hsn = await runAsTenant(FOREIGN.companyId, () =>
      prisma.hsnCode.create({
        data: { code: `XR${sfx}`, description: "Foreign HSN" },
      })
    );
    foreignHsnId = hsn.id;
  });

  it("refuses an update that points at another tenant's category with 400", async () => {
    const prisma = await getPrisma();
    const rm = await createRawMaterial();
    const res = await (
      await api()
    )
      .put(`/api/raw-materials/${encodeURIComponent(rm.rawMaterialId)}`)
      .set(OWNER.auth)
      .send({ categoryId: foreignCategoryId });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(res.body.message ?? res.body.error ?? "").toMatch(/Unknown category/);

    const after = await asDemoTenant(() =>
      prisma.rawMaterial.findUniqueOrThrow({ where: { id: rm.id } })
    );
    expect(after.categoryId).toBeNull();
  });

  it("refuses another tenant's HSN code and an unknown storage location with 400", async () => {
    const rm = await createRawMaterial();
    const hsn = await (
      await api()
    )
      .put(`/api/raw-materials/${encodeURIComponent(rm.rawMaterialId)}`)
      .set(OWNER.auth)
      .send({ hsnCodeId: foreignHsnId });
    expect(hsn.status, JSON.stringify(hsn.body).slice(0, 300)).toBe(400);
    expect(hsn.body.message ?? hsn.body.error ?? "").toMatch(/Unknown HSN code/);

    const loc = await (
      await api()
    )
      .put(`/api/raw-materials/${encodeURIComponent(rm.rawMaterialId)}`)
      .set(OWNER.auth)
      .send({ locationId: randomUUID() });
    expect(loc.status, JSON.stringify(loc.body).slice(0, 300)).toBe(400);
    expect(loc.body.message ?? loc.body.error ?? "").toMatch(/Unknown location/);
  });

  it("refuses a create that points at another tenant's category with 400", async () => {
    const res = await (
      await api()
    )
      .post("/api/raw-materials")
      .set(OWNER.auth)
      .send({
        rawMaterialId: `XRM${sfx}${Date.now().toString(36).slice(-4)}`,
        materialName: "Cross tenant",
        baseUom: "KG",
        rate: 10,
        minimumStock: 0,
        reorderLevel: 0,
        categoryId: foreignCategoryId,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
  });

  it("still accepts a category of the caller's own tenant", async () => {
    const prisma = await getPrisma();
    const rm = await createRawMaterial();
    const own = await asDemoTenant(() =>
      prisma.category.create({
        data: { code: `OWN${sfx}`, name: "Own category", type: "RAW_MATERIAL" },
      })
    );
    const res = await (
      await api()
    )
      .put(`/api/raw-materials/${encodeURIComponent(rm.rawMaterialId)}`)
      .set(OWNER.auth)
      .send({ categoryId: own.id });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.categoryId).toBe(own.id);
  });
});

/**
 * Stock on the master record. On-hand and reserved quantities move only through stock transactions
 * and adjustments. A partial PUT (only the fields the user changed) must leave them as they are, and
 * a request that tries to set them is refused with 400 rather than silently changing stock.
 */
describe("raw material update keeps stock", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("a PUT with only rate keeps on-hand and reserved quantities", async () => {
    const prisma = await getPrisma();
    const rm = await createRawMaterial({ onHandQty: new Prisma.Decimal(160.75), reservedQty: new Prisma.Decimal(12) });

    const res = await (
      await api()
    )
      .put(`/api/raw-materials/${encodeURIComponent(rm.rawMaterialId)}`)
      .set(OWNER.auth)
      .send({ rate: 11 });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);

    const after = await asDemoTenant(() =>
      prisma.rawMaterial.findUniqueOrThrow({ where: { id: rm.id } })
    );
    expect(after.rate?.toNumber()).toBe(11);
    expect(after.onHandQty.toNumber()).toBe(160.75);
    expect(after.reservedQty.toNumber()).toBe(12);
  });

  it("a PUT that sets onHandQty or reservedQty is refused with 400 and changes nothing", async () => {
    const prisma = await getPrisma();
    const rm = await createRawMaterial({ onHandQty: new Prisma.Decimal(500) });

    const onHand = await (
      await api()
    )
      .put(`/api/raw-materials/${encodeURIComponent(rm.rawMaterialId)}`)
      .set(OWNER.auth)
      .send({ onHandQty: 5 });
    expect(onHand.status, JSON.stringify(onHand.body).slice(0, 300)).toBe(400);
    expect(onHand.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "body.onHandQty" })])
    );

    const reserved = await (
      await api()
    )
      .put(`/api/raw-materials/${encodeURIComponent(rm.rawMaterialId)}`)
      .set(OWNER.auth)
      .send({ reservedQty: 3 });
    expect(reserved.status, JSON.stringify(reserved.body).slice(0, 300)).toBe(400);

    const after = await asDemoTenant(() =>
      prisma.rawMaterial.findUniqueOrThrow({ where: { id: rm.id } })
    );
    expect(after.onHandQty.toNumber()).toBe(500);
    expect(after.reservedQty.toNumber()).toBe(0);
  });
});
