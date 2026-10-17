import { describe, expect, it } from "vitest";

import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";
import rawMaterialStockService from "../../src/modules/raw-material-stock/raw-material-stock.service";
import finishedGoodsTransactionService from "../../src/modules/finished-goods-transaction/finished-goods-transaction.service";

/** Stock quantities move by database-side increments/guards, so concurrent requests cannot lose updates. */
describe("stock concurrency", () => {
  it("concurrent purchase-return deductions never overdraw raw material stock", async () => {
    const rm = await createRawMaterial({ onHandQty: 100 });
    const deduct = () =>
      asDemoTenant(() =>
        rawMaterialStockService.deductForPurchaseReturn(
          [{ rawMaterialId: rm.rawMaterialId, quantity: 40, storeId: "ST-RM" }],
          "PR-CONC"
        )
      );

    const results = await Promise.allSettled([deduct(), deduct(), deduct()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.statusCode ?? rejected[0].reason.status).toBe(400);

    const prisma = await getPrisma();
    const after = await asDemoTenant(() =>
      prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: rm.rawMaterialId } })
    );
    expect(Number(after.onHandQty)).toBe(20);
  });

  it("concurrent finished-goods receipts all land on the stock row", async () => {
    const product = await createProduct();
    const receipt = () =>
      asDemoTenant(() =>
        finishedGoodsTransactionService.create({
          txnDateTime: new Date().toISOString(),
          storeId: "ST-RM",
          productItemId: Number(product.id),
          txnType: "PRODUCTION_RECEIPT",
          qty: 10,
        } as never)
      );

    await Promise.all([receipt(), receipt(), receipt()]);

    const prisma = await getPrisma();
    const stock = await asDemoTenant(() =>
      prisma.finishedGoodsStock.findFirstOrThrow({
        where: { storeId: "ST-RM", productItemId: product.id },
      })
    );
    expect(Number(stock.onHandQty)).toBe(30);
  });
});
