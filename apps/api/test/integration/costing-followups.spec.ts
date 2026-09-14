import { beforeAll, describe, expect, it } from "vitest";

import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";
import { seedTenant } from "../../prisma/seed-lib";
import productionWastageService from "../../src/modules/production-wastage/production-wastage.service";
import { valuationService } from "../../src/modules/costing/valuation.service";

/**
 * Costing follow-ups (P2-20): the gap backfill left history before a wired entry unvalued, and
 * wastage recovery with no estimate was received at zero.
 */
const sfx = Date.now().toString(36).slice(-6);
const STORE = "ST-RM";

let ownerUser: { userId: string };

describe("costing follow-ups", () => {
  beforeAll(async () => {
    const found = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" } });
    });
    ownerUser = found;
  });

  it("backfills the gap before a wired entry, in date order, and leaves anything on/after it alone", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-GAP-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 12 as any,
    });

    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      // Two historical movements that predate any valuation entry.
      await prisma.rawMaterialTransaction.create({
        data: {
          storeId: STORE,
          rawMaterialId: rm.rawMaterialId,
          txnType: "RECEIPT",
          qty: 50,
          txnDateTime: new Date("2020-01-01"),
          remarks: "Oldest, pre-wiring",
        },
      });
      await prisma.rawMaterialTransaction.create({
        data: {
          storeId: STORE,
          rawMaterialId: rm.rawMaterialId,
          txnType: "RECEIPT",
          qty: 30,
          txnDateTime: new Date("2020-01-15"),
          remarks: "Second, pre-wiring",
        },
      });
    });

    // A real, wired movement — this is what establishes the cut-off.
    const wired = await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2020-02-01",
        kind: "RECEIPT",
        quantity: 20,
        rate: 15,
        refDocType: "GRN",
        refDocId: `GRN-${sfx}`,
      })
    );

    // A later transaction that must stay untouched — nothing ever wires this txn type into the
    // ledger directly, but it is on/after the cut-off, so the gap-fill leaves it alone too.
    const later = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.rawMaterialTransaction.create({
        data: {
          storeId: STORE,
          rawMaterialId: rm.rawMaterialId,
          txnType: "RAW_MATERIAL_ISSUE",
          qty: -10,
          txnDateTime: new Date("2020-03-01"),
          remarks: "After the cut-off",
        },
      });
    });

    const first = await asDemoTenant(() => valuationService.backfill({ userId: ownerUser.userId }));
    expect(first.created).toBe(2);
    expect(first.skipped).toBeGreaterThanOrEqual(1);

    const entries = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.stockValuationEntry.findMany({
        where: { itemType: "RAW_MATERIAL", itemId: rm.rawMaterialId, storeId: STORE },
        orderBy: [{ movedOn: "asc" }, { createdAt: "asc" }],
      });
    });
    // Two backfilled rows, then the wired entry — in date order — and nothing for the later txn.
    expect(entries.length).toBe(3);
    expect(entries[0].refDocType).toBe("RM_TXN_BACKFILL");
    expect(Number(entries[0].quantity)).toBe(50);
    expect(Number(entries[0].rate)).toBe(12); // the item master's rate — no other rate is known
    expect(Number(entries[0].balanceQuantity)).toBe(50);
    expect(Number(entries[0].avgRate)).toBe(12);

    expect(entries[1].refDocType).toBe("RM_TXN_BACKFILL");
    expect(Number(entries[1].quantity)).toBe(30);
    expect(Number(entries[1].balanceQuantity)).toBe(80);
    expect(Number(entries[1].avgRate)).toBe(12); // 50 @ 12 + 30 @ 12 stays 12

    // The wired entry itself is exactly as it was — the gap-fill never rewrites what is real.
    expect(entries[2].id).toBe(wired.id);
    expect(Number(entries[2].balanceQuantity)).toBe(20);
    expect(Number(entries[2].avgRate)).toBe(15);

    const backfilledForLater = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.stockValuationEntry.findFirst({
        where: { refDocType: "RM_TXN_BACKFILL", refDocId: later.rmTxnId.toString() },
      });
    });
    expect(backfilledForLater).toBeNull();

    // Idempotent: a second run creates nothing further.
    const second = await asDemoTenant(() =>
      valuationService.backfill({ userId: ownerUser.userId })
    );
    expect(second.created).toBe(0);

    const entriesAfterSecondRun = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.stockValuationEntry.count({
        where: { itemType: "RAW_MATERIAL", itemId: rm.rawMaterialId, storeId: STORE },
      });
    });
    expect(entriesAfterSecondRun).toBe(3);
  });

  it("falls back to the earliest known valuation rate when the item master carries none", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-GAPNR-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: null as any,
    });

    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      await prisma.rawMaterialTransaction.create({
        data: {
          storeId: STORE,
          rawMaterialId: rm.rawMaterialId,
          txnType: "RECEIPT",
          qty: 10,
          txnDateTime: new Date("2020-01-01"),
        },
      });
    });

    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2020-02-01",
        kind: "RECEIPT",
        quantity: 5,
        rate: 40,
        refDocType: "GRN",
        refDocId: `GRN-NR-${sfx}`,
      })
    );

    await asDemoTenant(() => valuationService.backfill({ userId: ownerUser.userId }));

    const backfilled = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.stockValuationEntry.findFirst({
        where: {
          itemType: "RAW_MATERIAL",
          itemId: rm.rawMaterialId,
          refDocType: "RM_TXN_BACKFILL",
        },
      });
    });
    expect(backfilled).toBeTruthy();
    // No master rate — falls back to the rate of the first known (wired) valuation entry.
    expect(Number(backfilled!.rate)).toBe(40);
  });

  it("wastage recovery with no estimate uses the recovered material's average, or its master rate when never valued", async () => {
    const recoveredAveraged = await createRawMaterial({
      rawMaterialId: `RM-WSTAVG-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 8 as any,
    });
    const recoveredFresh = await createRawMaterial({
      rawMaterialId: `RM-WSTNEW-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 9 as any,
    });
    const product = await createProduct();

    // Give the first recovered material a real weighted average that differs from its master
    // rate, so the test can tell which one the recovery actually used.
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: recoveredAveraged.rawMaterialId,
        storeId: STORE,
        movedOn: "2034-01-01",
        kind: "RECEIPT",
        quantity: 40,
        rate: 25,
      })
    );

    const poId = `PO-WST-${sfx}`;
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      const company = await prisma.company.findUniqueOrThrow({ where: { companyCode: "DEMO" } });
      await prisma.productionOrder.create({
        data: {
          productionOrderId: poId,
          companyId: company.id,
          orderDate: new Date("2034-02-01"),
          productItemId: product.id,
          targetQty: 5 as any,
          uom: "NOS",
          dueDate: new Date("2034-03-01"),
          status: "READY_FOR_PLANNING",
          sourceStoreId: STORE,
        },
      });
    });

    const machine = await asDemoTenant(async () => (await getPrisma()).machine.findFirst());
    const shift = await asDemoTenant(async () => (await getPrisma()).shift.findFirst());
    if (!machine || !shift) {
      throw new Error("The demo tenant seed is missing a machine or a shift fixture");
    }

    // No `rawMaterialId` on either log — so nothing auto-fills `estimatedValue` from a master
    // rate, and the recovery has to fall back on its own.
    const wastageAvg = await asDemoTenant(() =>
      productionWastageService.create(
        {
          wastageDate: "2034-02-02",
          productionOrderId: poId,
          machineId: machine.machineId,
          shiftId: shift.shiftCode,
          productId: String(product.id),
          targetWastageProductId: recoveredAveraged.rawMaterialId,
          storeId: STORE,
          wastageType: "OTHER" as any,
          quantity: 5,
          uom: recoveredAveraged.baseUom,
        } as any,
        ownerUser.userId
      )
    );
    expect(wastageAvg.estimatedValue).toBeNull();
    const approvedAvg = await asDemoTenant(() =>
      productionWastageService.approve(wastageAvg.id, ownerUser.userId)
    );
    const avgEntry = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.stockValuationEntry.findFirst({
        where: {
          itemType: "RAW_MATERIAL",
          itemId: recoveredAveraged.rawMaterialId,
          refDocType: "PRODUCTION_WASTAGE",
          refDocId: String(approvedAvg.id),
        },
      });
    });
    expect(avgEntry).toBeTruthy();
    expect(Number(avgEntry!.rate)).toBe(25); // the running average, not the master rate of 8
    expect(avgEntry!.narration).toContain("current weighted average");

    const wastageNew = await asDemoTenant(() =>
      productionWastageService.create(
        {
          wastageDate: "2034-02-03",
          productionOrderId: poId,
          machineId: machine.machineId,
          shiftId: shift.shiftCode,
          productId: String(product.id),
          targetWastageProductId: recoveredFresh.rawMaterialId,
          storeId: STORE,
          wastageType: "OTHER" as any,
          quantity: 3,
          uom: recoveredFresh.baseUom,
        } as any,
        ownerUser.userId
      )
    );
    expect(wastageNew.estimatedValue).toBeNull();
    const approvedNew = await asDemoTenant(() =>
      productionWastageService.approve(wastageNew.id, ownerUser.userId)
    );
    const newEntry = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.stockValuationEntry.findFirst({
        where: {
          itemType: "RAW_MATERIAL",
          itemId: recoveredFresh.rawMaterialId,
          refDocType: "PRODUCTION_WASTAGE",
          refDocId: String(approvedNew.id),
        },
      });
    });
    expect(newEntry).toBeTruthy();
    expect(Number(newEntry!.rate)).toBe(9); // never valued before — falls back to the master rate
    expect(newEntry!.narration).toContain("master rate");
  });

  it("keeps a foreign tenant's backfill and ledger untouched by another tenant's history", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-XT20-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 12 as any,
    });
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      await prisma.rawMaterialTransaction.create({
        data: {
          storeId: STORE,
          rawMaterialId: rm.rawMaterialId,
          txnType: "RECEIPT",
          qty: 25,
          txnDateTime: new Date("2020-01-01"),
        },
      });
    });
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2020-02-01",
        kind: "RECEIPT",
        quantity: 5,
        rate: 20,
        refDocType: "GRN",
        refDocId: `GRN-XT-${sfx}`,
      })
    );

    const tenantB = await seedTenant({
      companyCode: `P220B-${sfx}`,
      companyName: "P2-20 Tenant B",
      slug: `p220b${sfx}`,
      globalPrefix: `P220B${sfx}`,
      password: "Test@12345678",
    });

    const resultFromB = await runAsTenant(tenantB.id, () =>
      valuationService.backfill({ userId: ownerUser.userId })
    );
    // Tenant B has no raw-material transactions of its own to backfill, and certainly cannot see
    // the demo tenant's.
    expect(resultFromB.created).toBe(0);

    const seenFromB = await runAsTenant(tenantB.id, () =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(seenFromB.quantity).toBe(0);
    expect(seenFromB.value).toBe(0);
  });
});
