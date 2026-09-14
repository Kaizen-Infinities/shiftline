import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { byCode } from "../../lib/prisma";

/**
 * Work in progress (P2-04).
 *
 * Material issued to a production order sits in no balance of its own — the valuation ledger
 * only shows it leaving the raw-material store. This is the figure that says where it went: the
 * sum of every issue against an order that is still open, less whatever of those issues has since
 * been reversed. It reads `StockValuationEntry` rather than keeping a running number, for the
 * same reason the valuation ledger itself is a ledger — a WIP figure nobody can take apart is a
 * WIP figure nobody can defend.
 *
 * An order stops carrying WIP the moment it is no longer open: dispatched, its material has left
 * as finished goods; cancelled, the order never happened. Everything in between — however far
 * through production — still owes an explanation for what was issued to it.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

/** Statuses past which material issued to the order is no longer "in progress". */
const CLOSED_STATUSES = new Set(["DISPATCHED", "CANCELLED"]);

export interface WipRow {
  productionOrderId: string;
  status: string;
  open: boolean;
  value: number;
}

class WipService {
  isOpenStatus(status: string): boolean {
    return !CLOSED_STATUSES.has(status);
  }

  /** WIP for one order: what has been issued to it, net of anything reversed, while it is open. */
  async wipFor(productionOrderId: string): Promise<WipRow> {
    const order = await prisma.productionOrder.findUnique({
      where: byCode("productionOrderId", productionOrderId),
      select: { productionOrderId: true, status: true },
    });
    if (!order) throw new ApiError(404, "That production order does not exist");
    const open = this.isOpenStatus(order.status);
    if (!open) return { productionOrderId, status: order.status, open, value: 0 };

    const entries = await prisma.stockValuationEntry.findMany({
      where: { refDocType: "PRODUCTION_ORDER", refDocId: productionOrderId },
      select: { kind: true, value: true, reversedEntryId: true },
    });
    let value = 0;
    for (const e of entries) {
      if (e.kind === "ISSUE") value = n2(value + Number(e.value));
      else if (e.reversedEntryId) value = n2(value - Number(e.value));
    }
    return { productionOrderId, status: order.status, open, value: Math.max(0, value) };
  }

  /** WIP across every production order that has ever had material issued to it. */
  async total(): Promise<{ rows: WipRow[]; total: number }> {
    const refIds = await prisma.stockValuationEntry.findMany({
      where: { refDocType: "PRODUCTION_ORDER" },
      distinct: ["refDocId"],
      select: { refDocId: true },
    });
    const rows: WipRow[] = [];
    let total = 0;
    for (const { refDocId } of refIds) {
      if (!refDocId) continue;
      const row = await this.wipFor(refDocId).catch(() => null);
      if (row && row.value > 0.0009) {
        rows.push(row);
        total = n2(total + row.value);
      }
    }
    return { rows: rows.sort((a, b) => b.value - a.value), total };
  }
}

export const wipService = new WipService();
