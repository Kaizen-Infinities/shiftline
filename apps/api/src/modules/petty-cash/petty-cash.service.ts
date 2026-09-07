import { getCurrentCompanyId } from "../../utils/companyContext";
import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";
import { ApiError } from "../../utils/ApiError";
import { CreatePettyCashInput, GetPettyCashQueryInput } from "./petty-cash.types";
import { logger } from "../../lib/logger";
import { companyGstProfile, resolveIssuingPlace } from "../gst/gst.context";
import { periodService } from "../accounts/period.service";
import { cancellationService } from "../accounts/cancellation.service";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

class PettyCashService {
  private generateEntryNo(): string {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `PC-${timestamp}-${random}`;
  }

  async getEntries(query: GetPettyCashQueryInput) {
    const companyId = await getCurrentCompanyId();
    const where: Prisma.PettyCashEntryWhereInput = {
      companyId,
      ...(query.type && { type: query.type }),
      ...(query.category && { category: { equals: query.category, mode: "insensitive" } }),
      ...((query.startDate || query.endDate) && {
        entryDate: {
          ...(query.startDate && { gte: new Date(query.startDate) }),
          ...(query.endDate && { lte: new Date(query.endDate) }),
        },
      }),
    };

    const entries = await prisma.pettyCashEntry.findMany({
      where,
      orderBy: { entryDate: "desc" },
    });

    // Also fetch Expense entries so they appear as Petty Cash OUT rows. Must
    // apply the SAME filters as `where` above — otherwise expenses ignore the
    // user's date range and type=IN filter, causing:
    //   * dates outside the picked range still showing
    //   * OUT rows appearing even when user asked for Type = IN
    // Fetching all expenses regardless of filter was the bug reported from
    // the screenshot (Type IN filter returning 15 OUT rows).
    const skipExpenses = query.type === "IN"; // no expense can ever be "IN"
    const expenseWhere: Prisma.ExpenseWhereInput = {
      companyId,
      ...((query.startDate || query.endDate) && {
        date: {
          ...(query.startDate && { gte: new Date(query.startDate) }),
          ...(query.endDate && { lte: new Date(query.endDate) }),
        },
      }),
    };
    const expenses = skipExpenses
      ? []
      : await prisma.expense.findMany({
          where: expenseWhere,
          include: { supplier: true },
          orderBy: { date: "desc" },
        });

    let totalIn = 0;
    let totalOut = 0;

    const formattedEntries: any[] = [];

    // Map explicit petty cash entries
    entries.forEach((e) => {
      const amt = Number(e.amount);
      if (e.cancelledAt) {
        formattedEntries.push({ ...e, amount: amt });
        return;
      }
      if (e.type === "IN") {
        totalIn += amt;
      } else {
        totalOut += amt;
      }
      formattedEntries.push({
        ...e,
        amount: amt,
      });
    });

    // Map expense records if not already synced by entryNo
    const existingEntryNos = new Set(entries.map((e) => e.entryNo));

    expenses.forEach((exp) => {
      const entryNo = `PC-EXP-${exp.expenseNumber}`;
      if (!existingEntryNos.has(entryNo)) {
        const amt = Number(exp.amount || 0);
        totalOut += amt;
        formattedEntries.push({
          id: exp.id,
          entryNo,
          entryDate: exp.date,
          category: exp.expenseCategory || "Expense",
          description: `Expense (${exp.expenseNumber}): ${exp.expense}`,
          amount: amt,
          type: "OUT",
          paidTo: exp.supplier?.legalName || exp.supplier || null,
          receiptNo: exp.receiptInvoice || exp.expenseNumber,
          companyId: exp.companyId,
          createdBy: exp.createdBy,
          createdAt: exp.createdAt,
          updatedAt: exp.updatedAt,
        });
      }
    });

    // Sort combined entries by entryDate descending
    formattedEntries.sort(
      (a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime()
    );

    const currentBalance = totalIn - totalOut;

    return {
      entries: formattedEntries,
      summary: {
        totalIn,
        totalOut,
        currentBalance,
      },
    };
  }

  async createEntry(data: CreatePettyCashInput, createdBy?: string) {
    const companyId = await getCurrentCompanyId();
    const entryNo = this.generateEntryNo();
    const entryDate = data.entryDate ? new Date(data.entryDate) : new Date();
    await periodService.assertPostingAllowed(entryDate);

    const place = await resolveIssuingPlace(data.businessPlaceId, await companyGstProfile());
    const gstRate = data.type === "OUT" ? (data.gstRate ?? 0) : 0;
    const vendorGstin = data.vendorGstin ? data.vendorGstin : null;
    // The amount is the bill total; GST inside it is only credited back against a GSTIN-bearing bill.
    const taxAmount =
      data.type !== "OUT"
        ? 0
        : data.taxAmount !== undefined
          ? round2(data.taxAmount)
          : gstRate > 0 && vendorGstin
            ? round2(data.amount - data.amount / (1 + gstRate / 100))
            : 0;
    if (taxAmount > data.amount) throw new ApiError(400, "GST cannot exceed the amount");
    const tdsAmount = data.type === "OUT" ? round2(data.tdsAmount ?? 0) : 0;
    if (tdsAmount > data.amount) throw new ApiError(400, "TDS cannot exceed the amount");

    const entry = await prisma.pettyCashEntry.create({
      data: {
        entryNo,
        entryDate,
        category: data.category,
        description: data.description,
        amount: new Prisma.Decimal(data.amount),
        type: data.type,
        paidTo: data.paidTo || null,
        receiptNo: data.receiptNo || null,
        businessPlaceId: place.id,
        vendorGstin,
        hsnCode: data.hsnCode || null,
        gstRate: new Prisma.Decimal(gstRate),
        taxAmount: new Prisma.Decimal(taxAmount),
        tdsAmount: new Prisma.Decimal(tdsAmount),
        companyId,
        createdBy: createdBy || null,
      },
    });

    // Auto-post to ledger (double-entry bookkeeping)
    try {
      const { voucherPostingService } = await import("../accounts/voucherPosting.service.js");
      await voucherPostingService.postPettyCashVoucher(entry.id);
    } catch (err) {
      logger.error({ err: err }, "[PettyCashService] Auto-post to ledger failed:");
      // Don't fail the entry creation if ledger posting fails
    }

    return entry;
  }

  /** P1-09: an entry is cancelled, never deleted; its voucher is reversed. */
  async cancelEntry(
    id: number,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    return prisma.$transaction(async (tx) => {
      const entry = await tx.pettyCashEntry.findUnique({ where: { id } });
      if (!entry) throw new ApiError(404, "Petty cash entry not found");
      if (entry.cancelledAt) {
        throw new ApiError(409, `Entry ${entry.entryNo} is already cancelled`, "ALREADY_CANCELLED");
      }
      await cancellationService.cancelVouchersFor(
        ["PETTY_CASH"],
        [String(entry.id)],
        { reason, actor },
        tx
      );
      return tx.pettyCashEntry.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: actor.userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
    });
  }
}

export const pettyCashService = new PettyCashService();
