import { describe, expect, it, beforeAll } from "vitest";
import { getPrisma } from "../helpers/db";
import { demoCompany, createProduct } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Row-level security is the second fence behind the Prisma extension. These
 * tests talk to the database directly so a bug in the extension cannot hide one
 * in the policies. The test role is not a superuser, so FORCE RLS applies.
 */
describe("row-level security (P0-08)", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const prisma = await getPrisma();
    tenantA = (await demoCompany()).id;
    tenantB = (
      await prisma.company.upsert({
        where: { companyCode: "TEN-RLS" },
        update: {},
        create: { companyCode: "TEN-RLS", companyName: "RLS Tenant", isOnboarded: true },
      })
    ).id;
    await createProduct();
  });

  it("the test role is not a superuser (otherwise these tests prove nothing)", async () => {
    const prisma = await getPrisma();
    const rows = await prisma.$queryRaw<
      { rolsuper: boolean }[]
    >`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0].rolsuper).toBe(false);
  });

  it("returns no rows when no tenant is set on the connection", async () => {
    const prisma = await getPrisma();
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*)::bigint AS n FROM products`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it("returns only the tenant's rows when app.company_id is set", async () => {
    const prisma = await getPrisma();
    const a = await runAsTenant(tenantA, () =>
      prisma.$transaction(
        async (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM products`
      )
    );
    const b = await runAsTenant(tenantB, () =>
      prisma.$transaction(
        async (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM products`
      )
    );
    expect(Number(a[0].n)).toBeGreaterThan(0);
    expect(Number(b[0].n)).toBe(0);
  });

  it("rejects a row written for another tenant even when companyId is passed explicitly", async () => {
    const prisma = await getPrisma();
    const owner = await withoutTenant(() =>
      prisma.user.findFirstOrThrow({ where: { username: "demo.owner" } })
    );
    await expect(
      runAsTenant(tenantB, () =>
        prisma.product.create({
          data: {
            companyId: tenantA,
            productCode: `EVIL-${Date.now()}`,
            productName: "Cross-tenant write",
            createdBy: owner.userId,
          },
        })
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("lets platform paths read across tenants only with the bypass flag", async () => {
    const prisma = await getPrisma();
    const all = await withoutTenant(() => prisma.product.count());
    const onlyA = await runAsTenant(tenantA, () => prisma.product.count());
    expect(all).toBeGreaterThanOrEqual(onlyA);
    expect(onlyA).toBeGreaterThan(0);
  });

  it("covers every tenant table with both policies", async () => {
    const prisma = await getPrisma();
    const missing = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped)
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
             OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) < 2)`;
    expect(missing.map((m) => m.relname)).toEqual([]);
  });
});
