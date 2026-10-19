import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { foreignTenant } from "../helpers/foreign-tenant";
import { asDemoTenant, createCustomer, createProduct } from "../factories";

/**
 * A goods return takes the returned units back into finished-goods stock at the store the
 * invoice dispatched from, through a movement record; cancelling the return takes them out again.
 * A price adjustment moves no stock.
 */
describe("sales return stock", () => {
  it("a goods return puts the returned units back, and cancelling it removes them again", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const customer = await createCustomer({
      gstin: "33AAAAA0000A1Z9",
      gstRegType: "REGULAR",
      stateCode: "33",
    });
    // The invoice confirm now refuses lines without HSN/GST rate, so the product carries both.
    const hsn = await asDemoTenant(() =>
      prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } })
    );
    const product = await createProduct({ gstRate: 18, hsnCodeId: hsn.id });
    const store = await asDemoTenant(() => prisma.store.findFirstOrThrow());
    const stockKey = { storeId: store.storeId, productItemId: product.id };
    const onHand = async () =>
      Number(
        (
          await asDemoTenant(() =>
            prisma.finishedGoodsStock.findUniqueOrThrow({
              where: { storeId_productItemId: stockKey },
            })
          )
        ).onHandQty
      );
    await asDemoTenant(() =>
      prisma.finishedGoodsStock.create({ data: { ...stockKey, onHandQty: 394 } })
    );

    // Invoice 7 units: 394 -> 387.
    const inv = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-07",
        customerId: customer.id,
        items: [{ productId: product.id.toString(), qty: 7, rate: 100 }],
      });
    expect(inv.status).toBe(201);
    const invoice = inv.body.data;
    expect(await onHand()).toBe(387);

    // Return 2 units of that line: 387 -> 389, with a stock adjustment and a movement record.
    const ret = await (
      await api()
    )
      .post("/api/returns/sales")
      .set(owner.auth)
      .send({
        customerId: customer.id,
        salesInvoiceId: invoice.id,
        kind: "GOODS_RETURN",
        reason: "Goods return",
        items: [
          {
            productId: Number(product.id),
            salesInvoiceItemId: invoice.items[0].id,
            quantity: 2,
            unitPrice: 100,
          },
        ],
      });
    expect(ret.status).toBe(201);
    const returnId: string = ret.body.data.id;
    expect(await onHand()).toBe(389);

    // Another company cannot cancel this return, so its stock stays where it is.
    const foreign = await foreignTenant("xsrs");
    const foreignCancel = await (
      await api()
    )
      .post(`/api/returns/sales/${returnId}/cancel`)
      .set(foreign.auth);
    expect(foreignCancel.status).toBe(404);
    expect(await onHand()).toBe(389);

    const adjustment = await asDemoTenant(() =>
      prisma.stockAdjustment.findFirstOrThrow({
        where: { sourceDocument: "SALES_RETURN", sourceDocId: returnId },
        include: { items: true },
      })
    );
    expect(adjustment.adjustmentType).toBe("SALES_RETURN");
    expect(adjustment.items).toHaveLength(1);
    expect(adjustment.items[0]).toMatchObject({
      storeId: store.storeId,
      productItemId: product.id,
      itemType: "FINISHED_GOODS",
    });
    expect(Number(adjustment.items[0].difference)).toBe(2);
    const movement = await asDemoTenant(() =>
      prisma.finishedGoodsTransaction.findFirstOrThrow({
        where: { relatedDocNo: adjustment.adjustmentNumber },
      })
    );
    expect(movement).toMatchObject({ txnType: "STOCK_ADJUSTMENT_IN", storeId: store.storeId });
    expect(Number(movement.qty)).toBe(2);

    // A price adjustment corrects value only: no stock moves.
    const priceOnly = await (
      await api()
    )
      .post("/api/returns/sales")
      .set(owner.auth)
      .send({
        customerId: customer.id,
        salesInvoiceId: invoice.id,
        kind: "PRICE_ADJUSTMENT",
        reason: "Rate correction",
        items: [
          {
            productId: Number(product.id),
            salesInvoiceItemId: invoice.items[0].id,
            quantity: 1,
            unitPrice: 10,
          },
        ],
      });
    expect(priceOnly.status).toBe(201);
    expect(await onHand()).toBe(389);

    // Cancelling the goods return takes exactly those 2 units out again: back to the post-invoice level.
    const cancelled = await (
      await api()
    )
      .post(`/api/returns/sales/${returnId}/cancel`)
      .set(owner.auth)
      .send({
        reason: "Entered twice",
      });
    expect(cancelled.status).toBe(200);
    expect(await onHand()).toBe(387);
    const reversal = await asDemoTenant(() =>
      prisma.stockAdjustment.findFirstOrThrow({
        where: { sourceDocument: "SALES_RETURN_REVERSAL", sourceDocId: returnId },
        include: { items: true },
      })
    );
    expect(Number(reversal.items[0].difference)).toBe(-2);

    // Cancelling again is refused and moves nothing.
    const again = await (await api()).post(`/api/returns/sales/${returnId}/cancel`).set(owner.auth);
    expect(again.status).toBe(409);
    expect(await onHand()).toBe(387);
  });
});
