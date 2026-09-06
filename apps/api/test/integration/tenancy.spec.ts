import { describe, expect, it, beforeAll } from "vitest";
import { getPrisma } from "../helpers/db";
import { demoCompany, createProduct } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { TENANT_MODELS } from "../../src/lib/prisma";

describe("tenant scoping (P0-06 / P0-07)", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const prisma = await getPrisma();
    tenantA = (await demoCompany()).id;
    const b = await prisma.company.upsert({
      where: { companyCode: "TEN-B" },
      update: {},
      create: { companyCode: "TEN-B", companyName: "Tenant B Test Co", isOnboarded: true },
    });
    tenantB = b.id;
  });

  it("derives the tenant model list from the schema", () => {
    expect(TENANT_MODELS.has("Product")).toBe(true);
    expect(TENANT_MODELS.has("Voucher")).toBe(true);
    expect(TENANT_MODELS.has("Company")).toBe(false);
    expect(TENANT_MODELS.has("Permission")).toBe(false);
    expect(TENANT_MODELS.size).toBeGreaterThan(80);
  });

  it("stamps companyId on create and hides rows from other tenants", async () => {
    const prisma = await getPrisma();
    const owner = await withoutTenant(() =>
      prisma.user.findFirstOrThrow({ where: { username: "demo.owner" } })
    );
    const codeB = `PB-${Date.now()}`;
    const createdB = await runAsTenant(tenantB, () =>
      prisma.product.create({
        data: { productCode: codeB, productName: "Tenant B product", createdBy: owner.userId },
      })
    );
    expect(createdB.companyId).toBe(tenantB);

    const seenFromA = await runAsTenant(tenantA, () =>
      prisma.product.findMany({ where: { productCode: codeB } })
    );
    expect(seenFromA).toHaveLength(0);
    const seenFromB = await runAsTenant(tenantB, () =>
      prisma.product.findFirst({ where: { productCode: codeB } })
    );
    expect(seenFromB?.id).toBe(createdB.id);
  });

  it("uses the database default for nested creates (session tenant)", async () => {
    const prisma = await getPrisma();
    const product = await createProduct();
    const bom = await runAsTenant(tenantA, () =>
      prisma.product.update({
        where: { id: product.id },
        data: {
          billOfMaterials: {
            create: [{ rawMaterialId: "RM001", requiredQuantity: 1.5, uom: "KG" }],
          },
        },
        include: { billOfMaterials: true },
      })
    );
    expect(bom.billOfMaterials).toHaveLength(1);
    expect(bom.billOfMaterials[0].companyId).toBe(tenantA);
  });

  it("refuses tenant-scoped queries outside any tenant context", async () => {
    const prisma = await getPrisma();
    await expect(prisma.product.findMany()).rejects.toThrow(/without tenant context/);
  });

  it("scopes findUnique/update/delete by id to the tenant", async () => {
    const prisma = await getPrisma();
    const product = await createProduct({ productName: "Only A" });
    const fromB = await runAsTenant(tenantB, () =>
      prisma.product.findUnique({ where: { id: product.id } })
    );
    expect(fromB).toBeNull();
    await expect(
      runAsTenant(tenantB, () =>
        prisma.product.update({ where: { id: product.id }, data: { productName: "Hijacked" } })
      )
    ).rejects.toThrow();
    const still = await runAsTenant(tenantA, () =>
      prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    );
    expect(still.productName).toBe("Only A");
  });

  it("keeps interactive transactions inside the tenant", async () => {
    const prisma = await getPrisma();
    const result = await runAsTenant(tenantB, () =>
      prisma.$transaction(async (tx) => {
        const count = await tx.product.count();
        const all = await tx.product.findMany({ select: { companyId: true } });
        return { count, foreign: all.filter((p) => p.companyId !== tenantB).length };
      })
    );
    expect(result.foreign).toBe(0);
    expect(result.count).toBeGreaterThanOrEqual(1);
  });
});
