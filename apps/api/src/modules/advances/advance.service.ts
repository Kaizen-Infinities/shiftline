import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { periodService } from "../accounts/period.service";
import { documentNumberService } from "../documents/document-number.service";
import { splitGst, supplyTypeFor } from "../gst/gst.calc";
import { companyGstProfile, resolveIssuingPlace, stateOfGstin } from "../gst/gst.context";
import { advancePosting } from "./advance.posting";

/**
 * Advances received from customers (P1-14).
 *
 * Tax on an advance for a service falls due when the money arrives, not when the invoice is
 * raised, so the receipt voucher carries its own GST. When the invoice finally goes out the tax
 * is *adjusted*, not charged a second time — GSTR-1 reports the advance in table 11A and the
 * adjustment in 11B, and getting that wrong means paying the same tax twice.
 *
 * An advance is money the company owes until it is earned, so it credits an advances-received
 * liability rather than the customer's account.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

export interface AdvanceInput {
  customerId: string;
  receiptDate: string | Date;
  amount: number;
  gstRate?: number | null;
  businessPlaceId?: string | number | null;
  placeOfSupply?: string | null;
  paymentMethod?: string;
  referenceNumber?: string | null;
  narration?: string | null;
  receiptNo?: string | null;
}

class AdvanceService {
  /**
   * Records money taken before the invoice. The amount is what the customer actually paid, so
   * the tax is worked out *inside* it: an advance of ₹11,800 at 18% is ₹10,000 plus ₹1,800, not
   * ₹11,800 plus tax. Billing the customer for tax on tax is the obvious failure here.
   */
  async create(input: AdvanceInput, actor: { userId?: string }) {
    const date = new Date(input.receiptDate);
    if (Number.isNaN(date.getTime())) throw new ApiError(400, "Invalid receipt date");
    if (!(Number(input.amount) > 0)) throw new ApiError(400, "An advance has to be more than zero");
    await periodService.assertPostingAllowed(date);

    const customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      include: { addresses: true },
    });
    if (!customer) throw new ApiError(404, "That customer does not exist");

    const profile = await companyGstProfile(prisma);
    const place = await resolveIssuingPlace(input.businessPlaceId, profile, prisma);
    const placeOfSupply =
      input.placeOfSupply ??
      customer.stateCode ??
      stateOfGstin(customer.gstin) ??
      place.stateCode ??
      null;
    const supplyType = supplyTypeFor({
      fromStateCode: place.stateCode,
      toStateCode: placeOfSupply,
      partyRegistration: customer.gstRegType,
    });

    const rate = Number(input.gstRate ?? 0);
    const gross = n2(input.amount);
    // The advance is tax-inclusive: back the taxable value out of it.
    const taxable = rate > 0 ? n2(gross / (1 + rate / 100)) : gross;
    const split = splitGst(taxable, rate, supplyType);

    return prisma.$transaction(async (tx) => {
      const receiptNo =
        input.receiptNo ??
        (await documentNumberService.next("RECEIPT_VOUCHER", {
          date,
          businessPlaceId: place.id,
          tx,
        }));
      const row = await tx.advanceReceipt.create({
        data: {
          receiptNo,
          receiptDate: date,
          customerId: customer.id,
          businessPlaceId: place.id,
          amount: gross,
          taxable,
          gstRate: rate,
          igst: split.igstAmount,
          cgst: split.cgstAmount,
          sgst: split.sgstAmount,
          placeOfSupply,
          supplyType,
          customerGstin: customer.gstin,
          paymentMethod: input.paymentMethod ?? "Bank",
          referenceNumber: input.referenceNumber ?? null,
          narration: input.narration ?? null,
          createdBy: actor.userId ?? null,
        },
        include: { customer: { select: { id: true, firmName: true } } },
      });
      await advancePosting.receipt(tx, row.id);
      return row;
    });
  }

  /** What is left on an advance after adjustments and refunds. */
  balanceOf(row: { amount: unknown; adjustedAmount: unknown; refundedAmount: unknown }) {
    return n2(Number(row.amount) - Number(row.adjustedAmount) - Number(row.refundedAmount));
  }

  /**
   * Applies an advance to an invoice. The tax already paid comes off in the same proportion the
   * money does, so a part adjustment releases part of the tax — which is what table 11B reports
   * and what stops the liability being counted twice.
   */
  async adjust(
    advanceId: string,
    input: { salesInvoiceId: string; amount: number; on?: string | Date },
    actor: { userId?: string }
  ) {
    const advance = await prisma.advanceReceipt.findUnique({ where: { id: advanceId } });
    if (!advance) throw new ApiError(404, "That advance does not exist");
    if (advance.cancelledAt)
      throw new ApiError(409, "That advance was cancelled", "ADVANCE_CANCELLED");
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id: input.salesInvoiceId },
      select: { id: true, customerId: true, grandTotal: true, cancelledAt: true, invoiceNo: true },
    });
    if (!invoice) throw new ApiError(404, "That invoice does not exist");
    if (invoice.cancelledAt)
      throw new ApiError(409, "That invoice was cancelled", "INVOICE_CANCELLED");
    if (invoice.customerId !== advance.customerId) {
      throw new ApiError(
        400,
        "The advance and the invoice belong to different customers",
        "CUSTOMER_MISMATCH"
      );
    }
    const amount = n2(input.amount);
    if (!(amount > 0)) throw new ApiError(400, "An adjustment has to be more than zero");
    const balance = this.balanceOf(advance);
    if (amount > balance) {
      throw new ApiError(
        400,
        `Only ${balance.toFixed(2)} is left on that advance`,
        "ADVANCE_EXHAUSTED",
        { balance }
      );
    }
    const alreadyOnInvoice = await prisma.advanceAdjustment.aggregate({
      where: { salesInvoiceId: invoice.id, kind: "ADJUSTED" },
      _sum: { amount: true },
    });
    const applied = n2(Number(alreadyOnInvoice._sum.amount ?? 0));
    if (n2(applied + amount) > n2(invoice.grandTotal)) {
      throw new ApiError(
        400,
        "Advances applied to that invoice would come to more than the invoice",
        "OVER_ADJUSTED"
      );
    }

    const share = amount / Number(advance.amount);
    const on = new Date(input.on ?? new Date());
    await periodService.assertPostingAllowed(on);

    return prisma.$transaction(async (tx) => {
      const row = await tx.advanceAdjustment.create({
        data: {
          advanceId,
          salesInvoiceId: invoice.id,
          kind: "ADJUSTED",
          amount,
          taxable: n2(Number(advance.taxable) * share),
          igst: n2(Number(advance.igst) * share),
          cgst: n2(Number(advance.cgst) * share),
          sgst: n2(Number(advance.sgst) * share),
          adjustedOn: on,
          createdBy: actor.userId ?? null,
        },
      });
      await advancePosting.adjustment(tx, row.id);
      await this.restate(tx, advanceId);
      return row;
    });
  }

  /**
   * Gives an unadjusted advance back. The tax paid on it comes back too, through a refund
   * voucher with its own number, because the supply it was taken for is not going to happen.
   */
  async refund(
    advanceId: string,
    input: { amount: number; on?: string | Date; reason?: string | null },
    actor: { userId?: string }
  ) {
    const advance = await prisma.advanceReceipt.findUnique({ where: { id: advanceId } });
    if (!advance) throw new ApiError(404, "That advance does not exist");
    if (advance.cancelledAt)
      throw new ApiError(409, "That advance was cancelled", "ADVANCE_CANCELLED");
    const amount = n2(input.amount);
    const balance = this.balanceOf(advance);
    if (!(amount > 0)) throw new ApiError(400, "A refund has to be more than zero");
    if (amount > balance) {
      throw new ApiError(400, `Only ${balance.toFixed(2)} is left to refund`, "ADVANCE_EXHAUSTED", {
        balance,
      });
    }
    const on = new Date(input.on ?? new Date());
    await periodService.assertPostingAllowed(on);
    const share = amount / Number(advance.amount);

    return prisma.$transaction(async (tx) => {
      const voucherNo = await documentNumberService.next("REFUND_VOUCHER", {
        date: on,
        businessPlaceId: advance.businessPlaceId,
        tx,
      });
      const row = await tx.advanceAdjustment.create({
        data: {
          advanceId,
          salesInvoiceId: null,
          kind: "REFUNDED",
          amount,
          taxable: n2(Number(advance.taxable) * share),
          igst: n2(Number(advance.igst) * share),
          cgst: n2(Number(advance.cgst) * share),
          sgst: n2(Number(advance.sgst) * share),
          refundVoucherNo: voucherNo,
          adjustedOn: on,
          createdBy: actor.userId ?? null,
        },
      });
      await advancePosting.refund(tx, row.id);
      await this.restate(tx, advanceId);
      logger.info({ advanceId, voucherNo, amount }, "advance refunded");
      return row;
    });
  }

  /** Recomputes an advance's adjusted and refunded totals and its status from its rows. */
  private async restate(tx: Prisma.TransactionClient, advanceId: string) {
    const rows = await tx.advanceAdjustment.findMany({ where: { advanceId } });
    const adjusted = n2(
      rows.filter((r) => r.kind === "ADJUSTED").reduce((s, r) => s + Number(r.amount), 0)
    );
    const refunded = n2(
      rows.filter((r) => r.kind === "REFUNDED").reduce((s, r) => s + Number(r.amount), 0)
    );
    const advance = await tx.advanceReceipt.findUniqueOrThrow({ where: { id: advanceId } });
    const used = n2(adjusted + refunded);
    const status =
      used === 0 ? "OPEN" : used >= n2(advance.amount) - 0.005 ? "CLOSED" : "PART_ADJUSTED";
    return tx.advanceReceipt.update({
      where: { id: advanceId },
      data: { adjustedAmount: adjusted, refundedAmount: refunded, status },
    });
  }

  async list(params: { customerId?: string; status?: string; from?: Date; to?: Date } = {}) {
    const rows = await prisma.advanceReceipt.findMany({
      where: {
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.from || params.to
          ? {
              receiptDate: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      include: {
        customer: { select: { id: true, firmName: true, displayName: true } },
        adjustments: true,
      },
      orderBy: { receiptDate: "desc" },
      take: 500,
    });
    return rows.map((r) => ({ ...r, balance: this.balanceOf(r) }));
  }

  async get(id: string) {
    const row = await prisma.advanceReceipt.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, firmName: true, displayName: true, gstin: true } },
        adjustments: { orderBy: { adjustedOn: "asc" } },
      },
    });
    if (!row) throw new ApiError(404, "That advance does not exist");
    return { ...row, balance: this.balanceOf(row) };
  }

  /** Open advances a customer has, for the invoice screen to offer against a new bill. */
  async openFor(customerId: string) {
    const rows = await prisma.advanceReceipt.findMany({
      where: { customerId, cancelledAt: null, status: { in: ["OPEN", "PART_ADJUSTED"] } },
      orderBy: { receiptDate: "asc" },
    });
    return rows.map((r) => ({ ...r, balance: this.balanceOf(r) })).filter((r) => r.balance > 0);
  }

  /**
   * GSTR-1 tables 11A and 11B for a month: advances taken on which tax was paid, and advances
   * adjusted against invoices. Grouped by place of supply and rate, as the portal wants.
   */
  async gstr1Tables(from: Date, to: Date, placeIds: (bigint | null)[]) {
    const placeFilter = placeIds.includes(null)
      ? {
          OR: [
            { businessPlaceId: null },
            { businessPlaceId: { in: placeIds.filter((p): p is bigint => p !== null) } },
          ],
        }
      : { businessPlaceId: { in: placeIds.filter((p): p is bigint => p !== null) } };

    const received = await prisma.advanceReceipt.findMany({
      where: {
        ...placeFilter,
        receiptDate: { gte: from, lt: to },
        cancelledAt: null,
        gstRate: { gt: 0 },
      },
    });
    const adjustments = await prisma.advanceAdjustment.findMany({
      where: { kind: "ADJUSTED", adjustedOn: { gte: from, lt: to } },
      include: {
        advance: {
          select: { placeOfSupply: true, gstRate: true, supplyType: true, businessPlaceId: true },
        },
      },
    });

    const group = new Map<
      string,
      {
        pos: string;
        rate: number;
        taxable: number;
        igst: number;
        cgst: number;
        sgst: number;
        cess: number;
      }
    >();
    const put = (
      pos: string | null,
      rate: number,
      v: { taxable: number; igst: number; cgst: number; sgst: number }
    ) => {
      const key = `${pos ?? "00"}|${rate}`;
      const cur = group.get(key) ?? {
        pos: pos ?? "00",
        rate,
        taxable: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0,
      };
      cur.taxable = n2(cur.taxable + v.taxable);
      cur.igst = n2(cur.igst + v.igst);
      cur.cgst = n2(cur.cgst + v.cgst);
      cur.sgst = n2(cur.sgst + v.sgst);
      group.set(key, cur);
    };
    for (const r of received) {
      put(r.placeOfSupply, Number(r.gstRate), {
        taxable: n2(r.taxable),
        igst: n2(r.igst),
        cgst: n2(r.cgst),
        sgst: n2(r.sgst),
      });
    }
    const at = new Map<string, typeof group extends Map<string, infer V> ? V : never>();
    for (const a of adjustments) {
      const pos = a.advance.placeOfSupply ?? "00";
      const rate = Number(a.advance.gstRate);
      const key = `${pos}|${rate}`;
      const cur = at.get(key) ?? { pos, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      cur.taxable = n2(cur.taxable + Number(a.taxable));
      cur.igst = n2(cur.igst + Number(a.igst));
      cur.cgst = n2(cur.cgst + Number(a.cgst));
      cur.sgst = n2(cur.sgst + Number(a.sgst));
      at.set(key, cur);
    }
    return { table11A: [...group.values()], table11B: [...at.values()] };
  }
}

export const advanceService = new AdvanceService();
