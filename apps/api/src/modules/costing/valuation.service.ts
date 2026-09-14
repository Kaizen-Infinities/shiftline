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
const iso = (v: Date) => v.toISOString().slice(0, 10);

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
   * The two-rule average math, factored out so both a live {@link record} (which always moves
   * off the *latest* balance, because a live movement is always the newest thing that ever
   * happened) and a historical {@link backfill} (which has to move off a running balance it
   * carries itself, since it is inserting rows *before* the latest one) compute an entry the
   * same way.
   */
  private computeMovement(opening: Balance, kind: StockMoveKind, quantity: number, rate: number) {
    const inward = INWARD.has(kind);
    let outRate: number;
    let value: number;
    let balanceQuantity: number;
    let balanceValue: number;

    if (inward) {
      outRate = n4(rate);
      value = n2(quantity * outRate);
      balanceQuantity = n3(opening.quantity + quantity);
      balanceValue = n2(opening.value + value);
    } else {
      // The average of the day, not the last receipt's rate and not a recomputation.
      outRate = opening.avgRate;
      value = n2(quantity * outRate);
      balanceQuantity = n3(opening.quantity - quantity);
      balanceValue = n2(opening.value - value);
    }

    // A balance at zero keeps the last average rather than dividing by nothing; the next receipt
    // will set it afresh anyway, and a zero average would price the next issue at nothing.
    const avgRate =
      balanceQuantity > 0
        ? n4(balanceValue / balanceQuantity)
        : inward
          ? n4(outRate)
          : opening.avgRate;

    return { rate: outRate, value, balanceQuantity, balanceValue, avgRate };
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

    const { rate, value, balanceQuantity, balanceValue, avgRate } = this.computeMovement(
      opening,
      input.kind,
      quantity,
      n4(input.rate ?? 0)
    );
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

  /**
   * Reverses every not-yet-reversed movement recorded against a document, as a new row each —
   * never a delete, never an edit of the original (P2-04 / CLAUDE.md books are never deleted).
   *
   * An inward movement (a receipt) is undone by taking the same quantity out again at the exact
   * rate it came in at, not at today's average — the point is to leave the ledger exactly as if
   * the movement had never happened, not to record a fresh issue. An outward movement (an issue,
   * a wastage) is undone by putting the same quantity back at the rate it left at.
   */
  async reverseDocument(
    refDocType: string,
    refDocId: string,
    actor: { userId?: string } = {},
    db: Db = prisma
  ) {
    const originals = await db.stockValuationEntry.findMany({
      where: { refDocType, refDocId, reversedEntryId: null },
      orderBy: [{ movedOn: "asc" }, { createdAt: "asc" }],
    });
    const alreadyReversed = new Set(
      (
        await db.stockValuationEntry.findMany({
          where: { refDocType, refDocId, reversedEntryId: { not: null } },
          select: { reversedEntryId: true },
        })
      ).map((r) => r.reversedEntryId)
    );
    const reversed = [];
    for (const original of originals) {
      if (alreadyReversed.has(original.id)) continue;
      reversed.push(await this.reverseEntry(original, actor, db));
    }
    return reversed;
  }

  /** The one-row reversal behind {@link reverseDocument}. */
  private async reverseEntry(
    original: {
      id: string;
      itemType: string;
      itemId: string;
      storeId: string | null;
      movedOn: Date;
      kind: StockMoveKind;
      quantity: unknown;
      rate: unknown;
      refDocType: string | null;
      refDocId: string | null;
    },
    actor: { userId?: string },
    db: Db
  ) {
    const wasInward = INWARD.has(original.kind);
    const quantity = n3(Math.abs(Number(original.quantity)));
    const rate = n4(Number(original.rate));
    const value = n2(quantity * rate);
    const opening = await this.balanceAt(
      original.itemType,
      original.itemId,
      original.storeId,
      undefined,
      db
    );
    const balanceQuantity = n3(
      wasInward ? opening.quantity - quantity : opening.quantity + quantity
    );
    const balanceValue = n2(wasInward ? opening.value - value : opening.value + value);
    const avgRate =
      balanceQuantity > 0
        ? n4(balanceValue / balanceQuantity)
        : wasInward
          ? opening.avgRate
          : n4(rate);
    return db.stockValuationEntry.create({
      data: {
        itemType: original.itemType,
        itemId: original.itemId,
        storeId: original.storeId,
        // Same business date as what it undoes — the ledger orders by that date, and a reversal
        // dated "today" would sort ahead of a movement dated later in the same document's own
        // history, undoing the wrong thing as far as the average is concerned.
        movedOn: original.movedOn,
        kind: "ADJUSTMENT",
        quantity,
        rate,
        value,
        balanceQuantity,
        balanceValue,
        avgRate,
        wentNegative: balanceQuantity < 0,
        refDocType: original.refDocType,
        refDocId: original.refDocId,
        narration: `Reversal of ${original.kind} entry`,
        reversedEntryId: original.id,
        createdBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
  }

  /**
   * Adds cost to stock already on hand without moving quantity — a bill of entry's landed cost
   * apportioned onto a receipt already recorded, so the average rises without a second movement
   * pretending goods arrived twice.
   */
  async recordCostAdjustment(
    input: {
      itemType: "RAW_MATERIAL" | "PRODUCT";
      itemId: string;
      storeId?: string | null;
      movedOn: string | Date;
      amount: number;
      refDocType?: string | null;
      refDocId?: string | null;
      narration?: string | null;
    },
    actor: { userId?: string } = {},
    db: Db = prisma
  ) {
    const amount = n2(input.amount);
    if (amount === 0) return null;
    const movedOn = asDate(input.movedOn);
    const opening = await this.balanceAt(
      input.itemType,
      input.itemId,
      input.storeId ?? null,
      undefined,
      db
    );
    const balanceQuantity = opening.quantity;
    const balanceValue = n2(opening.value + amount);
    const avgRate = balanceQuantity > 0 ? n4(balanceValue / balanceQuantity) : opening.avgRate;
    return db.stockValuationEntry.create({
      data: {
        itemType: input.itemType,
        itemId: input.itemId,
        storeId: input.storeId ?? null,
        movedOn,
        kind: "ADJUSTMENT",
        quantity: 0,
        rate: 0,
        value: amount,
        balanceQuantity,
        balanceValue,
        avgRate,
        wentNegative: balanceQuantity < 0,
        refDocType: input.refDocType ?? null,
        refDocId: input.refDocId ?? null,
        narration: input.narration ?? null,
        createdBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
  }

  /**
   * Values historical raw-material movements that predate this wiring and never reached the
   * ledger.
   *
   * Per item/store pair, this fills every transaction dated *before* the pair's earliest existing
   * valuation entry (whatever wrote that entry — this backfill on an earlier run, or a wired
   * movement) and never touches a transaction on or after it: that first entry is real and its
   * own average must not move. A pair with no valuation entry at all gets its whole history
   * filled, same as before this fix. Rows before the cut-off are inserted in date order against a
   * running balance carried locally — {@link record}'s own opening balance is always the *latest*
   * entry, which would be wrong here since every row this writes is older than the ledger's
   * current tip.
   *
   * Each inward transaction is valued at, in order: the transaction's own rate (raw-material
   * transactions do not carry one today, so this never fires yet, but the rule holds for any that
   * later do), else the item master's current rate ("at the time" is the best this ledger can do
   * without a price-history table of its own), else — when the master carries no rate — the rate
   * of the pair's first known valuation entry, so a zero rate is never guessed into the ledger
   * while a real one is known.
   *
   * Idempotent two ways: a row already tagged `RM_TXN_BACKFILL` against its transaction is left
   * as it stands rather than rewritten, and a transaction on or after the cut-off is never
   * touched — so a second run creates nothing and reports every row as skipped.
   */
  async backfill(actor: { userId?: string } = {}, db: Db = prisma) {
    const txns = await db.rawMaterialTransaction.findMany({
      orderBy: { txnDateTime: "asc" },
      include: { rawMaterial: { select: { rate: true } } },
    });

    const byPair = new Map<string, typeof txns>();
    for (const t of txns) {
      const key = `${t.rawMaterialId}|${t.storeId ?? ""}`;
      const list = byPair.get(key);
      if (list) list.push(t);
      else byPair.set(key, [t]);
    }

    let created = 0;
    let skipped = 0;
    const pairs: Array<{
      itemId: string;
      storeId: string | null;
      filled: number;
      skipped: number;
      reasons: string[];
    }> = [];

    for (const [, pairTxns] of byPair) {
      const itemId = pairTxns[0].rawMaterialId;
      const storeId = pairTxns[0].storeId ?? null;

      const earliest = await db.stockValuationEntry.findFirst({
        where: { itemType: "RAW_MATERIAL", itemId, storeId },
        orderBy: [{ movedOn: "asc" }, { createdAt: "asc" }],
      });
      const cutoff = earliest?.movedOn ?? null;
      const firstKnownRate = earliest ? n4(earliest.rate) : 0;

      let pairFilled = 0;
      let pairSkipped = 0;
      const reasons: string[] = [];
      let opening: Balance = { quantity: 0, value: 0, avgRate: 0 };

      for (const t of pairTxns) {
        const refDocId = t.rmTxnId.toString();

        if (cutoff && t.txnDateTime >= cutoff) {
          pairSkipped++;
          reasons.push(`${refDocId}: on or after the first existing entry (${iso(cutoff)})`);
          continue;
        }

        const existing = await db.stockValuationEntry.findFirst({
          where: { refDocType: "RM_TXN_BACKFILL", refDocId },
          select: { balanceQuantity: true, balanceValue: true, avgRate: true },
        });
        if (existing) {
          pairSkipped++;
          reasons.push(`${refDocId}: already backfilled`);
          opening = {
            quantity: n3(existing.balanceQuantity),
            value: n2(existing.balanceValue),
            avgRate: n4(existing.avgRate),
          };
          continue;
        }

        const qty = Number(t.qty);
        if (qty === 0) {
          pairSkipped++;
          reasons.push(`${refDocId}: zero quantity`);
          continue;
        }

        const inward = qty > 0;
        const quantity = n3(Math.abs(qty));
        const rate = inward ? Number(t.rawMaterial?.rate ?? 0) || firstKnownRate : 0;
        const kind: StockMoveKind = inward ? "RECEIPT" : "ISSUE";
        const entry = this.computeMovement(opening, kind, quantity, rate);

        await db.stockValuationEntry.create({
          data: {
            itemType: "RAW_MATERIAL",
            itemId,
            storeId,
            movedOn: t.txnDateTime,
            kind,
            quantity,
            rate: entry.rate,
            value: entry.value,
            balanceQuantity: entry.balanceQuantity,
            balanceValue: entry.balanceValue,
            avgRate: entry.avgRate,
            wentNegative: entry.balanceQuantity < 0,
            refDocType: "RM_TXN_BACKFILL",
            refDocId,
            narration: `Backfilled from ${t.txnType} (${refDocId})`,
            createdBy: actor.userId?.slice(0, 36) ?? null,
          },
        });
        opening = {
          quantity: entry.balanceQuantity,
          value: entry.balanceValue,
          avgRate: entry.avgRate,
        };
        pairFilled++;
        created++;
      }

      skipped += pairSkipped;
      if (pairFilled > 0 || pairSkipped > 0) {
        pairs.push({ itemId, storeId, filled: pairFilled, skipped: pairSkipped, reasons });
      }
    }

    return { scanned: txns.length, created, skipped, pairs };
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
