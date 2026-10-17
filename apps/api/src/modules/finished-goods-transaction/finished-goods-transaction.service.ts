import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  CreateFinishedGoodsTransactionInput,
  UpdateFinishedGoodsTransactionInput,
} from "./finished-goods-transaction.validation";
import { byCode } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Moves a finished-goods stock row by `delta` with a database-side increment (no read-modify-write),
 * creating the row when the first receipt arrives. A concurrent first receipt that loses the
 * insert race retries as an increment.
 */
async function adjustFgStock(
  tx: Prisma.TransactionClient,
  storeId: string,
  productItemId: bigint,
  delta: number,
  createIfMissing = true
) {
  const bump = () =>
    tx.finishedGoodsStock.updateMany({
      where: { storeId, productItemId },
      data: { onHandQty: { increment: delta } },
    });
  if ((await bump()).count > 0 || !createIfMissing) return;
  try {
    await tx.$executeRaw`SAVEPOINT fg_stock_create`;
    await tx.finishedGoodsStock.create({ data: { storeId, productItemId, onHandQty: delta } });
    await tx.$executeRaw`RELEASE SAVEPOINT fg_stock_create`;
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT fg_stock_create`;
    await bump();
  }
}

class FinishedGoodsTransactionService {
  async create(data: CreateFinishedGoodsTransactionInput, userId?: string) {
    const productItemId = BigInt(data.productItemId);

    // Verify store exists
    const store = await prisma.store.findUnique({
      where: byCode("storeId", data.storeId),
    });
    if (!store) {
      throw new ApiError(404, `Store with ID ${data.storeId} not found`);
    }

    // Verify product exists
    const product = await prisma.product.findUnique({
      where: { id: productItemId },
    });
    if (!product) {
      throw new ApiError(404, `Product with ID ${productItemId.toString()} not found`);
    }

    // Verify production order exists if provided
    if (data.productionOrderId) {
      const productionOrder = await prisma.productionOrder.findUnique({
        where: byCode("productionOrderId", data.productionOrderId),
      });
      if (!productionOrder) {
        throw new ApiError(404, `Production Order with ID ${data.productionOrderId} not found`);
      }
    }

    // Run in a database transaction to ensure ledger consistency
    return prisma.$transaction(async (tx) => {
      // 1. Create the transaction record
      const txn = await tx.finishedGoodsTransaction.create({
        data: {
          txnDateTime: new Date(data.txnDateTime),
          storeId: data.storeId,
          productItemId,
          txnType: data.txnType,
          qty: data.qty,
          productionOrderId: data.productionOrderId,
          deliveryChallanId: data.deliveryChallanId,
          invoiceId: data.invoiceId,
          relatedDocNo: data.relatedDocNo,
          remarks: data.remarks,
          createdBy: userId,
        },
        include: {
          store: true,
          product: true,
          productionOrder: true,
        },
      });

      // 2. Increment the corresponding Finished Goods Stock entry (created on first receipt)
      await adjustFgStock(tx, data.storeId, productItemId, data.qty);

      return txn;
    });
  }

  async findAll() {
    return prisma.finishedGoodsTransaction.findMany({
      include: {
        store: true,
        product: true,
        productionOrder: true,
      },
      orderBy: {
        txnDateTime: "desc",
      },
    });
  }

  async findById(fgTxnId: bigint) {
    const txn = await prisma.finishedGoodsTransaction.findUnique({
      where: { fgTxnId },
      include: {
        store: true,
        product: true,
        productionOrder: true,
      },
    });

    if (!txn) {
      throw new ApiError(404, `Transaction with ID ${fgTxnId.toString()} not found`);
    }

    return txn;
  }

  async update(fgTxnId: bigint, data: UpdateFinishedGoodsTransactionInput) {
    const existing = await this.findById(fgTxnId);

    // If quantity or storeId or productItemId changes, we must adjust stocks.
    // To keep it simple and robust, we reverse the old transaction qty, and apply the new qty.
    const newStoreId = data.storeId ?? existing.storeId;
    const newProductItemId = data.productItemId
      ? BigInt(data.productItemId)
      : existing.productItemId;
    const newQty = data.qty ?? Number(existing.qty);

    return prisma.$transaction(async (tx) => {
      // 1. Reverse old stock adjustment (only if the old row exists)
      await adjustFgStock(
        tx,
        existing.storeId,
        existing.productItemId,
        -Number(existing.qty),
        false
      );

      // 2. Apply new stock adjustment
      await adjustFgStock(tx, newStoreId, newProductItemId, newQty);

      // 3. Update the transaction
      return tx.finishedGoodsTransaction.update({
        where: { fgTxnId },
        data: {
          txnDateTime: data.txnDateTime ? new Date(data.txnDateTime) : undefined,
          storeId: data.storeId,
          productItemId: data.productItemId ? BigInt(data.productItemId) : undefined,
          txnType: data.txnType,
          qty: data.qty,
          productionOrderId: data.productionOrderId,
          deliveryChallanId: data.deliveryChallanId,
          invoiceId: data.invoiceId,
          relatedDocNo: data.relatedDocNo,
          remarks: data.remarks,
        },
        include: {
          store: true,
          product: true,
          productionOrder: true,
        },
      });
    });
  }

  async delete(fgTxnId: bigint) {
    const existing = await this.findById(fgTxnId);

    return prisma.$transaction(async (tx) => {
      // Reverse stock adjustment on delete
      await adjustFgStock(
        tx,
        existing.storeId,
        existing.productItemId,
        -Number(existing.qty),
        false
      );

      return tx.finishedGoodsTransaction.delete({
        where: { fgTxnId },
      });
    });
  }
}

export default new FinishedGoodsTransactionService();
