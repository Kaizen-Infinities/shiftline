import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { ApiError } from "../../utils/ApiError";
import { byCode } from "../../lib/prisma";
import { requireTenantId } from "../../lib/tenant-context";

type Tx = Prisma.TransactionClient;

/**
 * Row lock on a raw material for the rest of the transaction. The on-hand read that follows is then
 * the committed value and no concurrent movement can land between that read and the write.
 */
export async function lockRawMaterialRow(tx: Tx, rawMaterialId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM raw_materials
    WHERE company_id = ${requireTenantId()}::uuid AND raw_material_id = ${rawMaterialId}
    FOR UPDATE`;
}

/** Row lock on a finished goods stock row (one row per store and product). */
export async function lockFinishedGoodsRow(tx: Tx, storeId: string, productItemId: bigint): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM finished_goods_stocks
    WHERE company_id = ${requireTenantId()}::uuid AND store_id = ${storeId}
      AND product_item_id = ${productItemId}
    FOR UPDATE`;
}

/** The store-level switch for negative stock (`Store.allowNegative`, off by default). */
export async function storeAllowsNegative(tx: Tx, storeId: string): Promise<boolean> {
  const store = await tx.store.findUnique({
    where: byCode("storeId", storeId),
    select: { allowNegative: true },
  });
  return store?.allowNegative ?? false;
}

/**
 * Refuses a movement that reduces on-hand below zero, unless the store allows negative stock. A
 * movement that does not reduce stock is never refused here, so a balance that is already negative
 * can still be corrected upwards.
 */
export function assertNotBelowZero(args: {
  label: string;
  onHand: Decimal;
  delta: Decimal;
  allowNegative: boolean;
}): void {
  const { label, onHand, delta, allowNegative } = args;
  const result = onHand.plus(delta);
  if (delta.isNegative() && result.isNegative() && !allowNegative) {
    throw new ApiError(
      400,
      `${label} would go below zero: on-hand ${onHand.toString()}, change ${delta.toString()}, result ${result.toString()}. Negative stock is not allowed for this store.`
    );
  }
}
