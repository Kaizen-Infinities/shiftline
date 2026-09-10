import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "./accounts.service";
import type { BooksQuery } from "./books.types";

/**
 * The books of prime entry (P1-10b): the day book lists every voucher of a period with its
 * lines; the cash book and bank book are running-balance statements of the cash-in-hand ledgers
 * (merged) and of one bank ledger, drawn from the same journal as every other report.
 */
export const CASH_GROUPS = ["CASH_IN_HAND"] as const;
export const BANK_GROUPS = ["BANK_ACCOUNTS", "BANK_OD"] as const;
const DAY_BOOK_LIMIT = 5000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DayBookLine {
  ledgerId: number | null;
  code: string | null;
  name: string | null;
  debit: number;
  credit: number;
  narration: string | null;
}

export interface DayBookVoucher {
  id: number;
  voucherNo: string;
  type: string;
  status: string;
  narration: string | null;
  refDocType: string | null;
  refDocId: string | null;
  total: number;
  lines: DayBookLine[];
}

export interface DayBookDay {
  date: string;
  vouchers: DayBookVoucher[];
  totalDebit: number;
  totalCredit: number;
}

class BooksService {
  /** Ledgers under the given tree groups; the code list is the fallback for an ungrouped chart. */
  private async ledgersInGroups(groups: readonly string[], fallbackCodes: string[]) {
    await accountsService.ensureSystemLedgersExist();
    const grouped = await prisma.accountLedger.findMany({
      where: { isActive: true, ledgerGroup: { code: { in: [...groups] } } },
      select: { id: true, code: true, name: true, ledgerGroup: { select: { code: true } } },
      orderBy: { code: "asc" },
    });
    if (grouped.length) return grouped;
    return prisma.accountLedger.findMany({
      where: { code: { in: fallbackCodes } },
      select: { id: true, code: true, name: true, ledgerGroup: { select: { code: true } } },
      orderBy: { code: "asc" },
    });
  }

  async dayBook(q: BooksQuery) {
    const where: Prisma.VoucherWhereInput = {
      ...(q.type && { type: q.type }),
      ...(!q.includeCancelled && { status: "POSTED" }),
      ...((q.startDate || q.endDate) && {
        date: {
          ...(q.startDate && { gte: new Date(`${q.startDate}T00:00:00.000Z`) }),
          ...(q.endDate && { lte: new Date(`${q.endDate}T00:00:00.000Z`) }),
        },
      }),
      ...(q.search && {
        OR: [
          { voucherNo: { contains: q.search, mode: "insensitive" } },
          { narration: { contains: q.search, mode: "insensitive" } },
        ],
      }),
    };
    const vouchers = await prisma.voucher.findMany({
      where,
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: DAY_BOOK_LIMIT + 1,
      include: {
        items: {
          orderBy: { id: "asc" },
          include: {
            debitLedger: { select: { id: true, code: true, name: true } },
            creditLedger: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    const truncated = vouchers.length > DAY_BOOK_LIMIT;
    const days = new Map<string, DayBookDay>();
    let totalDebit = 0;
    let totalCredit = 0;
    for (const v of vouchers.slice(0, DAY_BOOK_LIMIT)) {
      const date = isoDay(v.date);
      const day = days.get(date) ?? { date, vouchers: [], totalDebit: 0, totalCredit: 0 };
      const lines: DayBookLine[] = v.items.map((item) => {
        const debit = Number(item.debitAmount);
        const credit = Number(item.creditAmount);
        const ledger = debit > 0 ? item.debitLedger : item.creditLedger;
        return {
          ledgerId: ledger?.id ?? null,
          code: ledger?.code ?? null,
          name: ledger?.name ?? null,
          debit,
          credit,
          narration: item.narration,
        };
      });
      const debitSum = round2(lines.reduce((s, l) => s + l.debit, 0));
      const creditSum = round2(lines.reduce((s, l) => s + l.credit, 0));
      day.vouchers.push({
        id: v.id,
        voucherNo: v.voucherNo,
        type: v.type,
        status: v.status,
        narration: v.narration,
        refDocType: v.refDocType,
        refDocId: v.refDocId,
        total: debitSum,
        lines,
      });
      day.totalDebit = round2(day.totalDebit + debitSum);
      day.totalCredit = round2(day.totalCredit + creditSum);
      totalDebit = round2(totalDebit + debitSum);
      totalCredit = round2(totalCredit + creditSum);
      days.set(date, day);
    }
    return {
      startDate: q.startDate ?? null,
      endDate: q.endDate ?? null,
      days: [...days.values()],
      voucherCount: Math.min(vouchers.length, DAY_BOOK_LIMIT),
      totalDebit,
      totalCredit,
      truncated,
    };
  }

  async cashBook(q: BooksQuery) {
    const ledgers = await this.ledgersInGroups(CASH_GROUPS, ["CASH-001", "PCASH-001"]);
    if (!ledgers.length) throw new ApiError(404, "No cash ledger exists yet");
    const statement = await accountsService.getMultiLedgerStatement(
      ledgers.map((l) => l.id),
      { startDate: q.startDate, endDate: q.endDate, search: q.search, label: "Cash Book" }
    );
    return { ledgers, ...statement };
  }

  async bankBook(q: BooksQuery) {
    const ledgers = await this.ledgersInGroups(BANK_GROUPS, ["BANK-001"]);
    if (!q.ledgerId) return { ledgers, statement: null };
    if (!ledgers.some((l) => l.id === q.ledgerId)) {
      throw new ApiError(400, "That ledger is not a bank account or overdraft");
    }
    const statement = await accountsService.getLedgerStatement(q.ledgerId, {
      startDate: q.startDate,
      endDate: q.endDate,
      search: q.search,
    });
    return { ledgers, statement };
  }
}

export const booksService = new BooksService();
