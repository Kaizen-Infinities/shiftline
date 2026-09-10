import { createHash } from "node:crypto";
import { Prisma, VoucherType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { cancellationService } from "../accounts/cancellation.service";
import { periodService } from "../accounts/period.service";
import { documentNumberService } from "../documents/document-number.service";
import { financialYearFor, SEQUENCED_DOC_TYPES } from "../platform/provisioning.service";
import { RETAINED_EARNINGS_CODE, YEAR_END_REF } from "./year-end.constants";
import type { PrepareYearEndInput } from "./year-end.types";

/**
 * Year-end closing (P1-09e). Two steps: `prepare` snapshots the closing journal (every income
 * and expense ledger's balance for the year against Retained Earnings) and `approve` posts it
 * on the year's last day, closes the year's accounting periods, opens the next year's period and
 * numbering series, and freezes the books up to the year end. Approval refuses when the books
 * moved since preparation. A closing is reversed, never deleted: its journal is cancelled with a
 * reversal and the row stays on file.
 */
export interface Actor {
  userId?: string | null;
  isSuperAdmin?: boolean;
}

export interface FinancialYear {
  code: string;
  start: Date;
  end: Date;
  periodName: string;
}

export interface ClosingLine {
  ledgerId: number;
  code: string;
  name: string;
  type: "INCOME" | "EXPENSE" | "EQUITY";
  side: "DEBIT" | "CREDIT";
  amount: number;
}

const FY_CODE = /^(\d{4})-(\d{2})$/;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const D = (n: number) => new Prisma.Decimal(round2(n));

export const fyFromCode = (code: string): FinancialYear => {
  const m = FY_CODE.exec(code);
  if (!m) throw new ApiError(400, "Financial year is written YYYY-YY, e.g. 2025-26");
  const y = Number(m[1]);
  if ((y + 1) % 100 !== Number(m[2])) {
    throw new ApiError(400, `${code} is not a financial year; the second part is the next year`);
  }
  return financialYearFor(new Date(Date.UTC(y, 3, 1)));
};

/** The year most recently ended: the one before the year containing `today`. */
export const previousFinancialYear = (today = new Date()): FinancialYear => {
  const current = financialYearFor(today);
  return financialYearFor(new Date(Date.UTC(current.start.getUTCFullYear() - 1, 3, 1)));
};

const nextFinancialYear = (fy: FinancialYear): FinancialYear =>
  financialYearFor(new Date(Date.UTC(fy.start.getUTCFullYear() + 1, 3, 1)));

const hashLines = (fyCode: string, lines: ClosingLine[]) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        fyCode,
        lines: [...lines]
          .map((l) => [l.ledgerId, l.side, l.amount] as const)
          .sort((a, b) => a[0] - b[0]),
      })
    )
    .digest("hex");

const include = {
  closingVoucher: { select: { id: true, voucherNo: true, status: true, date: true } },
} satisfies Prisma.YearEndClosingInclude;
type Row = Prisma.YearEndClosingGetPayload<{ include: typeof include }>;

const present = (row: Row) => ({
  id: row.id,
  fyCode: row.fyCode,
  fyStart: isoDay(row.fyStart),
  fyEnd: isoDay(row.fyEnd),
  status: row.status,
  totalIncome: Number(row.totalIncome),
  totalExpense: Number(row.totalExpense),
  netProfit: Number(row.netProfit),
  lines: (row.lines ?? []) as unknown as ClosingLine[],
  payloadHash: row.payloadHash,
  notes: row.notes,
  preparedBy: row.preparedBy,
  preparedAt: row.preparedAt,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt,
  reversedBy: row.reversedBy,
  reversedAt: row.reversedAt,
  reverseReason: row.reverseReason,
  closingVoucher: row.closingVoucher
    ? { ...row.closingVoucher, date: isoDay(row.closingVoucher.date) }
    : null,
});

export type YearEndClosingView = ReturnType<typeof present>;

class YearEndService {
  async list() {
    const rows = await prisma.yearEndClosing.findMany({
      orderBy: [{ fyStart: "desc" }, { id: "desc" }],
      include,
    });
    return rows.map(present);
  }

  /** The closing journal as the books stand now, plus anything that stops it being posted. */
  async preview(fyCode?: string) {
    const fy = fyCode ? fyFromCode(fyCode) : previousFinancialYear();
    await accountsService.ensureSystemLedgersExist();
    const retained = await prisma.accountLedger.findFirst({
      where: { code: RETAINED_EARNINGS_CODE },
    });
    if (!retained) throw new ApiError(500, "The Retained Earnings ledger is missing");

    const pnl = await accountsService.getProfitAndLoss({
      startDate: isoDay(fy.start),
      endDate: isoDay(fy.end),
    });
    const lines: ClosingLine[] = [];
    for (const a of pnl.incomeAccounts) {
      const n = round2(a.netAmount);
      if (Math.abs(n) < 0.005) continue;
      lines.push({
        ledgerId: a.ledgerId,
        code: a.code,
        name: a.name,
        type: "INCOME",
        side: n > 0 ? "DEBIT" : "CREDIT",
        amount: Math.abs(n),
      });
    }
    for (const a of pnl.expenseAccounts) {
      const n = round2(a.netAmount);
      if (Math.abs(n) < 0.005) continue;
      lines.push({
        ledgerId: a.ledgerId,
        code: a.code,
        name: a.name,
        type: "EXPENSE",
        side: n > 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(n),
      });
    }
    const netProfit = round2(pnl.netProfit);
    if (Math.abs(netProfit) >= 0.005) {
      lines.push({
        ledgerId: retained.id,
        code: retained.code,
        name: retained.name,
        type: "EQUITY",
        side: netProfit > 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(netProfit),
      });
    }

    const existing = await prisma.yearEndClosing.findFirst({
      where: { fyCode: fy.code, status: { in: ["PREPARED", "APPROVED"] } },
      include,
    });
    const payloadHash = hashLines(fy.code, lines);
    const blockers: string[] = [];
    if (fy.end >= dayStart(new Date())) blockers.push(`${fy.periodName} has not ended yet`);
    if (existing?.status === "APPROVED") blockers.push(`${fy.periodName} is already closed`);
    const frozen = await periodService.freezeDate();
    if (frozen && frozen >= fy.end && existing?.status !== "APPROVED") {
      blockers.push(
        `Books are frozen up to ${isoDay(frozen)}; move the freeze date back to post the closing entry`
      );
    }

    return {
      fy: {
        code: fy.code,
        start: isoDay(fy.start),
        end: isoDay(fy.end),
        periodName: fy.periodName,
      },
      lines,
      totalIncome: round2(pnl.totalIncome),
      totalExpense: round2(pnl.totalExpense),
      netProfit,
      retainedEarnings: { id: retained.id, code: retained.code, name: retained.name },
      payloadHash,
      existing: existing ? present(existing) : null,
      stale: existing?.status === "PREPARED" ? existing.payloadHash !== payloadHash : false,
      blockers,
      canPrepare: blockers.length === 0 && !existing,
    };
  }

  async prepare(input: PrepareYearEndInput, actor: Actor) {
    const p = await this.preview(input.fyCode);
    if (p.existing) {
      throw new ApiError(
        409,
        `${p.fy.periodName} already has a ${p.existing.status.toLowerCase()} closing`,
        "YEAR_END_EXISTS",
        { id: p.existing.id, status: p.existing.status }
      );
    }
    if (p.blockers.length) throw new ApiError(400, p.blockers[0], "YEAR_END_BLOCKED");
    const row = await prisma.yearEndClosing.create({
      data: {
        fyCode: p.fy.code,
        fyStart: new Date(p.fy.start),
        fyEnd: new Date(p.fy.end),
        totalIncome: D(p.totalIncome),
        totalExpense: D(p.totalExpense),
        netProfit: D(p.netProfit),
        lines: p.lines as unknown as Prisma.InputJsonValue,
        payloadHash: p.payloadHash,
        retainedEarningsLedgerId: p.retainedEarnings.id,
        notes: input.notes?.trim() || null,
        preparedBy: actor.userId ?? null,
      },
      include,
    });
    logger.info({ id: row.id, fyCode: row.fyCode }, "year-end closing prepared");
    return present(row);
  }

  /** Posts the closing journal and rolls the books into the next year. */
  async approve(id: number, actor: Actor) {
    const row = await prisma.yearEndClosing.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Year-end closing not found");
    if (row.status !== "PREPARED") {
      throw new ApiError(
        409,
        `This closing is ${row.status.toLowerCase()}; only a prepared closing can be approved`,
        "YEAR_END_NOT_PREPARED"
      );
    }
    const fy = fyFromCode(row.fyCode);
    const current = await this.preview(row.fyCode);
    if (current.payloadHash !== row.payloadHash) {
      throw new ApiError(
        409,
        "The books changed since this closing was prepared; discard it and prepare again",
        "YEAR_END_STALE"
      );
    }
    const blockers = current.blockers.filter((b) => !b.includes("already closed"));
    if (blockers.length) throw new ApiError(400, blockers[0], "YEAR_END_BLOCKED");

    return prisma.$transaction(async (tx) => {
      const companyId = requireTenantId();
      const now = new Date();
      let closingVoucherId: number | null = null;
      if (current.lines.length) {
        // Closed periods and the freeze date still apply; the approve permission stands in
        // for a role's backdating allowance, since the entry is dated the year's last day.
        await periodService.assertPostingAllowed(fy.end, { isSuperAdmin: true }, tx);
        const voucherNo = await documentNumberService.next("JOURNAL", { date: fy.end, tx });
        const result = current.netProfit >= 0 ? "profit" : "loss";
        const voucher = await tx.voucher.create({
          data: {
            voucherNo,
            type: VoucherType.JOURNAL,
            date: fy.end,
            narration: `Year-end closing ${fy.periodName}: ${result} transferred to ${current.retainedEarnings.name}`,
            refDocType: YEAR_END_REF,
            refDocId: String(row.id),
            createdBy: actor.userId ?? undefined,
            items: {
              create: current.lines.map((l) =>
                l.side === "DEBIT"
                  ? {
                      debitLedgerId: l.ledgerId,
                      debitAmount: D(l.amount),
                      creditAmount: D(0),
                      narration: `Closing ${fy.code}: ${l.name}`.slice(0, 255),
                    }
                  : {
                      creditLedgerId: l.ledgerId,
                      debitAmount: D(0),
                      creditAmount: D(l.amount),
                      narration: `Closing ${fy.code}: ${l.name}`.slice(0, 255),
                    }
              ),
            },
          },
        });
        closingVoucherId = voucher.id;
      }

      // The year's periods (and any earlier one still open) close; the next year opens.
      await tx.accountingPeriod.updateMany({
        where: { isClosed: false, endDate: { lte: fy.end } },
        data: { isClosed: true, closedAt: now, closedBy: actor.userId ?? null },
      });
      const next = nextFinancialYear(fy);
      const nextPeriod = await tx.accountingPeriod.findFirst({
        where: { startDate: { lte: next.start }, endDate: { gte: next.start } },
      });
      if (!nextPeriod) {
        await tx.accountingPeriod.create({
          data: { periodName: next.periodName, startDate: next.start, endDate: next.end },
        });
      }
      for (const seq of SEQUENCED_DOC_TYPES) {
        const found = await tx.documentSequence.findFirst({
          where: { docType: seq.docType, businessPlaceId: null, fyCode: next.code },
        });
        if (!found) {
          await tx.documentSequence.create({
            data: { docType: seq.docType, prefix: seq.prefix, fyCode: next.code },
          });
        }
      }
      const frozen = await periodService.freezeDate(tx);
      if (!frozen || frozen < fy.end) {
        await tx.company.update({ where: { id: companyId }, data: { booksFrozenUpTo: fy.end } });
      }
      const setting = await tx.invoiceSetting.findUnique({ where: { companyId } });
      if (setting && setting.financialYearStart <= fy.start) {
        await tx.invoiceSetting.update({
          where: { companyId },
          data: { financialYearStart: next.start, financialYearEnd: next.end },
        });
      }

      const updated = await tx.yearEndClosing.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedBy: actor.userId ?? null,
          approvedAt: now,
          closingVoucherId,
        },
        include,
      });
      logger.info(
        { id, fyCode: row.fyCode, voucherId: closingVoucherId },
        "year-end closing approved"
      );
      return present(updated);
    });
  }

  /** Cancels the closing journal (with a reversal) and reopens the year for postings. */
  async reverse(id: number, reason: string, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.yearEndClosing.findUnique({ where: { id } });
      if (!row) throw new ApiError(404, "Year-end closing not found");
      if (row.status !== "APPROVED") {
        throw new ApiError(
          409,
          `This closing is ${row.status.toLowerCase()}; only an approved closing can be reversed`,
          "YEAR_END_NOT_APPROVED"
        );
      }
      const fy = fyFromCode(row.fyCode);
      const frozen = await periodService.freezeDate(tx);
      if (frozen && frozen >= fy.end) {
        throw new ApiError(
          409,
          `Books are frozen up to ${isoDay(frozen)}; move the freeze date back before reversing ${fy.periodName}`,
          "BOOKS_FROZEN"
        );
      }
      if (row.closingVoucherId) {
        await cancellationService.cancelVoucher(
          row.closingVoucherId,
          { reason: `Year-end closing ${fy.code} reversed: ${reason}`, actor },
          tx
        );
      }
      const updated = await tx.yearEndClosing.update({
        where: { id },
        data: {
          status: "REVERSED",
          reversedBy: actor.userId ?? null,
          reversedAt: new Date(),
          reverseReason: reason.trim(),
        },
        include,
      });
      logger.info({ id, fyCode: row.fyCode }, "year-end closing reversed");
      return present(updated);
    });
  }

  async discard(id: number, actor: Actor) {
    const row = await prisma.yearEndClosing.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Year-end closing not found");
    if (row.status !== "PREPARED") {
      throw new ApiError(409, "Only a prepared closing can be discarded", "YEAR_END_NOT_PREPARED");
    }
    const updated = await prisma.yearEndClosing.update({
      where: { id },
      data: { status: "DISCARDED", reversedBy: actor.userId ?? null, reversedAt: new Date() },
      include,
    });
    return present(updated);
  }
}

export const yearEndService = new YearEndService();
