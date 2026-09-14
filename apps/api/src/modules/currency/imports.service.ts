import { Prisma, VoucherType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import { valuationService } from "../costing/valuation.service";

/**
 * Imports and the bill of entry (P1-17).
 *
 * An import is not a purchase with a foreign price on it. Four things arrive separately and only
 * one of them is creditable:
 *
 *  - the **assessable value** customs worked out, at the *customs* exchange rate, which is
 *    notified fortnightly and is not the day's market rate;
 *  - **basic customs duty** and the **social welfare surcharge**, which are not creditable and
 *    are therefore part of what the goods cost;
 *  - **IGST** under section 3(7) of the Customs Tariff Act, which *is* creditable and must never
 *    reach the cost of the goods; and
 *  - freight, insurance and clearing, which are.
 *
 * Putting the whole bill into stock overstates the stock by the IGST and quietly throws away the
 * credit. That split is the entire point of this file.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

type Line = {
  debitLedgerId?: number;
  creditLedgerId?: number;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  narration: string;
};
const D = (n: number) => new Prisma.Decimal(n2(n));
const debit = (ledgerId: number, amount: number, narration: string): Line => ({
  debitLedgerId: ledgerId,
  debitAmount: D(amount),
  creditAmount: D(0),
  narration,
});
const credit = (ledgerId: number, amount: number, narration: string): Line => ({
  creditLedgerId: ledgerId,
  debitAmount: D(0),
  creditAmount: D(amount),
  narration,
});

export interface BillOfEntryInput {
  beNumber: string;
  beDate: string | Date;
  portCode?: string | null;
  grnInvoiceId?: string | null;
  supplierId?: number | null;
  currencyCode?: string;
  exchangeRate: number;
  foreignValue: number;
  /** Customs works this out itself; it is not simply foreign value times the rate. */
  assessableValue?: number | null;
  basicDuty?: number;
  socialWelfareSurcharge?: number;
  igst?: number;
  cess?: number;
  otherCharges?: number;
  notes?: string | null;
}

/**
 * What the goods actually cost: everything that is not creditable.
 *
 * Exported because the apportionment and the posting both need it and they must not disagree.
 */
export const landedCostOf = (be: {
  assessableValue: number;
  basicDuty: number;
  socialWelfareSurcharge: number;
  otherCharges: number;
}): number => n2(be.assessableValue + be.basicDuty + be.socialWelfareSurcharge + be.otherCharges);

/**
 * Spreads the landed cost across the lines **by value**, with the rounding difference put on the
 * largest line rather than lost. Apportioning by quantity would load a cheap heavy item with the
 * duty of an expensive light one.
 */
export const apportion = (
  landedCost: number,
  lines: { id: string; value: number }[]
): { id: string; share: number }[] => {
  const total = lines.reduce((s, l) => s + l.value, 0);
  if (total <= 0 || lines.length === 0) return lines.map((l) => ({ id: l.id, share: 0 }));
  const shares = lines.map((l) => ({ id: l.id, share: n2((landedCost * l.value) / total) }));
  const drift = n2(landedCost - shares.reduce((s, x) => s + x.share, 0));
  if (Math.abs(drift) >= 0.01) {
    const biggest = lines.reduce((a, b) => (a.value >= b.value ? a : b));
    const target = shares.find((s) => s.id === biggest.id);
    if (target) target.share = n2(target.share + drift);
  }
  return shares;
};

class ImportsService {
  async list(params: { from?: Date; to?: Date } = {}) {
    return prisma.billOfEntry.findMany({
      where:
        params.from || params.to
          ? {
              beDate: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {},
      include: { supplier: { select: { legalName: true } } },
      orderBy: { beDate: "desc" },
      take: 500,
    });
  }

  async get(id: string) {
    const row = await prisma.billOfEntry.findUnique({
      where: { id },
      include: { supplier: { select: { legalName: true } } },
    });
    if (!row) throw new ApiError(404, "That bill of entry does not exist");
    return row;
  }

  /**
   * Records the bill of entry and posts it: duty and charges into the cost of the goods, IGST
   * into the input-credit ledger, the whole lot credited to customs payable.
   */
  async create(input: BillOfEntryInput, actor: { userId?: string }) {
    if (input.exchangeRate <= 0)
      throw new ApiError(400, "The customs exchange rate has to be positive");
    const beDate = new Date(
      typeof input.beDate === "string" ? `${input.beDate.slice(0, 10)}T00:00:00Z` : input.beDate
    );
    const assessableValue = n2(
      input.assessableValue ?? n2(input.foreignValue * input.exchangeRate)
    );
    const basicDuty = n2(input.basicDuty ?? 0);
    const socialWelfareSurcharge = n2(input.socialWelfareSurcharge ?? 0);
    const igst = n2(input.igst ?? 0);
    const cess = n2(input.cess ?? 0);
    const otherCharges = n2(input.otherCharges ?? 0);
    const landedCost = landedCostOf({
      assessableValue,
      basicDuty,
      socialWelfareSurcharge,
      otherCharges,
    });

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      await periodService.assertPostingAllowed(beDate, undefined, tx);
      const duplicate = await tx.billOfEntry.findFirst({
        where: { beNumber: input.beNumber.trim(), beDate },
      });
      if (duplicate) {
        throw new ApiError(409, "That bill of entry is already recorded", "DUPLICATE_BOE");
      }

      const ledger = async (code: string) => {
        const row = await tx.accountLedger.findFirst({ where: { code } });
        if (!row) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
        return row;
      };
      const purchases = await ledger("PURCH-001");
      const igstCredit = await ledger("IGST-REC-001");
      const cessCredit = await ledger("CESS-REC-001");
      const customs = await ledger("CUSTOMS-PAY-001");

      const items: Line[] = [];
      // Everything that is not creditable goes into the cost of the goods, in one line, because
      // that is how it reaches stock through the purchase account.
      const dutiable = n2(basicDuty + socialWelfareSurcharge + otherCharges);
      if (dutiable > 0) {
        items.push(debit(purchases.id, dutiable, `Duty and charges — BE ${input.beNumber}`));
      }
      if (igst > 0) items.push(debit(igstCredit.id, igst, `IGST on import — BE ${input.beNumber}`));
      if (cess > 0) items.push(debit(cessCredit.id, cess, `Cess on import — BE ${input.beNumber}`));
      const payable = n2(dutiable + igst + cess);
      if (payable > 0) {
        items.push(credit(customs.id, payable, `Customs — BE ${input.beNumber}`));
      }

      const voucher =
        items.length > 0
          ? await tx.voucher.create({
              data: {
                voucherNo: `BOE-${input.beNumber}`.slice(0, 30),
                type: VoucherType.JOURNAL,
                date: beDate,
                narration: `Bill of entry ${input.beNumber}`,
                refDocType: "BILL_OF_ENTRY",
                refDocId: input.beNumber.trim().slice(0, 36),
                createdBy: actor.userId?.slice(0, 36) ?? null,
                items: { create: items },
              },
            })
          : null;

      const created = await tx.billOfEntry.create({
        data: {
          beNumber: input.beNumber.trim().slice(0, 20),
          beDate,
          portCode: input.portCode ?? null,
          grnInvoiceId: input.grnInvoiceId ?? null,
          supplierId: input.supplierId ?? null,
          currencyCode: (input.currencyCode ?? "USD").toUpperCase().slice(0, 3),
          exchangeRate: input.exchangeRate,
          foreignValue: n2(input.foreignValue),
          assessableValue,
          basicDuty,
          socialWelfareSurcharge,
          igst,
          cess,
          otherCharges,
          landedCost,
          voucherId: voucher?.id ?? null,
          notes: input.notes ?? null,
          createdBy: actor.userId?.slice(0, 36) ?? null,
        },
      });

      // Raises the average of the stock already received by the landed cost apportioned to each
      // line — a second, cost-only movement, not a second receipt (P2-04).
      if (input.grnInvoiceId && landedCost > 0) {
        const grn = await tx.grnInvoice.findUnique({
          where: { id: input.grnInvoiceId },
          include: { items: true },
        });
        if (grn) {
          const lines = grn.items.map((i) => ({
            id: String(i.id),
            productId: i.productId,
            value: n2(Number(i.quantity) * Number(i.unitPrice)),
          }));
          const shares = apportion(landedCost, lines);
          for (const line of lines) {
            const share = shares.find((s) => s.id === line.id)?.share ?? 0;
            if (share <= 0) continue;
            await valuationService.recordCostAdjustment(
              {
                itemType: "RAW_MATERIAL",
                itemId: line.productId,
                storeId: grn.storeId,
                movedOn: beDate,
                amount: share,
                refDocType: "BILL_OF_ENTRY",
                refDocId: created.id,
                narration: `Landed cost — BE ${input.beNumber}`,
              },
              actor,
              tx
            );
          }
        }
      }

      return created;
    });
  }

  /** What each line of the purchase this bill clears actually cost, landed. */
  async landedCostBreakdown(id: string) {
    const be = await this.get(id);
    if (!be.grnInvoiceId) {
      throw new ApiError(400, "That bill of entry is not against a purchase", "NO_PURCHASE");
    }
    const grn = await prisma.grnInvoice.findUnique({
      where: { id: be.grnInvoiceId },
      include: { items: true },
    });
    if (!grn) throw new ApiError(404, "The purchase behind that bill of entry is gone");

    const lines = grn.items.map((i) => ({
      id: String(i.id),
      description: i.description ?? "",
      quantity: Number(i.quantity),
      value: n2(Number(i.quantity) * Number(i.unitPrice)),
    }));
    const shares = apportion(n2(be.landedCost), lines);
    return {
      billOfEntry: be.beNumber,
      landedCost: n2(be.landedCost),
      // The IGST is named here and kept out of the cost, so nobody has to wonder where it went.
      creditableIgst: n2(be.igst),
      lines: lines.map((l) => {
        const share = shares.find((s) => s.id === l.id)?.share ?? 0;
        return {
          ...l,
          landedShare: share,
          landedRate: l.quantity > 0 ? n2(share / l.quantity) : 0,
        };
      }),
    };
  }
}

export const importsService = new ImportsService();
