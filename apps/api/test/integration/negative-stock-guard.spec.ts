import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial } from "../factories";
import { byCode } from "../../src/lib/prisma";

/**
 * Negative stock guard (QA C06 / C07, INV-B02, R2P-B05, INV-B16).
 *
 * - Stock adjustments (apps/api/src/modules/stock-adjustment) must not take on-hand below zero,
 *   must apply adjustedQty, and must refuse a currentQty that no longer matches the locked stock.
 * - The legacy raw material transaction route (apps/api/src/modules/raw-material-transaction)
 *   must apply the same rule to every movement it posts.
 */
const sfx = randomUUID().slice(0, 6).toUpperCase();
const STORE = "ST-RM";
const D = (n: number | string) => new Prisma.Decimal(n);

let OWNER: { auth: Record<string, string> };

const readOnHand = async (rawMaterialId: string) => {
  const prisma = await getPrisma();
  const rm = await asDemoTenant(() =>
    prisma.rawMaterial.findUniqueOrThrow({ where: byCode("rawMaterialId", rawMaterialId) })
  );
  return Number(rm.onHandQty);
};

const adjustmentCount = async (adjustmentNumber: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() => prisma.stockAdjustment.count({ where: { adjustmentNumber } }));
};

const adjustmentBody = (
  adjustmentNumber: string,
  rawMaterialId: string,
  item: { currentQty: number; adjustedQty: number; difference: number },
  adjustmentType = "STOCK_DECREASE"
) => ({
  adjustmentNumber,
  adjustmentDate: new Date().toISOString(),
  adjustmentType,
  reason: "negative stock guard test",
  status: "APPROVED",
  items: [
    {
      itemType: "RAW_MATERIAL",
      rawMaterialId,
      storeId: STORE,
      remarks: "test",
      ...item,
    },
  ],
});

describe("stock adjustments never take on-hand below zero", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("rejects an approved decrease that would go below zero with 400 and leaves stock unchanged", async () => {
    const rm = await createRawMaterial({ onHandQty: D(65) });
    const number = `ADJ-NEG-${sfx}-1`;

    const res = await (
      await api()
    )
      .post("/api/stock-adjustments")
      .set(OWNER.auth)
      .send(
        adjustmentBody(number, rm.rawMaterialId, {
          currentQty: 65,
          adjustedQty: -35,
          difference: -100,
        })
      );

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(await readOnHand(rm.rawMaterialId)).toBe(65);
    expect(await adjustmentCount(number)).toBe(0);
  });

  it("rejects a stale currentQty naming the item, with 400, and leaves stock unchanged", async () => {
    const rm = await createRawMaterial({ onHandQty: D(65) });
    const number = `ADJ-NEG-${sfx}-2`;

    const res = await (
      await api()
    )
      .post("/api/stock-adjustments")
      .set(OWNER.auth)
      .send(
        adjustmentBody(number, rm.rawMaterialId, {
          currentQty: 999,
          adjustedQty: 10,
          difference: -989,
        })
      );

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(res.body.message ?? "").toContain(rm.rawMaterialId);
    expect(await readOnHand(rm.rawMaterialId)).toBe(65);
    expect(await adjustmentCount(number)).toBe(0);
  });

  it("rejects a difference that does not equal adjustedQty minus currentQty with 400", async () => {
    const rm = await createRawMaterial({ onHandQty: D(65) });
    const number = `ADJ-NEG-${sfx}-3`;

    const res = await (
      await api()
    )
      .post("/api/stock-adjustments")
      .set(OWNER.auth)
      .send(
        adjustmentBody(number, rm.rawMaterialId, {
          currentQty: 65,
          adjustedQty: 40,
          difference: -100,
        })
      );

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(await readOnHand(rm.rawMaterialId)).toBe(65);
    expect(await adjustmentCount(number)).toBe(0);
  });

  it("applies adjustedQty: on-hand ends at the adjusted quantity", async () => {
    const rm = await createRawMaterial({ onHandQty: D(65) });
    const number = `ADJ-NEG-${sfx}-4`;

    const res = await (
      await api()
    )
      .post("/api/stock-adjustments")
      .set(OWNER.auth)
      .send(
        adjustmentBody(number, rm.rawMaterialId, {
          currentQty: 65,
          adjustedQty: 40,
          difference: -25,
        })
      );

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.status ?? res.body.data?.status).toBe("APPROVED");
    expect(await readOnHand(rm.rawMaterialId)).toBe(40);
  });

  it("allows a decrease to exactly zero", async () => {
    const rm = await createRawMaterial({ onHandQty: D(12) });
    const number = `ADJ-NEG-${sfx}-5`;

    const res = await (
      await api()
    )
      .post("/api/stock-adjustments")
      .set(OWNER.auth)
      .send(
        adjustmentBody(number, rm.rawMaterialId, {
          currentQty: 12,
          adjustedQty: 0,
          difference: -12,
        })
      );

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(await readOnHand(rm.rawMaterialId)).toBe(0);
  });
});

describe("legacy raw material transactions never take on-hand below zero", () => {
  afterAll(async () => {
    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.store.update({
        where: byCode("storeId", STORE),
        data: { allowNegative: false },
      })
    );
  });

  it("rejects a negative qty beyond stock with 400, naming the item, and posts nothing", async () => {
    const rm = await createRawMaterial({ onHandQty: D(3) });

    const res = await (
      await api()
    )
      .post("/api/raw-material-transactions")
      .set(OWNER.auth)
      .send({ storeId: STORE, rawMaterialId: rm.rawMaterialId, txnType: "ISSUE", qty: -5 });

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(res.body.message ?? "").toContain(rm.rawMaterialId);
    expect(await readOnHand(rm.rawMaterialId)).toBe(3);

    const prisma = await getPrisma();
    const txns = await asDemoTenant(() =>
      prisma.rawMaterialTransaction.count({ where: { rawMaterialId: rm.rawMaterialId } })
    );
    expect(txns).toBe(0);
  });

  it("applies a valid negative qty within stock", async () => {
    const rm = await createRawMaterial({ onHandQty: D(10) });

    const res = await (
      await api()
    )
      .post("/api/raw-material-transactions")
      .set(OWNER.auth)
      .send({ storeId: STORE, rawMaterialId: rm.rawMaterialId, txnType: "ISSUE", qty: -4 });

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(await readOnHand(rm.rawMaterialId)).toBe(6);
  });

  it("refuses a delete that would reverse a receipt into negative stock", async () => {
    const rm = await createRawMaterial({ onHandQty: D(0) });
    const created = await (
      await api()
    )
      .post("/api/raw-material-transactions")
      .set(OWNER.auth)
      .send({ storeId: STORE, rawMaterialId: rm.rawMaterialId, txnType: "RECEIPT", qty: 10 });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const rmTxnId = created.body.rmTxnId ?? created.body.data?.rmTxnId;

    // Consume 8 of the 10 received so reversing the receipt would leave -2.
    await (
      await api()
    )
      .post("/api/raw-material-transactions")
      .set(OWNER.auth)
      .send({ storeId: STORE, rawMaterialId: rm.rawMaterialId, txnType: "ISSUE", qty: -8 });
    expect(await readOnHand(rm.rawMaterialId)).toBe(2);

    const res = await (
      await api()
    )
      .delete(`/api/raw-material-transactions/${rmTxnId}`)
      .set(OWNER.auth);

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(await readOnHand(rm.rawMaterialId)).toBe(2);
  });

  it("respects the store allowNegative setting when it is switched on", async () => {
    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.store.update({ where: byCode("storeId", STORE), data: { allowNegative: true } })
    );
    const rm = await createRawMaterial({ onHandQty: D(3) });

    const res = await (
      await api()
    )
      .post("/api/raw-material-transactions")
      .set(OWNER.auth)
      .send({ storeId: STORE, rawMaterialId: rm.rawMaterialId, txnType: "ISSUE", qty: -5 });

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(await readOnHand(rm.rawMaterialId)).toBe(-2);
  });
});
