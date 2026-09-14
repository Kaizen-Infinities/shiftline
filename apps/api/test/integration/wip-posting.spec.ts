import { beforeAll, describe, expect, it } from "vitest";

import { api, authed, SEED_PASSWORD } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { runAsTenant } from "../../src/lib/tenant-context";
import { seedTenant } from "../../prisma/seed-lib";
import productionOrderService from "../../src/modules/production-order/production-order.service";
import { valuationService } from "../../src/modules/costing/valuation.service";
import { wipService } from "../../src/modules/costing/wip.service";

/**
 * Posting work in progress to the books (P2-14).
 *
 * P2-04 gave WIP a real figure — material issued to an open production order — and reported it
 * alongside the closing-stock posting without ever booking it. This closes that gap: the WIP
 * ledger carries the current total, the change since what was last posted moves Dr WIP / Cr
 * Closing Stock (or back, when WIP falls), and the blended stock ledger ends up reading as
 * valuation minus WIP rather than silently short by whatever is on the shop floor.
 *
 * A dedicated tenant, not the shared demo one, so the WIP ledger starts at zero and nothing this
 * spec asserts about its balance can be disturbed by another spec file's production orders.
 *
 * Periods are computed off the real clock rather than a fictional year: a production issue is
 * always dated "now" (production-order.service.ts), and the valuation ledger picks its "closing"
 * balance by the *latest movedOn*, not by insertion order — a fictional future receipt would
 * outrank a real-"now" issue and the closing figure would silently ignore it. Real, increasing
 * dates keep that ordering sane.
 */
const sfx = Date.now().toString(36).slice(-6);
const SLUG = `p214${sfx}`;
const STORE = "ST-RM";
const n2 = (v: number) => Math.round(v * 100) / 100;

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
const addMonths = (d: Date, delta: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
const lastDayOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));

const now = new Date();
const p1 = addMonths(now, 0);
const p2 = addMonths(now, 1);
const p3 = addMonths(now, 2);
const pClosed = addMonths(now, 3);

let companyId: string;
let ownerUserId: string;
let owner: { auth: Record<string, string> };
let production: { auth: Record<string, string> };

const post = async (period: Date, auth: Record<string, string>) =>
  (await api())
    .post(`/api/costing/valuation/${monthKey(period)}/post-closing-stock`)
    .set(auth)
    .send({});

const journalItemsOf = (voucherId: number) =>
  runAsTenant(companyId, async () => {
    const prisma = await getPrisma();
    return prisma.journalItem.findMany({ where: { voucherId } });
  });

const ledgerByCode = (code: string) =>
  runAsTenant(companyId, async () => {
    const prisma = await getPrisma();
    return prisma.accountLedger.findFirst({ where: { code } });
  });

/** A ledger's booked balance (debit − credit) up to a date, POSTED vouchers only — same rule the
 *  posting itself uses, so the test checks the acceptance identity directly rather than trusting
 *  the code under test to have got its own arithmetic right. */
const ledgerBalanceAsOf = (ledgerId: number, asOn: Date) =>
  runAsTenant(companyId, async () => {
    const prisma = await getPrisma();
    const where = { voucher: { date: { lte: asOn }, status: "POSTED" as const } };
    const [d, c] = await Promise.all([
      prisma.journalItem.aggregate({
        where: { debitLedgerId: ledgerId, ...where },
        _sum: { debitAmount: true },
      }),
      prisma.journalItem.aggregate({
        where: { creditLedgerId: ledgerId, ...where },
        _sum: { creditAmount: true },
      }),
    ]);
    return n2(Number(d._sum.debitAmount ?? 0) - Number(c._sum.creditAmount ?? 0));
  });

describe("posting WIP to the books", () => {
  const rmId = `RM-WIP-${sfx}`;
  const poId1 = `PO-WIP1-${sfx}`;
  let productId: bigint;

  beforeAll(async () => {
    const company = await seedTenant({
      companyCode: `P214-${sfx}`,
      companyName: "P2-14 WIP Tenant",
      slug: SLUG,
      globalPrefix: `P214${sfx}`,
      password: SEED_PASSWORD,
    });
    companyId = company.id;
    owner = await authed(`${SLUG}.owner`);
    production = await authed(`${SLUG}.production`);
    ownerUserId = await runAsTenant(companyId, async () => {
      const prisma = await getPrisma();
      const u = await prisma.user.findUniqueOrThrow({ where: { username: `${SLUG}.owner` } });
      return u.userId;
    });
    await runAsTenant(companyId, async () => {
      const prisma = await getPrisma();
      await prisma.store.create({
        data: { storeId: STORE, storeName: "Raw Material Store", createdBy: ownerUserId },
      });
      await prisma.rawMaterial.create({
        data: {
          rawMaterialId: rmId,
          materialName: "WIP test material",
          baseUom: "KG",
          rate: 0 as any,
          onHandQty: 0 as any,
          storeId: STORE,
          createdBy: ownerUserId,
        },
      });
      const nos = await prisma.unitOfMeasure.findFirstOrThrow({ where: { uomCode: "NOS" } });
      const product = await prisma.product.create({
        data: {
          productCode: `P-WIP-${sfx}`,
          productName: "WIP test product",
          uomId: nos.id,
          rate: 500 as any,
          createdBy: ownerUserId,
        },
      });
      productId = product.id;
    });
  });

  it("gives a new tenant a WIP ledger on provisioning", async () => {
    const wip = await ledgerByCode("WIP");
    expect(wip).toBeTruthy();
    expect(wip?.name).toBe("Work in Progress");
    expect(wip?.type).toBe("ASSET");
  });

  it("reads the default costing setting without ever visiting it", async () => {
    const res = await (await api()).get("/api/costing/settings").set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.wipLedgerCode).toBe("WIP");
  });

  it("moves issued material into WIP when closing stock is posted", async () => {
    await runAsTenant(companyId, () =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rmId,
        storeId: STORE,
        movedOn: p1, // the first of the period, so it counts as "closing", not "opening"
        kind: "RECEIPT",
        quantity: 100,
        rate: 50,
      })
    );
    await runAsTenant(companyId, async () => {
      const prisma = await getPrisma();
      const rm = await prisma.rawMaterial.findFirst({ where: { rawMaterialId: rmId } });
      await prisma.rawMaterial.update({ where: { id: rm!.id }, data: { onHandQty: 100 as any } });
      await prisma.productionOrder.create({
        data: {
          productionOrderId: poId1,
          companyId,
          orderDate: now,
          productItemId: productId,
          targetQty: 10 as any,
          uom: "NOS",
          dueDate: lastDayOfMonth(p2),
          status: "READY_FOR_PLANNING",
          sourceStoreId: STORE,
        },
      });
    });

    await runAsTenant(companyId, () =>
      productionOrderService.issueMaterials(
        poId1,
        { items: [{ rawMaterialId: rmId, storeId: STORE, qty: 40 }] },
        ownerUserId
      )
    );

    const wip = await runAsTenant(companyId, () => wipService.wipFor(poId1));
    expect(wip.value).toBe(2000); // 40 * 50

    const res = await post(p1, owner.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const body = res.body.data as {
      posted: boolean;
      opening: number;
      closing: number;
      movement: number;
      wip: number;
      voucherId: number;
    };
    expect(body.posted).toBe(true);
    expect(body.wip).toBe(2000);

    const wipLedger = await ledgerByCode("WIP");
    const stockLedger = await ledgerByCode("STOCK-001");
    const periodEnd = lastDayOfMonth(p1);

    // The two identities the spec asks for: the WIP ledger carries the current total, and the
    // blended stock ledger reads as valuation minus WIP.
    expect(await ledgerBalanceAsOf(wipLedger!.id, periodEnd)).toBe(body.wip);
    expect(await ledgerBalanceAsOf(stockLedger!.id, periodEnd)).toBe(n2(body.closing - body.wip));

    // The WIP leg is a straight transfer out of the blended stock ledger: Dr WIP / Cr Closing
    // Stock for the same amount.
    const items = await journalItemsOf(body.voucherId);
    const wipDebit = items.find((i) => i.debitLedgerId === wipLedger!.id);
    expect(Number(wipDebit?.debitAmount)).toBe(2000);
    const stockCreditForWip = items.find(
      (i) => i.creditLedgerId === stockLedger!.id && Number(i.creditAmount) === 2000
    );
    expect(stockCreditForWip).toBeTruthy();
  });

  it("does not post twice for the same period", async () => {
    const again = await post(p1, owner.auth);
    expect(again.status).toBe(200);
    expect(again.body.data.posted).toBe(false);
  });

  it("moves WIP back out when the order completes and the next period is posted", async () => {
    await runAsTenant(companyId, async () => {
      const prisma = await getPrisma();
      await prisma.productionOrder.update({
        where: { companyId_productionOrderId: { companyId, productionOrderId: poId1 } },
        data: { status: "DISPATCHED" },
      });
    });
    const wipAfter = await runAsTenant(companyId, () => wipService.wipFor(poId1));
    expect(wipAfter.value).toBe(0);

    const res = await post(p2, owner.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const body = res.body.data as { posted: boolean; wip: number; closing: number };
    // Nothing else moved this period, but WIP falling to zero is itself enough to post.
    expect(body.posted).toBe(true);
    expect(body.wip).toBe(0);

    const wipLedger = await ledgerByCode("WIP");
    const stockLedger = await ledgerByCode("STOCK-001");
    const periodEnd = lastDayOfMonth(p2);
    expect(await ledgerBalanceAsOf(wipLedger!.id, periodEnd)).toBe(0);
    expect(await ledgerBalanceAsOf(stockLedger!.id, periodEnd)).toBe(n2(body.closing));
  });

  it("refuses an unknown WIP ledger code and honours a changed one", async () => {
    const bad = await (
      await api()
    )
      .put("/api/costing/settings")
      .set(owner.auth)
      .send({ wipLedgerCode: `NOPE${sfx}` });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("UNKNOWN_LEDGER");

    const altCode = `WIPALT${sfx}`.toUpperCase().slice(0, 20);
    const createLedger = await (
      await api()
    )
      .post("/api/accounts/ledgers")
      .set(owner.auth)
      .send({ code: altCode, name: "Alt WIP", type: "ASSET", group: "Stock-in-Hand" });
    expect(createLedger.status, JSON.stringify(createLedger.body).slice(0, 300)).toBe(201);

    const saved = await (
      await api()
    )
      .put("/api/costing/settings")
      .set(owner.auth)
      .send({ wipLedgerCode: altCode });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect(saved.body.data.wipLedgerCode).toBe(altCode);

    // A second order so period 3 carries a fresh WIP movement, posted against the new ledger.
    const poId2 = `PO-WIP2-${sfx}`;
    await runAsTenant(companyId, async () => {
      const prisma = await getPrisma();
      await prisma.productionOrder.create({
        data: {
          productionOrderId: poId2,
          companyId,
          orderDate: now,
          productItemId: productId,
          targetQty: 5 as any,
          uom: "NOS",
          dueDate: lastDayOfMonth(p3),
          status: "READY_FOR_PLANNING",
          sourceStoreId: STORE,
        },
      });
    });
    await runAsTenant(companyId, () =>
      productionOrderService.issueMaterials(
        poId2,
        { items: [{ rawMaterialId: rmId, storeId: STORE, qty: 20 }] },
        ownerUserId
      )
    );

    const res = await post(p3, owner.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.posted).toBe(true);
    const body = res.body.data as { wip: number };

    const items = await journalItemsOf(res.body.data.voucherId);
    const altLedger = await ledgerByCode(altCode);
    const originalWip = await ledgerByCode("WIP");
    expect(items.some((i) => i.debitLedgerId === altLedger!.id)).toBe(true);
    expect(
      items.some((i) => i.debitLedgerId === originalWip!.id || i.creditLedgerId === originalWip!.id)
    ).toBe(false);

    const periodEnd = lastDayOfMonth(p3);
    expect(await ledgerBalanceAsOf(altLedger!.id, periodEnd)).toBe(body.wip);
    // The original WIP ledger is untouched by a period posted under the new setting.
    expect(await ledgerBalanceAsOf(originalWip!.id, periodEnd)).toBe(0);
  });

  it("refuses posting into a closed period", async () => {
    const periodName = `WIP test ${monthKey(pClosed)}`;
    const start = new Date(Date.UTC(pClosed.getUTCFullYear(), pClosed.getUTCMonth(), 1));
    const created = await (
      await api()
    )
      .post("/api/accounts/periods")
      .set(owner.auth)
      .send({
        periodName,
        startDate: start.toISOString().slice(0, 10),
        endDate: lastDayOfMonth(pClosed).toISOString().slice(0, 10),
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const periodId = created.body.data.id;
    expect(
      (await (await api()).post(`/api/accounts/periods/${periodId}/close`).set(owner.auth)).status
    ).toBe(200);

    // Something to post, so the refusal comes from the period gate and not "nothing changed".
    await runAsTenant(companyId, () =>
      valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: rmId,
        storeId: STORE,
        movedOn: new Date(start.getTime() + 4 * 86400000),
        kind: "RECEIPT",
        quantity: 10,
        rate: 50,
      })
    );

    const refused = await post(pClosed, owner.auth);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("PERIOD_CLOSED");

    await (await api()).post(`/api/accounts/periods/${periodId}/reopen`).set(owner.auth);
  });

  it("refuses a user without the costing permission", async () => {
    const res = await (await api()).get("/api/costing/settings").set(production.auth);
    expect(res.status).toBe(403);
    const res2 = await post(p1, production.auth);
    expect(res2.status).toBe(403);
  });

  it("keeps the WIP ledger and setting invisible to a foreign tenant", async () => {
    const other = await seedTenant({
      companyCode: `P214B-${sfx}`,
      companyName: "P2-14 Tenant B",
      slug: `p214b${sfx}`,
      globalPrefix: `P214B${sfx}`,
      password: SEED_PASSWORD,
    });

    const prisma = await getPrisma();
    const settingsFromB = await runAsTenant(other.id, () => prisma.costingSetting.count());
    expect(settingsFromB).toBe(0);

    const wipFromB = await runAsTenant(other.id, () =>
      prisma.accountLedger.findFirst({ where: { code: "WIP" } })
    );
    const wipFromA = await ledgerByCode("WIP");
    expect(wipFromB?.id).not.toBe(wipFromA?.id);

    const journalFromB = await runAsTenant(other.id, () =>
      prisma.journalItem.count({ where: { debitLedgerId: wipFromA!.id } })
    );
    expect(journalFromB).toBe(0);
  });
});
