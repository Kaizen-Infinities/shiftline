import { Prisma, VoucherType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import type { Db } from "../../lib/prisma";
import { getTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { periodService, type PostingActor } from "./period.service";
import { freeVoucherNo } from "./voucherPosting.service";

/**
 * Cancellation (P1-09, MCA Rule 3(1)): a voucher is never deleted. Cancelling marks it
 * `CANCELLED` and posts a JOURNAL reversal with the sides swapped, so every report nets
 * to zero and the ledger statement shows both lines. Documents cancel the vouchers they
 * posted through `cancelVouchersFor()`.
 */
export interface CancelOptions {
  reason?: string | null;
  actor?: PostingActor;
  /** Date for the reversal; defaults to the original date when that period is still open. */
  date?: Date;
  /** Internal repairs only: allows cancelling opening-balance vouchers. */
  force?: boolean;
}

type VoucherWithItems = Prisma.VoucherGetPayload<{ include: { items: true } }>;
export interface CancelResult {
  voucher: VoucherWithItems;
  reversal: VoucherWithItems;
}

const OPENING_BALANCE_TYPES = new Set([
  "LEDGER_OPENING_BALANCE",
  "CUSTOMER_OPENING_BALANCE",
  "SUPPLIER_OPENING_BALANCE",
]);

const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

class CancellationService {
  private actorOf(opts: CancelOptions): PostingActor {
    return opts.actor ?? { userId: getTenant()?.userId, isSuperAdmin: getTenant()?.isSuperAdmin };
  }

  /** The date the reversal is posted on: the original date if still open, else today (also checked). */
  private async reversalDate(
    original: Date,
    requested: Date | undefined,
    actor: PostingActor,
    db: Db
  ) {
    if (requested) {
      await periodService.assertPostingAllowed(requested, actor, db);
      return dayStart(requested);
    }
    try {
      await periodService.assertPostingAllowed(original, actor, db);
      return dayStart(original);
    } catch (err) {
      if (!(err instanceof ApiError) || err.statusCode !== 403) throw err;
      const today = dayStart(new Date());
      await periodService.assertPostingAllowed(today, actor, db);
      return today;
    }
  }

  /** Cancels one voucher and posts its reversal. Returns both. */
  async cancelVoucher(
    voucherId: number,
    opts: CancelOptions = {},
    txClient?: Prisma.TransactionClient
  ): Promise<CancelResult> {
    if (!txClient) {
      return prisma.$transaction((tx) => this.cancelVoucher(voucherId, opts, tx), {
        maxWait: 10000,
        timeout: 30000,
      });
    }
    const db = txClient;
    const actor = this.actorOf(opts);
    const voucher = await db.voucher.findUnique({
      where: { id: voucherId },
      include: { items: true },
    });
    if (!voucher) throw new ApiError(404, "Voucher not found");
    if (voucher.status === "CANCELLED") {
      throw new ApiError(
        409,
        `Voucher ${voucher.voucherNo} is already cancelled`,
        "ALREADY_CANCELLED"
      );
    }
    if (!opts.force && voucher.refDocType && OPENING_BALANCE_TYPES.has(voucher.refDocType)) {
      throw new ApiError(
        400,
        "Opening balance vouchers cannot be cancelled; correct the opening balance instead"
      );
    }
    if (voucher.refDocType === "REVERSAL") {
      throw new ApiError(
        400,
        "A reversal cannot be cancelled; cancel or re-post the underlying document"
      );
    }

    const date = await this.reversalDate(voucher.date, opts.date, actor, db);
    const reason = opts.reason?.trim() || null;
    const reversalNo = await freeVoucherNo(db, `REV-${voucher.voucherNo}`.slice(0, 30));

    const reversal = await db.voucher.create({
      data: {
        voucherNo: reversalNo,
        type: VoucherType.JOURNAL,
        date,
        narration: `Reversal of ${voucher.voucherNo}${reason ? `: ${reason}` : ""}`,
        refDocType: "REVERSAL",
        refDocId: String(voucher.id),
        reversalOfId: voucher.id,
        businessPlaceId: voucher.businessPlaceId ?? undefined,
        createdBy: actor.userId ?? undefined,
        items: {
          create: voucher.items.map((item) => ({
            debitLedgerId: item.creditLedgerId,
            creditLedgerId: item.debitLedgerId,
            debitAmount: item.creditAmount,
            creditAmount: item.debitAmount,
            narration: `Reversal: ${item.narration ?? ""}`.slice(0, 255),
          })),
        },
      },
      include: { items: true },
    });

    const cancelled = await db.voucher.update({
      where: { id: voucher.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: actor.userId ?? null,
        cancelReason: reason,
        cancelSeq: voucher.id,
      },
      include: { items: true },
    });

    try {
      const { emitToTenant } = await import("../../lib/realtime.js");
      emitToTenant("voucher:cancelled", { id: voucher.id, reversalId: reversal.id });
      emitToTenant("voucher:created", reversal);
      emitToTenant("accountLedger:updated", { source: "cancellation" });
    } catch {
      /* realtime is best effort */
    }

    return { voucher: cancelled, reversal };
  }

  /** Cancels every posted voucher a document raised (its own and its payments/receipts). */
  async cancelVouchersFor(
    refDocTypes: string[],
    refDocIds: string[],
    opts: CancelOptions,
    db: Prisma.TransactionClient
  ): Promise<CancelResult[]> {
    const vouchers = await db.voucher.findMany({
      where: { refDocType: { in: refDocTypes }, refDocId: { in: refDocIds }, status: "POSTED" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const results: CancelResult[] = [];
    for (const v of vouchers) results.push(await this.cancelVoucher(v.id, opts, db));
    return results;
  }
}

export const cancellationService = new CancellationService();
