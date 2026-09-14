import { beforeAll, describe, expect, it } from "vitest";

import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct, createRawMaterial, createSupplier } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";
import { seedTenant } from "../../prisma/seed-lib";
import grnInvoiceService from "../../src/modules/grn-invoice/grn-invoice.service";
import productionOrderService from "../../src/modules/production-order/production-order.service";
import productionWastageService from "../../src/modules/production-wastage/production-wastage.service";
import { StockAdjustmentService } from "../../src/modules/stock-adjustment/stock-adjustment.service";
import { importsService } from "../../src/modules/currency/imports.service";
import { jobWorkService, JOB_WORK_STORE_ID } from "../../src/modules/job-work/job-work.service";
import { valuationService } from "../../src/modules/costing/valuation.service";
import { wipService } from "../../src/modules/costing/wip.service";

/**
 * Valuation wiring and WIP (P2-04).
 *
 * `valuationService.record` existed and nothing called it: a GRN, a production issue, a wastage
 * entry and a stock adjustment all moved stock and none of them valued it. This wires every one
 * of them into the same transaction as the document write, reverses what a cancellation undoes,
 * and adds the one balance the ledger could not show on its own — material issued to an order
 * that is still open.
 */
const sfx = Date.now().toString(36).slice(-6);
const STORE = "ST-RM";

let ownerUser: { userId: string };
let companyId: string;
let actor: { userId: string; companyId: string };
let supplierId: number;

describe("valuation wiring and WIP", () => {
  beforeAll(async () => {
    const found = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      const user = await prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" } });
      const company = await prisma.company.findFirstOrThrow();
      return { user, company };
    });
    ownerUser = found.user;
    companyId = found.company.id;
    actor = { userId: ownerUser.userId, companyId };
    const supplier = await createSupplier();
    supplierId = supplier.id;
  });

  const grnBody = (overrides: Record<string, unknown> = {}) => ({
    invoiceNo: `INV-${sfx}-${Math.random().toString(36).slice(2, 6)}`,
    grnDate: "2034-01-05",
    supplierId,
    storeId: STORE,
    billingAddressLine1: "1 Test Street",
    billingCity: "Chennai",
    billingState: "Tamil Nadu",
    billingPincode: "600001",
    shippingAddressLine1: "1 Test Street",
    shippingCity: "Chennai",
    shippingState: "Tamil Nadu",
    shippingPincode: "600001",
    sameAsBilling: true,
    updateStock: true,
    discountType: "PERCENT",
    discountValue: 0,
    roundingAdjust: 0,
    ...overrides,
  });

  it("a GRN receipt values stock at the line cost and raises the average", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-GRN-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 0 as any,
    });

    const grn = await asDemoTenant(() =>
      grnInvoiceService.createGrnInvoice(
        grnBody({
          items: [
            {
              productId: rm.rawMaterialId,
              description: rm.materialName,
              uom: rm.baseUom,
              quantity: 100,
              unitPrice: 40,
            },
          ],
        }) as any,
        actor
      )
    );
    expect(grn.grnNumber).toBeTruthy();

    const balance = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(balance.quantity).toBe(100);
    expect(balance.avgRate).toBe(40);
    expect(balance.value).toBe(4000);

    // Cancelling the GRN reverses the valuation entry it raised — a reversal row, not a delete.
    await asDemoTenant(() =>
      grnInvoiceService.cancelGrnInvoice(grn.id, { userId: ownerUser.userId }, "test reversal")
    );
    const afterCancel = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(afterCancel.quantity).toBe(0);
    expect(afterCancel.value).toBe(0);

    const ledger = await asDemoTenant(() =>
      valuationService.ledger({ itemType: "RAW_MATERIAL", itemId: rm.rawMaterialId })
    );
    expect(ledger.some((e) => e.kind === "ADJUSTMENT" && e.reversedEntryId)).toBe(true);
  });

  it("a production issue leaves at the average and a wastage issues at the average too", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-ISS-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 0 as any,
    });
    const product = await createProduct();

    // Two receipts at different rates, so the average is neither. Dated in the past (rather than
    // the wiring package's usual fictional-future dates) because the production-order issue below
    // is recorded at the real "now" — the ledger orders by that business date, so these have to
    // sort before it.
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2020-01-01",
        kind: "RECEIPT",
        quantity: 100,
        rate: 50,
      })
    );
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2020-01-02",
        kind: "RECEIPT",
        quantity: 100,
        rate: 60,
      })
    );
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      await prisma.rawMaterial.update({
        where: { id: rm.id },
        data: { onHandQty: 200 as any },
      });
    });

    const poId = `PO-${sfx}`;
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      const company = await prisma.company.findFirstOrThrow();
      await prisma.productionOrder.create({
        data: {
          productionOrderId: poId,
          companyId: company.id,
          orderDate: new Date("2034-01-03"),
          productItemId: product.id,
          targetQty: 10 as any,
          uom: "NOS",
          dueDate: new Date("2034-02-01"),
          status: "READY_FOR_PLANNING",
          sourceStoreId: STORE,
        },
      });
    });

    await asDemoTenant(() =>
      productionOrderService.issueMaterials(
        poId,
        { items: [{ rawMaterialId: rm.rawMaterialId, storeId: STORE, qty: 40 }] },
        ownerUser.userId
      )
    );

    // 200 at 55 average; 40 issued must leave at 55, not at 60 (the last receipt).
    const afterIssue = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(afterIssue.quantity).toBe(160);
    expect(afterIssue.avgRate).toBe(55);

    const wip = await asDemoTenant(() => wipService.wipFor(poId));
    expect(wip.open).toBe(true);
    expect(wip.value).toBe(2200); // 40 * 55

    // Closing the order (dispatch) drops the WIP to zero.
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      const company = await prisma.company.findFirstOrThrow();
      await prisma.productionOrder.update({
        where: { companyId_productionOrderId: { companyId: company.id, productionOrderId: poId } },
        data: { status: "DISPATCHED" },
      });
    });
    const wipAfter = await asDemoTenant(() => wipService.wipFor(poId));
    expect(wipAfter.open).toBe(false);
    expect(wipAfter.value).toBe(0);

    // Wastage: approving a wastage log issues the wasted material at the running average.
    const machine = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.machine.findFirst();
    });
    const shift = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.shift.findFirst();
    });
    if (machine && shift) {
      const wastage = await asDemoTenant(() =>
        productionWastageService.create(
          {
            wastageDate: "2034-01-04",
            productionOrderId: poId,
            machineId: machine.machineId,
            shiftId: shift.shiftCode,
            productId: String(product.id),
            rawMaterialId: rm.rawMaterialId,
            storeId: STORE,
            wastageType: "RAW_MATERIAL_WASTE" as any,
            quantity: 5,
            uom: rm.baseUom,
          } as any,
          ownerUser.userId
        )
      );
      await asDemoTenant(() => productionWastageService.approve(wastage.id, ownerUser.userId));
      const afterWastage = await asDemoTenant(() =>
        valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
      );
      expect(afterWastage.quantity).toBe(155);
      expect(afterWastage.avgRate).toBe(55);
    }
  });

  it("a stock adjustment values a positive line at the entered cost and a negative one at the average", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-ADJ-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 0 as any,
    });
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2034-01-01",
        kind: "RECEIPT",
        quantity: 100,
        rate: 20,
      })
    );

    const adj = await asDemoTenant(() =>
      StockAdjustmentService.createStockAdjustment(
        {
          adjustmentNumber: `ADJ-${sfx}`,
          adjustmentDate: "2034-01-06",
          adjustmentType: "STOCK_INCREASE",
          reason: "test",
          items: [
            {
              itemType: "RAW_MATERIAL",
              rawMaterialId: rm.rawMaterialId,
              storeId: STORE,
              currentQty: 100,
              adjustedQty: 130,
              difference: 30,
              unitCost: 25,
            },
          ],
        },
        ownerUser.userId
      )
    );
    await asDemoTenant(() =>
      StockAdjustmentService.approveStockAdjustment(adj.id, "APPROVED", undefined, ownerUser.userId)
    );

    const afterIncrease = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    // 100 at 20 (2,000) plus 30 at the entered 25 (750): 2,750 over 130.
    expect(afterIncrease.quantity).toBe(130);
    expect(afterIncrease.value).toBe(2750);

    const adj2 = await asDemoTenant(() =>
      StockAdjustmentService.createStockAdjustment(
        {
          adjustmentNumber: `ADJ2-${sfx}`,
          adjustmentDate: "2034-01-07",
          adjustmentType: "STOCK_DECREASE",
          reason: "test",
          items: [
            {
              itemType: "RAW_MATERIAL",
              rawMaterialId: rm.rawMaterialId,
              storeId: STORE,
              currentQty: 130,
              adjustedQty: 110,
              difference: -20,
            },
          ],
        },
        ownerUser.userId
      )
    );
    await asDemoTenant(() =>
      StockAdjustmentService.approveStockAdjustment(
        adj2.id,
        "APPROVED",
        undefined,
        ownerUser.userId
      )
    );
    const afterDecrease = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    // A negative adjustment always leaves at the average (2,750/130 ≈ 21.1538), never at a rate
    // the caller supplies.
    expect(afterDecrease.quantity).toBe(110);
    expect(Math.round(afterDecrease.avgRate * 10000)).toBe(Math.round((2750 / 130) * 10000));
  });

  it("a bill of entry raises the average by the landed cost apportioned to the line", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-BOE-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 0 as any,
    });
    const grn = await asDemoTenant(() =>
      grnInvoiceService.createGrnInvoice(
        grnBody({
          items: [
            {
              productId: rm.rawMaterialId,
              description: rm.materialName,
              uom: rm.baseUom,
              quantity: 100,
              unitPrice: 100,
            },
          ],
        }) as any,
        actor
      )
    );

    const before = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(before.value).toBe(10000); // 100 * 100

    await asDemoTenant(() =>
      importsService.create(
        {
          beNumber: `BE-${sfx}`,
          beDate: "2034-01-06",
          grnInvoiceId: grn.id,
          exchangeRate: 83,
          foreignValue: 100,
          assessableValue: 8300,
          basicDuty: 830,
          otherCharges: 170,
        },
        { userId: ownerUser.userId }
      )
    );

    const after = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    // Landed cost is 8300 + 830 + 0 + 170 = 9300, all on the one line (100 qty).
    expect(after.quantity).toBe(100);
    expect(after.value).toBe(10000 + 9300);
    expect(after.avgRate).toBe((10000 + 9300) / 100);
  });

  it("a job-work challan out then in leaves the store quantity unchanged and the job-work location at zero", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-JW-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 0 as any,
    });
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2034-01-01",
        kind: "RECEIPT",
        quantity: 50,
        rate: 30,
      })
    );

    const jobWorker = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.jobWorker.create({
        data: { code: `JW-${sfx}`, name: "Test Job Worker" },
      });
    });

    const challan = await asDemoTenant(() =>
      jobWorkService.create(
        {
          kind: "JOB_WORK_OUT" as any,
          challanDate: "2034-01-08",
          jobWorkerId: jobWorker.id,
          storeId: STORE,
          items: [{ rawMaterialId: rm.rawMaterialId, uom: rm.baseUom, quantity: 20 }],
        },
        { userId: ownerUser.userId }
      )
    );

    const storeAfterOut = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(storeAfterOut.quantity).toBe(30);
    const jobWorkAfterOut = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, JOB_WORK_STORE_ID)
    );
    expect(jobWorkAfterOut.quantity).toBe(20);

    const item = challan.items[0];
    await asDemoTenant(() =>
      jobWorkService.receive(
        challan.id,
        { receivedOn: "2034-01-09", lines: [{ itemId: item.id, returned: 20 }] },
        { userId: ownerUser.userId }
      )
    );

    const storeAfterIn = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(storeAfterIn.quantity).toBe(50); // Back to where it started.
    const jobWorkAfterIn = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, JOB_WORK_STORE_ID)
    );
    expect(jobWorkAfterIn.quantity).toBe(0);
  });

  it("a return challan against an out challan moves the goods back into the store in one step", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-JWR-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 0 as any,
    });
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2034-02-01",
        kind: "RECEIPT",
        quantity: 40,
        rate: 25,
      })
    );
    const jobWorker = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.jobWorker.create({
        data: { code: `JWR-${sfx}`, name: "Return Job Worker" },
      });
    });
    const out = await asDemoTenant(() =>
      jobWorkService.create(
        {
          kind: "JOB_WORK_OUT" as any,
          challanDate: "2034-02-05",
          jobWorkerId: jobWorker.id,
          storeId: STORE,
          items: [{ rawMaterialId: rm.rawMaterialId, uom: rm.baseUom, quantity: 15 }],
        },
        { userId: ownerUser.userId }
      )
    );
    await asDemoTenant(() =>
      jobWorkService.create(
        {
          kind: "JOB_WORK_RETURN" as any,
          challanDate: "2034-02-12",
          jobWorkerId: jobWorker.id,
          parentChallanId: out.id,
          storeId: STORE,
          items: [
            {
              rawMaterialId: rm.rawMaterialId,
              uom: rm.baseUom,
              quantity: 12,
              scrap: 3,
              parentItemId: out.items[0].id,
            },
          ],
        } as any,
        { userId: ownerUser.userId }
      )
    );
    const store = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(store.quantity).toBe(37); // 40 out of which 15 went, 12 came back, 3 were scrapped.
    const jobWork = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, JOB_WORK_STORE_ID)
    );
    expect(jobWork.quantity).toBe(0);
  });

  it("backfills historical raw-material transactions idempotently", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-BF-${sfx}`,
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
          qty: 75,
          txnDateTime: new Date("2033-12-01"),
          remarks: "Pre-wiring history",
        },
      });
    });

    const before = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(before.quantity).toBe(0);

    const first = await asDemoTenant(() => valuationService.backfill({ userId: ownerUser.userId }));
    expect(first.created).toBeGreaterThan(0);

    const after = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(after.quantity).toBe(75);
    expect(after.avgRate).toBe(12);

    // Idempotent: a second run neither duplicates this item's row nor changes the balance.
    const second = await asDemoTenant(() =>
      valuationService.backfill({ userId: ownerUser.userId })
    );
    expect(second.created).toBe(0);
    const stillAfter = await asDemoTenant(() =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(stillAfter.quantity).toBe(75);
    expect(stillAfter.value).toBe(after.value);
  });

  it("keeps a tenant's valuation ledger invisible to a foreign company", async () => {
    const rm = await createRawMaterial({
      rawMaterialId: `RM-XT-${sfx}`,
      storeId: STORE,
      onHandQty: 0 as any,
      rate: 0 as any,
    });
    await asDemoTenant(() =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rm.rawMaterialId,
        storeId: STORE,
        movedOn: "2034-01-09",
        kind: "RECEIPT",
        quantity: 10,
        rate: 5,
      })
    );

    const tenantB = await seedTenant({
      companyCode: `P204B-${sfx}`,
      companyName: "P2-04 Tenant B",
      slug: `p204b${sfx}`,
      globalPrefix: `P204B${sfx}`,
      password: "Test@12345678",
    });

    const seenFromB = await runAsTenant(tenantB.id, () =>
      valuationService.balanceAt("RAW_MATERIAL", rm.rawMaterialId, STORE)
    );
    expect(seenFromB.quantity).toBe(0);
    expect(seenFromB.value).toBe(0);

    const ledgerFromB = await runAsTenant(tenantB.id, () =>
      valuationService.ledger({ itemType: "RAW_MATERIAL", itemId: rm.rawMaterialId })
    );
    expect(ledgerFromB.length).toBe(0);
  });
});
