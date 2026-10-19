import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  CreateRawMaterialTransactionInput,
  UpdateRawMaterialTransactionInput,
} from "./raw-material-transaction.validation";
import { byCode } from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import {
  assertNotBelowZero,
  lockRawMaterialRow,
  storeAllowsNegative,
} from "../inventory/on-hand-guard";

/**
 * Moves raw material on-hand by a signed `delta` inside `tx`. The row is locked first, and the
 * movement is refused when it would take on-hand below zero (unless the store allows negative stock).
 */
async function moveOnHand(
  tx: Prisma.TransactionClient,
  rawMaterialId: string,
  storeId: string,
  delta: Decimal
): Promise<void> {
  await lockRawMaterialRow(tx, rawMaterialId);
  const rm = await tx.rawMaterial.findUnique({
    where: byCode("rawMaterialId", rawMaterialId),
  });
  if (!rm) throw new ApiError(404, `Raw Material with ID ${rawMaterialId} not found`);

  assertNotBelowZero({
    label: `Raw material "${rm.materialName}" (${rawMaterialId})`,
    onHand: new Decimal(rm.onHandQty.toString()),
    delta,
    allowNegative: await storeAllowsNegative(tx, storeId),
  });

  await tx.rawMaterial.update({
    where: byCode("rawMaterialId", rawMaterialId),
    data: {
      onHandQty: { increment: delta.toNumber() },
      lastMovementAt: new Date(),
    },
  });
}

class RawMaterialTransactionService {
  async create(data: CreateRawMaterialTransactionInput) {
    // Verify store exists
    const store = await prisma.store.findUnique({
      where: byCode("storeId", data.storeId),
    });
    if (!store) {
      throw new ApiError(404, `Store with ID ${data.storeId} not found`);
    }

    // Verify raw material exists
    const rawMaterial = await prisma.rawMaterial.findUnique({
      where: byCode("rawMaterialId", data.rawMaterialId),
    });
    if (!rawMaterial) {
      throw new ApiError(404, `Raw Material with ID ${data.rawMaterialId} not found`);
    }

    const txnDateTime = data.txnDateTime ? new Date(data.txnDateTime) : new Date();

    return prisma.$transaction(async (tx) => {
      // 1. Create the transaction record
      const txn = await tx.rawMaterialTransaction.create({
        data: {
          storeId: data.storeId,
          rawMaterialId: data.rawMaterialId,
          txnType: data.txnType,
          qty: data.qty,
          txnDateTime,
          remarks: data.remarks,
        },
        include: {
          store: true,
          rawMaterial: true,
        },
      });

      // 2. Update the corresponding Raw Material Stock (which is the RawMaterial itself)
      await moveOnHand(tx, data.rawMaterialId, data.storeId, new Decimal(data.qty));

      return txn;
    });
  }

  async findAll() {
    return prisma.rawMaterialTransaction.findMany({
      include: {
        store: true,
        rawMaterial: true,
      },
      orderBy: {
        txnDateTime: "desc",
      },
    });
  }

  async findById(rmTxnId: bigint) {
    const txn = await prisma.rawMaterialTransaction.findUnique({
      where: { rmTxnId },
      include: {
        store: true,
        rawMaterial: true,
      },
    });

    if (!txn) {
      throw new ApiError(404, `Raw Material Transaction with ID ${rmTxnId.toString()} not found`);
    }

    return txn;
  }

  async update(rmTxnId: bigint, data: UpdateRawMaterialTransactionInput) {
    const existing = await this.findById(rmTxnId);

    const newStoreId = data.storeId ?? existing.storeId;
    const newRawMaterialId = data.rawMaterialId ?? existing.rawMaterialId;
    const newQty = data.qty ?? Number(existing.qty);
    const txnDateTime = data.txnDateTime ? new Date(data.txnDateTime) : existing.txnDateTime;

    // Net change per raw material: the old qty is reversed and the new qty applied. Netting first
    // means a move that is only valid as a whole is not refused halfway through.
    const deltas = new Map<string, Decimal>();
    const addDelta = (rawMaterialId: string, delta: Decimal) =>
      deltas.set(rawMaterialId, (deltas.get(rawMaterialId) ?? new Decimal(0)).plus(delta));
    addDelta(existing.rawMaterialId, new Decimal(existing.qty.toString()).negated());
    addDelta(newRawMaterialId, new Decimal(newQty));

    return prisma.$transaction(async (tx) => {
      // 1 and 2. Reverse the old stock level and apply the new one
      for (const rawMaterialId of [...deltas.keys()].sort()) {
        const delta = deltas.get(rawMaterialId)!;
        if (delta.isZero()) continue;
        await moveOnHand(tx, rawMaterialId, newStoreId, delta);
      }

      // 3. Update transaction entry
      return tx.rawMaterialTransaction.update({
        where: { rmTxnId },
        data: {
          storeId: newStoreId,
          rawMaterialId: newRawMaterialId,
          txnType: data.txnType,
          qty: newQty,
          txnDateTime,
          remarks: data.remarks,
        },
        include: {
          store: true,
          rawMaterial: true,
        },
      });
    });
  }

  async delete(rmTxnId: bigint) {
    const existing = await this.findById(rmTxnId);

    return prisma.$transaction(async (tx) => {
      // Reverse stock level on delete
      await moveOnHand(
        tx,
        existing.rawMaterialId,
        existing.storeId,
        new Decimal(existing.qty.toString()).negated()
      );

      return tx.rawMaterialTransaction.delete({
        where: { rmTxnId },
      });
    });
  }
}

export default new RawMaterialTransactionService();
