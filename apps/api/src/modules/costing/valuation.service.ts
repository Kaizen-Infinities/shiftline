import type { Prisma, StockMoveKind } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";

/**
 * Weighted-average stock valuation (P1-19).
 *
 * The whole method is two rules, and implementations get the second one wrong:
 *
 *  1. **A receipt moves the average.** New value over new quantity, weighted by what was already
 *     there — so two receipts at different rates give an average between them.
 *  2. **An issue does not.** It leaves at the average of the day and the average is unchanged.
 *     Recomputing it on the way out, or valuing an issue at the last receipt's rate, is the
 *     classic bug: it makes the closing stock drift away from what was actually paid, and the
 *     drift only shows up at a year end when it is too late to find.
 *
 * The entries are a ledger rather than a running number on the item, because the average is the
 * figure everyone argues about at a year end and a balance nobody can explain is a balance nobody
 * can defend.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const n3 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 1000) / 1000;
const n4 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 10000) / 10000;
const asDate = (v: string | Date) =>
  new Date(typeof v === "string" ? `${v.slice(0, 10)}T00:00:00Z` : v);

type Db = Prisma.TransactionClient | typeof prisma;

/** Movements that add to stock; everything else takes away. */
const INWARD: ReadonlySet<StockMoveKind> = new Set([
  "OPENING",
  "RECEIPT",
  "PRODUCTION_IN",
  "RETURN_IN",
] as StockMoveKind[]);

export interface MovementInput {
  itemType: "RAW_MATERIAL" | "PRODUCT";
  itemId: string;
  storeId?: string | null;
  movedOn: string | Date;
  kind: StockMoveKind;
  quantity: number;
  /** Required on an inward movement; ignored on an outward one, which leaves at the average. */
  rate?: number;
  refDocType?: string | null;
  refDocId?: string | null;
  narration?: string | null;
}

export interface Balance {
  quantity: number;
  value: number;
  avgRate: number;
}

class ValuationService {
  /** The balance and average as at a date, read off the last entry before the cut-off. */
  async balanceAt(
    itemType: string,
    itemId: string,
    storeId: string | null | undefined,
    asOn?: Date,
    db: Db = prisma
  ): Promise<Balance> {
    const last = await db.stockValuationEntry.findFirst({
      where: {
        itemType,
        itemId,
        ...(storeId === undefined ? {} : { storeId }),
        ...(asOn ? { movedOn: { lte: asOn } } : {}),
      },
      orderBy: [{ movedOn: "desc" }, { createdAt: "desc" }],
    });
    if (!last) return { quantity: 0, value: 0, avgRate: 0 };
    return {
      quantity: n3(last.balanceQuantity),
      value: n2(last.balanceValue),
      avgRate: n4(last.avgRate),
    };
  }

  /**
   * Records a movement and works out the new average.
   *
   * An outward movement always leaves at the running average, whatever rate the caller passes,
   * because the caller does not get a say — that is the method.
   */
  async record(input: MovementInput, actor: { userId?: string } = {}, db: Db = prisma) {
    const quantity = n3(Math.abs(input.quantity));
    if (quantity <= 0) throw new ApiError(400, "A movement needs a quantity");
    const movedOn = asDate(input.movedOn);
    const inward = INWARD.has(input.kind);
    if (inward && (input.rate === undefined || input.rate === null)) {
      throw new ApiError(400, "An inward movement needs the rate it came in at", "RATE_REQUIRED");
    }

    const opening = await this.balanceAt(
      input.itemType,
      input.itemId,
      input.storeId ?? null,
      undefined,
      db
    );

    let rate: number;
    let value: number;
    let balanceQuantity: number;
    let balanceValue: number;

    if (inward) {
      rate = n4(input.rate ?? 0);
      value = n2(quantity * rate);
      balanceQuantity = n3(opening.quantity + quantity);
      balanceValue = n2(opening.value + value);
    } else {
      // The average of the day, not the last receipt's rate and not a recomputation.
      rate = opening.avgRate;
      value = n2(quantity * rate);
      balanceQuantity = n3(opening.quantity - quantity);
      balanceValue = n2(opening.value - value);
    }

    // A balance at zero keeps the last average rather than dividing by nothing; the next receipt
    // will set it afresh anyway, and a zero average would price the next issue at nothing.
    const avgRate =
      balanceQuantity > 0
        ? n4(balanceValue / balanceQuantity)
        : inward
          ? n4(rate)
          : opening.avgRate;
    const wentNegative = balanceQuantity < 0;

    return db.stockValuationEntry.create({
      data: {
        itemType: input.itemType,
        itemId: input.itemId,
        storeId: input.storeId ?? null,
        movedOn,
        kind: input.kind,
        quantity,
        rate,
        value,
        balanceQuantity,
        balanceValue,
        avgRate,
        wentNegative,
        refDocType: input.refDocType ?? null,
        refDocId: input.refDocId ?? null,
        narration: input.narration ?? null,
        createdBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
  }

  /** Every movement for an item, newest first — the answer to "why is the average that?". */
  async ledger(params: {
    itemType?: string;
    itemId?: string;
    storeId?: string | null;
    from?: Date;
    to?: Date;
  }) {
    return prisma.stockValuationEntry.findMany({
      where: {
        ...(params.itemType ? { itemType: params.itemType } : {}),
        ...(params.itemId ? { itemId: params.itemId } : {}),
        ...(params.storeId === undefined ? {} : { storeId: params.storeId }),
        ...(params.from || params.to
          ? {
              movedOn: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ movedOn: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  /**
   * What the stock was worth on a date, item by item.
   *
   * Built from the last entry before the cut-off for each item and store, so it agrees with the
   * ledger by construction rather than by a second calculation that can drift from it.
   */
  async closingStock(asOn: Date) {
    const entries = await prisma.stockValuationEntry.findMany({
      where: { movedOn: { lte: asOn } },
      orderBy: [{ movedOn: "asc" }, { createdAt: "asc" }],
      take: 20000,
    });
    const latest = new Map<
      string,
      {
        itemType: string;
        itemId: string;
        storeId: string | null;
        quantity: number;
        value: number;
        avgRate: number;
      }
    >();
    for (const e of entries) {
      latest.set(`${e.itemType}|${e.itemId}|${e.storeId ?? ""}`, {
        itemType: e.itemType,
        itemId: e.itemId,
        storeId: e.storeId,
        quantity: n3(e.balanceQuantity),
        value: n2(e.balanceValue),
        avgRate: n4(e.avgRate),
      });
    }
    const rows = [...latest.values()].filter((r) => Math.abs(r.quantity) > 0.0009);
    return {
      asOn: asOn.toISOString().slice(0, 10),
      rows: rows.sort((a, b) => b.value - a.value),
      total: n2(rows.reduce((s, r) => s + r.value, 0)),
      negatives: rows.filter((r) => r.quantity < 0).length,
    };
  }
}

export const valuationService = new ValuationService();
