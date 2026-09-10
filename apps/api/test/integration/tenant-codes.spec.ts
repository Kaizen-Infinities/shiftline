import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { byCode } from "../../src/lib/prisma";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * Business codes are unique per tenant, not across the platform (P1-00f): two
 * companies may both have store ST-RM, machine M-01 and shift A. Stores,
 * machines, raw materials, production orders, weekly programs, daily plans,
 * locations and shifts carry a uuid primary key; their codes are unique with
 * companyId, and every foreign key to them pairs the code with companyId so a
 * row can only point inside its own tenant.
 */
describe("tenant-scoped business codes", () => {
  const sfx = randomUUID().slice(0, 6);
  let otherId: string;
  let otherAuth: { Authorization: string };

  it("a second tenant reuses the demo tenant's codes without a collision", async () => {
    const prisma = await getPrisma();
    const admin = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: ADMIN.password });
    const created = await (
      await api()
    )
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${admin.body.data.accessToken}`)
      .send({
        companyCode: `K${sfx.toUpperCase()}`,
        companyName: "Codes Co",
        slug: `codes-${sfx}`,
        owner: { email: `owner.${sfx}@codes.example`, fullName: "Codes Owner" },
      });
    expect(created.status).toBe(201);
    otherId = created.body.data.company.id;
    const token = new URL(created.body.data.ownerInvitation.acceptUrl).searchParams.get("token")!;
    const accepted = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "CodesOwner#2026!" });
    otherAuth = { Authorization: `Bearer ${accepted.body.data.accessToken}` };

    const demo = await asDemoTenant(async () => ({
      store: await prisma.store.findFirstOrThrow({ where: { storeName: "Raw Material Store" } }),
      machine: await prisma.machine.findFirstOrThrow(),
      shift: await prisma.shift.findFirstOrThrow(),
      material: await prisma.rawMaterial.findFirstOrThrow(),
    }));

    await runAsTenant(otherId, async () => {
      const store = await prisma.store.create({
        data: {
          storeId: demo.store.storeId,
          storeCode: demo.store.storeCode,
          storeName: "Other RM Store",
        },
      });
      expect(store.id).not.toBe(demo.store.id);
      expect(store.storeId).toBe(demo.store.storeId);
      const machine = await prisma.machine.create({
        data: { machineId: demo.machine.machineId, machineName: "Other Machine", isActive: true },
      });
      expect(machine.id).not.toBe(demo.machine.id);
      const shift = await prisma.shift.create({
        data: {
          shiftCode: demo.shift.shiftCode,
          shiftName: "Other A",
          startTime: "06:00",
          endTime: "14:00",
        },
      });
      expect(shift.shiftCode).toBe(demo.shift.shiftCode);
      // A raw material in this tenant referencing the shared store code resolves to *this* store.
      const material = await prisma.rawMaterial.create({
        data: {
          rawMaterialId: demo.material.rawMaterialId,
          materialName: "Other HDPE",
          baseUom: "KG",
          storeId: demo.store.storeId,
        },
        include: { store: true },
      });
      expect(material.store?.id).toBe(store.id);
      expect(material.store?.companyId).toBe(otherId);
    });
  });

  it("lookups by code stay inside the caller's tenant, typed and at runtime", async () => {
    const prisma = await getPrisma();
    const demo = await demoCompany();
    const storeCode = (
      await asDemoTenant(() =>
        prisma.store.findFirstOrThrow({ where: { storeName: "Raw Material Store" } })
      )
    ).storeId;

    const mine = await asDemoTenant(() =>
      prisma.store.findUniqueOrThrow({ where: byCode("storeId", storeCode) })
    );
    expect(mine.companyId).toBe(demo.id);
    const theirs = await runAsTenant(otherId, () =>
      prisma.store.findUniqueOrThrow({ where: byCode("storeId", storeCode) })
    );
    expect(theirs.companyId).toBe(otherId);
    expect(theirs.id).not.toBe(mine.id);

    // Legacy call shape `where: { storeId }` is rewritten to the composite key by the extension.
    const legacy = await runAsTenant(otherId, () =>
      prisma.store.findUnique({ where: { storeId: storeCode } as never })
    );
    expect(legacy?.id).toBe(theirs.id);
    const updated = await runAsTenant(otherId, () =>
      prisma.store.update({
        where: { storeId: storeCode } as never,
        data: { storeName: "Renamed" },
      })
    );
    expect(updated.id).toBe(theirs.id);
    expect(
      (
        await asDemoTenant(() =>
          prisma.store.findUniqueOrThrow({ where: byCode("storeId", storeCode) })
        )
      ).storeName
    ).toBe("Raw Material Store");
  });

  it("the API serves each tenant its own row for the same code", async () => {
    const prisma = await getPrisma();
    const storeCode = (
      await asDemoTenant(() =>
        prisma.store.findFirstOrThrow({ where: { storeName: "Raw Material Store" } })
      )
    ).storeId;
    const owner = await authed("demo.owner");
    const a = await (
      await api()
    )
      .get(`/api/stores/${encodeURIComponent(storeCode)}`)
      .set(owner.auth);
    const b = await (
      await api()
    )
      .get(`/api/stores/${encodeURIComponent(storeCode)}`)
      .set(otherAuth);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(a.body.data.storeName).toBe("Raw Material Store");
    expect(b.body.data.storeName).toBe("Renamed");
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  it("a foreign key cannot point at another tenant's row even with a matching code", async () => {
    const prisma = await getPrisma();
    // The demo tenant has a finished-goods store; Codes Co does not. Referencing its code from
    // Codes Co fails on the composite (company_id, store_id) foreign key instead of reaching across.
    const demoFg = await asDemoTenant(() =>
      prisma.store.findFirstOrThrow({ where: { storeName: "Finished Goods Store" } })
    );
    await expect(
      runAsTenant(otherId, () =>
        prisma.rawMaterial.create({
          data: {
            rawMaterialId: `RM-${sfx}`,
            materialName: "Cross-tenant attempt",
            baseUom: "KG",
            storeId: demoFg.storeId,
          },
        })
      )
    ).rejects.toThrow(/Foreign key constraint/);
    expect(
      await runAsTenant(otherId, () =>
        prisma.rawMaterial.count({ where: { rawMaterialId: `RM-${sfx}` } })
      )
    ).toBe(0);
  });
});
