import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

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
