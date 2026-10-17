import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { logger } from "../../lib/logger";
import { computeExpenseTax } from "./expense.tax";
import { periodService } from "../accounts/period.service";
import { cancellationService } from "../accounts/cancellation.service";
import { tdsService } from "../tds/tds.service";

/** Expense claim statuses (P1-10d). */
const DRAFT = "Draft";
const PENDING = "Pending";
const APPROVED = "Approved";
const REJECTED = "Rejected";
export const EXPENSE_STATUSES = [DRAFT, PENDING, APPROVED, REJECTED, "Cancelled"] as const;

const TAX_KEYS = [
  "businessPlaceId",
  "vendorGstin",
  "taxableAmount",
  "gstRate",
  "reverseCharge",
  "itcEligible",
  "tdsRate",
  "tdsAmount",
] as const;
const touchesTax = (data: Record<string, unknown>) => TAX_KEYS.some((k) => data[k] !== undefined);

class ExpenseService {
  /**
   * Creates a new expense.
   */
  async createExpense(data: any, currentUser: { userId: string; companyId: string }) {
    // Check if expense number already exists for this company
    const existingExpense = await prisma.expense.findFirst({
      where: {
        companyId: currentUser.companyId,
        expenseNumber: data.expenseNumber,
      },
    });

    if (existingExpense) {
      throw new ApiError(
        409,
        `Expense number '${data.expenseNumber}' already exists for this company.`
      );
    }

    await periodService.assertPostingAllowed(new Date(data.date), currentUser);
    const tax = await computeExpenseTax(prisma, { ...data, amount: Number(data.amount) });
    const newExpense = await prisma.expense.create({
      data: {
        ...data,
        ...tax,
        date: data.date ? new Date(data.date) : undefined,
        amount: data.amount !== undefined ? Number(data.amount) : undefined,
        supplierId: data.supplierId ? Number(data.supplierId) : null,
        companyId: currentUser.companyId,
        createdBy: currentUser.userId,
      },
      include: {
        supplier: true,
      },
    });

    // P2-05: offer or accept the TDS deduction on this bill. Accepting it re-derives the
    // authoritative rate/amount (threshold, 206AA/206AB) through tdsService and records a
    // TdsDeduction row so it feeds the quarterly return; the raw tdsRate/tdsAmount the caller
    // sent are only a preview unless deductTds is true.
    let tdsPreview: Awaited<ReturnType<typeof tdsService.rateFor>> | null = null;
    if (data.tdsSection) {
      const taxable = Number(newExpense.taxableAmount ?? newExpense.amount);
      if (data.deductTds) {
        try {
          const deduction = await tdsService.deduct(
            {
              sectionCode: data.tdsSection,
              supplierId: newExpense.supplierId ?? undefined,
              docType: "EXPENSE",
              docId: newExpense.id,
              docNo: newExpense.expenseNumber,
              deductionDate: newExpense.date,
              amount: taxable,
            },
            { userId: currentUser.userId }
          );
          await prisma.expense.update({
            where: { id: newExpense.id },
            data: {
              tdsSection: data.tdsSection,
              tdsRate: deduction.rate,
              tdsAmount: deduction.tdsAmount,
            },
          });
          newExpense.tdsRate = deduction.rate;
          newExpense.tdsAmount = deduction.tdsAmount;
        } catch (tdsErr) {
          logger.error({ err: tdsErr }, "[Expense TDS] Failed to record TDS deduction:");
        }
      } else {
        tdsPreview = await tdsService.rateFor({
          sectionCode: data.tdsSection,
          supplierId: newExpense.supplierId ?? undefined,
          amount: taxable,
          on: newExpense.date,
        });
      }
    }

    // P1-10d: an expense claim reaches the books only once it is approved. A record created
    // straight as Approved (a paid-and-filed bill) posts its EXPENSE voucher at once.
    if (newExpense.status === APPROVED) {
      try {
        const { voucherPostingService } = await import("../accounts/voucherPosting.service.js");
        await voucherPostingService.postExpenseVoucher(newExpense.id, data.paymentMethod);
      } catch (voucherErr) {
        logger.error(
          { err: voucherErr },
          "[Expense Voucher Posting Error]: Failed to post expense voucher"
        );
      }
    }

    // Also create a Petty Cash entry for petty cash tracking (record-keeping only, no voucher posting)
    try {
      const pcEntryNo = `PC-EXP-${newExpense.expenseNumber}`;
      await prisma.pettyCashEntry.create({
        data: {
          entryNo: pcEntryNo,
          entryDate: newExpense.date || new Date(),
          category: newExpense.expenseCategory || "General Expense",
          description: `Expense (${newExpense.expenseNumber}): ${newExpense.expense}`,
          amount: newExpense.amount,
          type: "OUT",
          paidTo: newExpense.supplier?.legalName || null,
          receiptNo: newExpense.receiptInvoice || newExpense.expenseNumber,
          companyId: currentUser.companyId,
          createdBy: currentUser.userId,
        },
      });
    } catch (pcErr) {
      logger.error(
        { err: pcErr },
        "[Petty Cash Sync Error]: Failed to create petty cash entry for expense"
      );
    }

    return tdsPreview ? { ...newExpense, tdsPreview } : newExpense;
  }

  /**
   * Fetches all expenses for a company with optional search, filtering, and pagination.
   */
  async getAllExpenses(
    companyId: string,
    query?: {
      page?: number;
      limit?: number;
      search?: string;
      category?: string;
      status?: string;
    }
  ) {
    const page = query?.page;
    const limit = query?.limit;
    const search = query?.search;
    const category = query?.category;
    const status = query?.status;

    const where: any = {
      companyId,
      ...(category && { expenseCategory: category }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { expenseNumber: { contains: search, mode: "insensitive" } },
          { expense: { contains: search, mode: "insensitive" } },
          { expenseCategory: { contains: search, mode: "insensitive" } },
          { supplier: { legalName: { contains: search, mode: "insensitive" } } },
        ],
      }),
    };

    const total = await prisma.expense.count({ where });

    const findOptions: any = {
      where,
      include: {
        supplier: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    };

    if (page !== undefined && limit !== undefined) {
      findOptions.skip = (page - 1) * limit;
      findOptions.take = limit;
    }

    const expenses = await prisma.expense.findMany(findOptions);

    if (page !== undefined && limit !== undefined) {
      return {
        data: expenses,
        total,
      };
    }

    return expenses;
  }

  /**
   * Fetches an expense by ID.
   */
  async getExpenseById(id: string, companyId: string) {
    const expense = await prisma.expense.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        supplier: true,
      },
    });

    if (!expense) {
      throw new ApiError(404, "Expense record not found.");
    }

    return expense;
  }

  /**
   * Updates an expense by ID.
   */
  async updateExpense(id: string, data: any, companyId: string) {
    const expense = await this.getExpenseById(id, companyId);
    if (expense.cancelledAt) throw new ApiError(409, "Cancelled expenses cannot be edited");
    if (data.status !== undefined && data.status !== expense.status) {
      throw new ApiError(400, "Use submit, approve or reject to change an expense's status");
    }
    await periodService.assertPostingAllowed(expense.date);
    if (data.date) await periodService.assertPostingAllowed(new Date(data.date));

    if (data.expenseNumber && data.expenseNumber !== expense.expenseNumber) {
      const existing = await prisma.expense.findFirst({
        where: {
          companyId,
          expenseNumber: data.expenseNumber,
          id: { not: id },
        },
      });

      if (existing) {
        throw new ApiError(
          409,
          `Expense number '${data.expenseNumber}' already exists for this company.`
        );
      }
    }

    // Any change to the amount or a tax field re-derives the whole GST/TDS block from the stored values.
    const tax =
      data.amount !== undefined || touchesTax(data)
        ? await computeExpenseTax(prisma, {
            amount: data.amount !== undefined ? Number(data.amount) : Number(expense.amount),
            businessPlaceId: data.businessPlaceId ?? expense.businessPlaceId,
            vendorGstin: data.vendorGstin !== undefined ? data.vendorGstin : expense.vendorGstin,
            taxableAmount: data.taxableAmount,
            gstRate: data.gstRate ?? Number(expense.gstRate),
            reverseCharge: data.reverseCharge ?? expense.reverseCharge,
            itcEligible: data.itcEligible ?? expense.itcEligible,
            tdsRate: data.tdsRate ?? Number(expense.tdsRate),
            tdsAmount: data.tdsAmount,
          })
        : {};
    const updateData = {
      ...data,
      ...tax,
      ...(data.date && { date: new Date(data.date) }),
      ...(data.amount !== undefined && { amount: Number(data.amount) }),
      ...(data.supplierId !== undefined && {
        supplierId: data.supplierId ? Number(data.supplierId) : null,
      }),
    };

    // The update, the reversal of the old voucher and the new posting commit together (P1-09).
    // Unapproved claims have no voucher yet, so nothing to re-post.
    const updatedExpense = await prisma.$transaction(
      async (tx) => {
        const updated = await tx.expense.update({
          where: { id },
          data: updateData,
          include: {
            supplier: true,
          },
        });
        if (updated.status === APPROVED) {
          await cancellationService.cancelVouchersFor(
            ["EXPENSE"],
            [id],
            { reason: "Expense edited" },
            tx
          );
          await this.postExpenseVoucherOrThrow(id, updated.paymentMethod, tx);
        }
        return updated;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    // Update corresponding petty cash entry if exists
    try {
      const pcEntryNo = `PC-EXP-${updatedExpense.expenseNumber}`;
      await prisma.pettyCashEntry.updateMany({
        where: { entryNo: pcEntryNo },
        data: {
          entryDate: updatedExpense.date,
          category: updatedExpense.expenseCategory || "General Expense",
          description: `Expense (${updatedExpense.expenseNumber}): ${updatedExpense.expense}`,
          amount: updatedExpense.amount,
          paidTo: updatedExpense.supplier?.legalName || null,
          receiptNo: updatedExpense.receiptInvoice || updatedExpense.expenseNumber,
        },
      });
    } catch (pcErr) {
      logger.error({ err: pcErr }, "[Petty Cash Update Error]:");
    }

    return updatedExpense;
  }

  /**
   * P1-10d approval: Draft → Pending (submit) → Approved (posts the voucher) or Rejected.
   * Approval is the moment the claim enters the books, so it is gated by the posting date.
   */
  async submitExpense(id: string, companyId: string) {
    const expense = await this.getExpenseById(id, companyId);
    if (expense.cancelledAt) throw new ApiError(409, "Cancelled expenses cannot be submitted");
    if (![DRAFT, REJECTED].includes(expense.status)) {
      throw new ApiError(
        409,
        `Only draft or rejected expenses can be submitted (is ${expense.status})`
      );
    }
    return prisma.expense.update({
      where: { id },
      data: { status: PENDING, rejectReason: null },
      include: { supplier: true },
    });
  }

  async approveExpense(
    id: string,
    companyId: string,
    actor: { userId?: string; isSuperAdmin?: boolean }
  ) {
    const expense = await this.getExpenseById(id, companyId);
    if (expense.cancelledAt) throw new ApiError(409, "Cancelled expenses cannot be approved");
    if (![DRAFT, PENDING].includes(expense.status)) {
      throw new ApiError(409, `Only pending expenses can be approved (is ${expense.status})`);
    }
    if (actor.userId && expense.createdBy === actor.userId && !actor.isSuperAdmin) {
      throw new ApiError(403, "An expense cannot be approved by the person who claimed it");
    }
    await periodService.assertPostingAllowed(expense.date, actor);
    return prisma.$transaction(
      async (tx) => {
        const approved = await tx.expense.update({
          where: { id },
          data: {
            status: APPROVED,
            approvedBy: actor.userId ?? null,
            approvedAt: new Date(),
            rejectReason: null,
          },
          include: { supplier: true },
        });
        await this.postExpenseVoucherOrThrow(id, approved.paymentMethod, tx);
        return approved;
      },
      { maxWait: 10000, timeout: 30000 }
    );
  }

  /** Posts the EXPENSE voucher inside `tx`; a null result is a failure that rolls everything back. */
  private async postExpenseVoucherOrThrow(
    expenseId: string,
    paymentMethod: string | undefined,
    tx: Prisma.TransactionClient
  ) {
    const { voucherPostingService } = await import("../accounts/voucherPosting.service.js");
    const voucher = await voucherPostingService.postExpenseVoucher(expenseId, paymentMethod, tx);
    if (!voucher) {
      logger.error({ expenseId }, "[Expense] Voucher could not be posted");
      throw new ApiError(
        422,
        "The expense voucher could not be posted; check the ledgers and the GST/TDS figures on the expense"
      );
    }
  }

  async rejectExpense(
    id: string,
    companyId: string,
    actor: { userId?: string; isSuperAdmin?: boolean },
    reason: string
  ) {
    const expense = await this.getExpenseById(id, companyId);
    if (expense.cancelledAt) throw new ApiError(409, "Cancelled expenses cannot be rejected");
    if (![DRAFT, PENDING].includes(expense.status)) {
      throw new ApiError(409, `Only pending expenses can be rejected (is ${expense.status})`);
    }
    return prisma.expense.update({
      where: { id },
      data: {
        status: REJECTED,
        approvedBy: actor.userId ?? null,
        approvedAt: new Date(),
        rejectReason: reason,
      },
      include: { supplier: true },
    });
  }

  /**
   * Deletes an expense by ID.
   */
  /**
   * P1-09: an expense is cancelled, never deleted. Its voucher is reversed and the mirrored
   * petty-cash entry is cancelled with it.
   */
  async cancelExpense(
    id: string,
    companyId: string,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    const expense = await this.getExpenseById(id, companyId);
    if (expense.cancelledAt) {
      throw new ApiError(
        409,
        `Expense ${expense.expenseNumber} is already cancelled`,
        "ALREADY_CANCELLED"
      );
    }
    return prisma.$transaction(async (tx) => {
      await cancellationService.cancelVouchersFor(["EXPENSE"], [id], { reason, actor }, tx);
      // P2-05: the EXPENSE voucher above already carried the TDS credit line, so this only
      // marks the TdsDeduction row cancelled (no second voucher to reverse).
      await tdsService.reverseForDoc(
        "EXPENSE",
        id,
        reason?.trim() || `Expense ${expense.expenseNumber} cancelled`,
        actor,
        tx
      );
      await tx.pettyCashEntry.updateMany({
        where: { entryNo: `PC-EXP-${expense.expenseNumber}`, cancelledAt: null },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: actor.userId ?? null,
          cancelReason: reason?.trim() || `Expense ${expense.expenseNumber} cancelled`,
        },
      });
      return tx.expense.update({
        where: { id },
        data: {
          status: "Cancelled",
          cancelledAt: new Date(),
          cancelledBy: actor.userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
    });
  }

  /** Kept for the DELETE route: deleting an expense now means cancelling it. */
  async deleteExpense(
    id: string,
    companyId: string,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    return this.cancelExpense(id, companyId, actor, reason);
  }

  /**
   * Generates the next sequential expense code.
   */
  async getNextExpenseNumber(companyId: string) {
    const lastExpense = await prisma.expense.findFirst({
      where: { companyId },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!lastExpense) {
      return "EXP-001";
    }

    const lastCode = lastExpense.expenseNumber;
    const match = lastCode.match(/EXP-(\d+)/);

    if (!match) {
      return `${lastCode}-001`;
    }

    const nextNum = parseInt(match[1], 10) + 1;
    return `EXP-${String(nextNum).padStart(3, "0")}`;
  }
}

export const expenseService = new ExpenseService();
export default expenseService;
