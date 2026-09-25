import { Prisma, VoucherType, type ChequeKind } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import { notify } from "../notifications/notify";
import { safeCreateVoucher, voucherPostingService } from "../accounts/voucherPosting.service";
import {
  dedupeHash,
  normaliseRef,
  parseStatement,
  type ColumnMap,
  type StatementFormat,
} from "./statement.parse";

/**
 * Bank reconciliation and cheques (P1-20).
 *
 * Matching is the part worth being careful about. A statement line and a voucher agreeing on
 * amount alone is not a match — a company that pays three suppliers ₹50,000 on the same day would
 * have three wrong matches and no way of knowing. So a match needs the amount *and* something
 * else, the confidence says how much else, and anything below the bar is left for a person.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (v: string | Date) =>
  new Date(typeof v === "string" ? `${v.slice(0, 10)}T00:00:00Z` : v);

/** How close the dates have to be before a match is even considered. */
export const DATE_TOLERANCE_DAYS = 5;
/** Below this, the match is a suggestion for a person rather than something to record. */
export const AUTO_MATCH_FLOOR = 80;

export interface MatchCandidate {
  voucherId: number;
  voucherNo: string;
  date: string;
  amount: number;
  narration: string | null;
  confidence: number;
  why: string[];
}

class BankingService {
  // ── Statements ─────────────────────────────────────────────────────────────
  async statements(bankAccountId?: string) {
    return prisma.bankStatement.findMany({
      where: bankAccountId ? { bankAccountId } : {},
      include: { bankAccount: { select: { bankName: true, accountNumber: true } } },
      orderBy: { fromDate: "desc" },
      take: 100,
    });
  }

  /**
   * Reads a statement file and stores its lines.
   *
   * Re-importing an overlapping statement is normal — a bank's export runs to the day you asked
   * for — so each line is hashed on its date, amount and reference and a row already on file is
   * counted and skipped rather than doubling the bank.
   */
  async importStatement(
    input: {
      bankAccountId: string;
      format: StatementFormat;
      csv: string;
      fileName?: string | null;
      columnMap?: Partial<ColumnMap>;
    },
    actor: { userId?: string }
  ) {
    const account = await prisma.bankAccount.findUnique({ where: { id: input.bankAccountId } });
    if (!account) throw new ApiError(404, "That bank account does not exist");
    const lines = parseStatement(input.csv, input.format, input.columnMap);
    const dates = lines.map((l) => l.txnDate.getTime());
    const fromDate = new Date(Math.min(...dates));
    const toDate = new Date(Math.max(...dates));

    const existing = await prisma.bankStatementLine.findMany({
      where: { bankAccountId: input.bankAccountId, txnDate: { gte: fromDate, lte: toDate } },
      select: { dedupeHash: true },
    });
    const seen = new Set(existing.map((e) => e.dedupeHash));

    const fresh = lines.filter((l) => !seen.has(dedupeHash(l)));
    const balances = lines.map((l) => l.runningBalance).filter((b): b is number => b !== null);

    const statement = await prisma.bankStatement.create({
      data: {
        bankAccountId: input.bankAccountId,
        format: input.format,
        fileName: input.fileName ?? null,
        fromDate,
        toDate,
        openingBalance: balances.length > 0 ? n2(balances[0]) : 0,
        closingBalance: balances.length > 0 ? n2(balances[balances.length - 1]) : 0,
        rowCount: fresh.length,
        duplicateCount: lines.length - fresh.length,
        importedBy: actor.userId?.slice(0, 36) ?? null,
      },
    });

    if (fresh.length > 0) {
      await prisma.bankStatementLine.createMany({
        data: fresh.map((l) => ({
          statementId: statement.id,
          bankAccountId: input.bankAccountId,
          txnDate: l.txnDate,
          valueDate: l.valueDate,
          description: l.description,
          refNo: l.refNo,
          debit: l.debit,
          credit: l.credit,
          runningBalance: l.runningBalance,
          normalisedRef: normaliseRef(l.refNo),
          dedupeHash: dedupeHash(l),
        })),
        skipDuplicates: true,
      });
    }

    return {
      ...statement,
      read: lines.length,
      imported: fresh.length,
      skippedAsDuplicates: lines.length - fresh.length,
    };
  }

  async lines(params: { bankAccountId?: string; status?: string; from?: Date; to?: Date } = {}) {
    return prisma.bankStatementLine.findMany({
      where: {
        ...(params.bankAccountId ? { bankAccountId: params.bankAccountId } : {}),
        ...(params.status ? { status: params.status as "UNMATCHED" } : {}),
        ...(params.from || params.to
          ? {
              txnDate: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  /**
   * What a statement line might be.
   *
   * Amount and direction get it into the running; the date and the reference decide how sure we
   * are. A line scoring on amount alone is deliberately below the automatic bar, because three
   * payments of the same amount on the same day is an ordinary Tuesday.
   */
  async candidatesFor(lineId: string): Promise<MatchCandidate[]> {
    const line = await prisma.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line) throw new ApiError(404, "That statement line does not exist");
    const account = await prisma.bankAccount.findUnique({ where: { id: line.bankAccountId } });
    if (!account) throw new ApiError(404, "That bank account is gone");

    const amount = n2(Number(line.debit) > 0 ? line.debit : line.credit);
    const moneyOut = Number(line.debit) > 0;
    const window = DATE_TOLERANCE_DAYS * 86400000;

    const items = await prisma.journalItem.findMany({
      where: {
        voucher: {
          status: "POSTED",
          date: {
            gte: new Date(line.txnDate.getTime() - window),
            lte: new Date(line.txnDate.getTime() + window),
          },
        },
        // Money out of the bank is a credit to the bank ledger, and money in a debit.
        ...(moneyOut ? { creditLedgerId: account.ledgerId } : { debitLedgerId: account.ledgerId }),
      },
      include: { voucher: { select: { id: true, voucherNo: true, date: true, narration: true } } },
      take: 200,
    });

    const out: MatchCandidate[] = [];
    for (const item of items) {
      const itemAmount = n2(moneyOut ? item.creditAmount : item.debitAmount);
      if (Math.abs(itemAmount - amount) > 0.01) continue;
      const why: string[] = ["the amount is the same"];
      let confidence = 50;

      const days = Math.round(
        Math.abs(item.voucher.date.getTime() - line.txnDate.getTime()) / 86400000
      );
      if (days === 0) {
        confidence += 30;
        why.push("the date is the same");
      } else if (days <= 2) {
        confidence += 20;
        why.push(`the date is ${days} day(s) apart`);
      } else {
        confidence += 5;
        why.push(`the date is ${days} day(s) apart`);
      }

      const ref = line.normalisedRef;
      const haystack = normaliseRef(
        `${item.voucher.voucherNo} ${item.voucher.narration ?? ""} ${item.narration ?? ""}`
      );
      if (ref && haystack && haystack.includes(ref)) {
        confidence += 25;
        why.push("the reference appears on the voucher");
      }

      out.push({
        voucherId: item.voucher.id,
        voucherNo: item.voucher.voucherNo,
        date: iso(item.voucher.date),
        amount: itemAmount,
        narration: item.voucher.narration,
        confidence: Math.min(confidence, 100),
        why,
      });
    }
    return out.sort((a, b) => b.confidence - a.confidence);
  }

  /** Matches everything it is sure about and leaves the rest alone. */
  async autoMatch(bankAccountId: string, actor: { userId?: string }) {
    const lines = await prisma.bankStatementLine.findMany({
      where: { bankAccountId, status: "UNMATCHED" },
      take: 500,
    });
    let matched = 0;
    const unsure: { lineId: string; best: number }[] = [];
    for (const line of lines) {
      const candidates = await this.candidatesFor(line.id);
      const best = candidates[0];
      if (!best) continue;
      // Two candidates equally sure is not a match, it is a coincidence.
      const ambiguous = candidates.length > 1 && candidates[1].confidence === best.confidence;
      if (best.confidence < AUTO_MATCH_FLOOR || ambiguous) {
        unsure.push({ lineId: line.id, best: best.confidence });
        continue;
      }
      await prisma.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: "MATCHED",
          matchedVoucherId: best.voucherId,
          matchConfidence: best.confidence,
          matchedBy: actor.userId?.slice(0, 36) ?? null,
          matchedAt: new Date(),
        },
      });
      matched++;
    }
    return { considered: lines.length, matched, leftForAPerson: unsure.length };
  }

  /** A person's match, which is always right as far as the system is concerned. */
  async match(lineId: string, voucherId: number, actor: { userId?: string }) {
    const voucher = await prisma.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) throw new ApiError(404, "That voucher does not exist");
    return prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        status: "MATCHED",
        matchedVoucherId: voucherId,
        matchConfidence: 100,
        matchedBy: actor.userId?.slice(0, 36) ?? null,
        matchedAt: new Date(),
      },
    });
  }

  async unmatch(lineId: string) {
    return prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: "UNMATCHED", matchedVoucherId: null, matchConfidence: null, matchedAt: null },
    });
  }

  async ignore(lineId: string, note: string) {
    return prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: "IGNORED", notes: note.slice(0, 255) },
    });
  }

  /**
   * The reconciliation statement.
   *
   * Book balance, then the things the two sides disagree about, then the bank balance. It has to
   * add up — if it does not, the report says so rather than presenting a difference as if it were
   * explained.
   */
  async brs(bankAccountId: string, asOn: Date) {
    const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!account) throw new ApiError(404, "That bank account does not exist");

    const items = await prisma.journalItem.findMany({
      where: {
        voucher: { status: "POSTED", date: { lte: asOn } },
        OR: [{ debitLedgerId: account.ledgerId }, { creditLedgerId: account.ledgerId }],
      },
      select: {
        debitLedgerId: true,
        creditLedgerId: true,
        debitAmount: true,
        creditAmount: true,
        voucherId: true,
      },
      take: 20000,
    });
    const bookBalance = n2(
      items.reduce(
        (s, i) =>
          s +
          (i.debitLedgerId === account.ledgerId ? Number(i.debitAmount) : 0) -
          (i.creditLedgerId === account.ledgerId ? Number(i.creditAmount) : 0),
        0
      )
    );

    const lines = await prisma.bankStatementLine.findMany({
      where: { bankAccountId, txnDate: { lte: asOn } },
      orderBy: { txnDate: "asc" },
    });
    const lastWithBalance = [...lines].reverse().find((l) => l.runningBalance !== null);
    const bankBalance = lastWithBalance ? n2(lastWithBalance.runningBalance) : null;

    const matchedVoucherIds = new Set(
      lines.filter((l) => l.matchedVoucherId !== null).map((l) => l.matchedVoucherId as number)
    );
    // In the books but not on the statement: a cheque issued and not presented, or a deposit the
    // bank has not credited.
    const inBooksOnly = items.filter((i) => !matchedVoucherIds.has(i.voucherId));
    const unpresented = n2(
      inBooksOnly.reduce(
        (s, i) => s + (i.creditLedgerId === account.ledgerId ? Number(i.creditAmount) : 0),
        0
      )
    );
    const uncredited = n2(
      inBooksOnly.reduce(
        (s, i) => s + (i.debitLedgerId === account.ledgerId ? Number(i.debitAmount) : 0),
        0
      )
    );
    // On the statement and not in the books: charges, interest, direct credits.
    const unmatchedLines = lines.filter((l) => l.status === "UNMATCHED");
    const notInBooksDebits = n2(unmatchedLines.reduce((s, l) => s + Number(l.debit), 0));
    const notInBooksCredits = n2(unmatchedLines.reduce((s, l) => s + Number(l.credit), 0));

    const reconciled = n2(
      bookBalance + unpresented - uncredited - notInBooksDebits + notInBooksCredits
    );
    return {
      bankAccountId,
      asOn: iso(asOn),
      bookBalance,
      bankBalance,
      reconcilingItems: {
        chequesIssuedNotPresented: unpresented,
        depositsNotYetCredited: uncredited,
        chargesNotInBooks: notInBooksDebits,
        creditsNotInBooks: notInBooksCredits,
      },
      reconciledBalance: reconciled,
      // Named rather than hidden: an unexplained difference is the whole point of the exercise.
      difference: bankBalance === null ? null : n2(bankBalance - reconciled),
      unmatchedLines: unmatchedLines.length,
    };
  }

  // ── Cheques ────────────────────────────────────────────────────────────────
  async cheques(params: { kind?: ChequeKind; status?: string; dueBy?: Date } = {}) {
    return prisma.cheque.findMany({
      where: {
        ...(params.kind ? { kind: params.kind } : {}),
        ...(params.status ? { status: params.status as "IN_HAND" } : {}),
        ...(params.dueBy ? { chequeDate: { lte: params.dueBy } } : {}),
      },
      orderBy: { chequeDate: "asc" },
      take: 500,
    });
  }

  async addCheque(
    input: {
      kind: ChequeKind;
      chequeNo: string;
      chequeDate: string | Date;
      amount: number;
      bankName?: string | null;
      partyName?: string | null;
      customerId?: string | null;
      supplierId?: number | null;
      bankAccountId?: string | null;
      refDocType?: string | null;
      refDocId?: string | null;
      notes?: string | null;
    },
    actor: { userId?: string }
  ) {
    if (input.amount <= 0) throw new ApiError(400, "A cheque has to have an amount");
    const chequeDate = asDate(input.chequeDate);
    const duplicate = await prisma.cheque.findFirst({
      where: { kind: input.kind, chequeNo: input.chequeNo.trim(), chequeDate },
    });
    if (duplicate) {
      throw new ApiError(409, "That cheque is already on the register", "DUPLICATE_CHEQUE");
    }
    return prisma.cheque.create({
      data: {
        kind: input.kind,
        chequeNo: input.chequeNo.trim().slice(0, 20),
        chequeDate,
        amount: n2(input.amount),
        bankName: input.bankName ?? null,
        partyName: input.partyName ?? null,
        customerId: input.customerId ?? null,
        supplierId: input.supplierId ?? null,
        bankAccountId: input.bankAccountId ?? null,
        refDocType: input.refDocType ?? null,
        refDocId: input.refDocId ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
  }

  /** Moves a cheque along its life: deposited, cleared, bounced or cancelled. */
  async updateCheque(
    id: string,
    input: {
      status: "DEPOSITED" | "CLEARED" | "BOUNCED" | "CANCELLED";
      on?: string | Date;
      bankAccountId?: string | null;
      bounceCharges?: number;
      bounceReason?: string | null;
    },
    actor: { userId?: string }
  ) {
    const cheque = await prisma.cheque.findUnique({ where: { id } });
    if (!cheque) throw new ApiError(404, "That cheque does not exist");
    if (cheque.status === "CLEARED" || cheque.status === "CANCELLED") {
      throw new ApiError(
        409,
        `That cheque is already ${cheque.status.toLowerCase()}`,
        "CHEQUE_CLOSED"
      );
    }
    // A bounced cheque only comes back into the register through re-presentation (P2-06), which
    // posts the receipt/payment again; moving it straight to DEPOSITED or CLEARED would leave the
    // register saying "cleared" while the books still carry the bounce reversal.
    if (cheque.status === "BOUNCED" && input.status !== "CANCELLED") {
      throw new ApiError(
        409,
        "A bounced cheque has to be re-presented before it can clear",
        "CHEQUE_BOUNCED"
      );
    }
    const on = asDate(input.on ?? new Date());

    // A PDC's own receipt/payment never posted (P2-06); clearing it is the moment the money
    // actually moves, so this is where it posts — inside the same update, never before.
    if (
      input.status === "CLEARED" &&
      !cheque.voucherId &&
      cheque.refDocType &&
      cheque.sourceDocId
    ) {
      return prisma.$transaction(async (tx) => {
        if (cheque.refDocType === "SALES_PAYMENT") {
          await voucherPostingService.postReceiptVouchersForSales(
            cheque.sourceDocId!,
            tx,
            [cheque.refDocId!],
            on
          );
        } else if (cheque.refDocType === "GRN_PAYMENT") {
          await voucherPostingService.postPaymentVouchersForGRN(
            cheque.sourceDocId!,
            tx,
            [cheque.refDocId!],
            on
          );
        }
        return tx.cheque.update({
          where: { id },
          data: {
            status: "CLEARED",
            clearedOn: on,
            bankAccountId: input.bankAccountId ?? cheque.bankAccountId,
          },
        });
      });
    }

    if (input.status !== "BOUNCED") {
      return prisma.cheque.update({
        where: { id },
        data: {
          status: input.status,
          bankAccountId: input.bankAccountId ?? cheque.bankAccountId,
          ...(input.status === "DEPOSITED" ? { depositedOn: on } : {}),
          ...(input.status === "CLEARED" ? { clearedOn: on } : {}),
        },
      });
    }

    // A bounce is the expensive one: the receipt comes back off and the bank's charge goes on.
    const charges = n2(input.bounceCharges ?? 0);
    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      await periodService.assertPostingAllowed(on, undefined, tx);
      const ledger = async (code: string) => {
        const row = await tx.accountLedger.findFirst({ where: { code } });
        if (!row) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
        return row;
      };
      const bankLedgerId = cheque.bankAccountId
        ? (await tx.bankAccount.findUnique({ where: { id: cheque.bankAccountId } }))?.ledgerId
        : undefined;
      const bank = bankLedgerId
        ? await tx.accountLedger.findUniqueOrThrow({ where: { id: bankLedgerId } })
        : await ledger("BANK-001");
      const party =
        cheque.kind === "RECEIVED" ? await ledger("DEBT-001") : await ledger("CRED-001");
      const charge = await ledger("BANK-CHG-001");

      const D = (n: number) => new Prisma.Decimal(n2(n));
      const amount = n2(cheque.amount);
      const items: Prisma.JournalItemUncheckedCreateWithoutVoucherInput[] = [];
      if (cheque.kind === "RECEIVED") {
        // The money never arrived: the customer owes it again.
        items.push({
          debitLedgerId: party.id,
          debitAmount: D(amount),
          creditAmount: D(0),
          narration: `Cheque ${cheque.chequeNo} returned`,
        });
        items.push({
          creditLedgerId: bank.id,
          debitAmount: D(0),
          creditAmount: D(amount),
          narration: `Cheque ${cheque.chequeNo} returned`,
        });
      } else {
        items.push({
          debitLedgerId: bank.id,
          debitAmount: D(amount),
          creditAmount: D(0),
          narration: `Cheque ${cheque.chequeNo} returned`,
        });
        items.push({
          creditLedgerId: party.id,
          debitAmount: D(0),
          creditAmount: D(amount),
          narration: `Cheque ${cheque.chequeNo} returned`,
        });
      }
      if (charges > 0) {
        items.push({
          debitLedgerId: charge.id,
          debitAmount: D(charges),
          creditAmount: D(0),
          narration: `Return charges on ${cheque.chequeNo}`,
        });
        items.push({
          creditLedgerId: bank.id,
          debitAmount: D(0),
          creditAmount: D(charges),
          narration: `Return charges on ${cheque.chequeNo}`,
        });
      }

      const voucher = await tx.voucher.create({
        data: {
          voucherNo: `CHQR-${cheque.chequeNo}`.slice(0, 30),
          type: VoucherType.JOURNAL,
          date: on,
          narration: `Cheque ${cheque.chequeNo} returned unpaid`,
          refDocType: "CHEQUE_BOUNCE",
          refDocId: cheque.id,
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: items },
        },
      });

      return tx.cheque.update({
        where: { id },
        data: {
          status: "BOUNCED",
          bouncedOn: on,
          bounceCharges: charges,
          bounceReason: input.bounceReason ?? null,
          reversalVoucherId: voucher.id,
        },
      });
    });
  }

  /**
   * Re-presentation (P2-06): a bounced cheque goes in again and, this time, clears. The receipt
   * or payment posts a second time — a fresh voucher, never the original one reused — and the
   * cheque moves to DEPOSITED so clearing works exactly as it would for a cheque that never
   * bounced. `presentedCount` gives every attempt its own `refDocId`, so calling this on the same
   * cheque twice in a row (it is no longer BOUNCED after the first call) cannot double-post.
   */
  async rePresent(id: string, actor: { userId?: string }) {
    const cheque = await prisma.cheque.findUnique({ where: { id } });
    if (!cheque) throw new ApiError(404, "That cheque does not exist");
    if (cheque.status !== "BOUNCED") {
      throw new ApiError(409, "Only a bounced cheque can be re-presented", "CHEQUE_NOT_BOUNCED");
    }

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      const on = new Date();
      await periodService.assertPostingAllowed(on, undefined, tx);
      const ledger = async (code: string) => {
        const row = await tx.accountLedger.findFirst({ where: { code } });
        if (!row) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
        return row;
      };
      const bankLedgerId = cheque.bankAccountId
        ? (await tx.bankAccount.findUnique({ where: { id: cheque.bankAccountId } }))?.ledgerId
        : undefined;
      const bank = bankLedgerId
        ? await tx.accountLedger.findUniqueOrThrow({ where: { id: bankLedgerId } })
        : await ledger("BANK-001");

      // The same ledger the bounce reversal hit (the generic DEBT-001/CRED-001, not the specific
      // customer/supplier ledger — see `updateCheque`'s own bounce branch above): re-presenting
      // has to reverse exactly what bouncing posted, on the same account.
      const party = await ledger(cheque.kind === "RECEIVED" ? "DEBT-001" : "CRED-001");

      const amount = n2(cheque.amount);
      const presentedCount = cheque.presentedCount + 1;
      // Voucher.refDocId is 36 characters; a plain uuid already fills that, so the attempt
      // number replaces the dashes rather than following them.
      const refDocId = `${cheque.id.replace(/-/g, "")}${presentedCount}`.slice(0, 36);
      const D = (n: number) => new Prisma.Decimal(n2(n));
      const items: Prisma.JournalItemUncheckedCreateWithoutVoucherInput[] =
        cheque.kind === "RECEIVED"
          ? [
              {
                debitLedgerId: bank.id,
                debitAmount: D(amount),
                creditAmount: D(0),
                narration: `Cheque ${cheque.chequeNo} re-presented`,
              },
              {
                creditLedgerId: party.id,
                debitAmount: D(0),
                creditAmount: D(amount),
                narration: `Cheque ${cheque.chequeNo} re-presented`,
              },
            ]
          : [
              {
                debitLedgerId: party.id,
                debitAmount: D(amount),
                creditAmount: D(0),
                narration: `Cheque ${cheque.chequeNo} re-presented`,
              },
              {
                creditLedgerId: bank.id,
                debitAmount: D(0),
                creditAmount: D(amount),
                narration: `Cheque ${cheque.chequeNo} re-presented`,
              },
            ];

      const voucher = await safeCreateVoucher(
        tx,
        {
          voucherNo: `CHQP-${cheque.chequeNo}-${presentedCount}`.slice(0, 30),
          type: cheque.kind === "RECEIVED" ? VoucherType.RECEIPT : VoucherType.PAYMENT,
          date: on,
          narration: `Cheque ${cheque.chequeNo} re-presented after bouncing`,
          refDocType: "CHEQUE_REPRESENT",
          refDocId,
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: items },
        },
        "CHEQUE_REPRESENT",
        refDocId
      );

      return tx.cheque.update({
        where: { id },
        data: {
          status: "DEPOSITED",
          depositedOn: on,
          presentedCount,
          voucherId: voucher.id,
        },
      });
    });
  }

  /** Cheques whose date has arrived and which are still sitting in a drawer. */
  async dueToday(on = new Date()) {
    const rows = await prisma.cheque.findMany({
      where: { status: "IN_HAND", chequeDate: { lte: asDate(on) } },
      orderBy: { chequeDate: "asc" },
      take: 200,
    });
    return {
      asOn: iso(asDate(on)),
      count: rows.length,
      total: n2(rows.reduce((s, c) => s + Number(c.amount), 0)),
      rows,
    };
  }

  /**
   * The daily nudge (P2-01): every post-dated cheque, received or issued, still `IN_HAND` and due
   * today or within the next two days. Same shape as the MSME day-30/day-43 warning — the link
   * carries the cheque and the day it fired for, so a person sees it once per cheque per day
   * rather than every day until it is presented.
   *
   * A cheque that has bounced and not been re-presented (P2-17) is not "due" in any useful sense
   * — the paper already failed once, and nagging about its original date only tells the reader
   * something they already know — so it is skipped rather than warned about. One that HAS been
   * re-presented (`presentedCount > 0`) and is still working its way through the bank (`status
   * DEPOSITED`, not yet `CLEARED`) gets its own message rather than the ordinary due-date one, so
   * the reader knows this is the second attempt, not the first.
   */
  async warnDueCheques(today = new Date()) {
    const from = asDate(today);
    const to = new Date(from.getTime() + 2 * 86400000);
    const rows = await prisma.cheque.findMany({
      where: {
        status: { in: ["IN_HAND", "DEPOSITED", "BOUNCED"] },
        chequeDate: { gte: from, lte: to },
      },
      orderBy: { chequeDate: "asc" },
      take: 500,
    });
    let sent = 0;
    for (const c of rows) {
      // BOUNCED and not yet re-presented: nothing useful to warn about (P2-17).
      if (c.status === "BOUNCED") continue;
      // A cheque deposited the ordinary way (never bounced) is already in the bank's hands and
      // does not need a due-date nudge; only a re-presented one gets a message here.
      if (c.status === "DEPOSITED" && c.presentedCount === 0) continue;

      const daysLeft = Math.round((asDate(c.chequeDate).getTime() - from.getTime()) / 86400000);
      const link = `/accounts/bank-reconciliation?cheque=${c.id}&d=${iso(from)}`;
      const already = await prisma.notification.findFirst({
        where: { category: "banking-cheque", link },
        select: { id: true },
      });
      if (already) continue;
      const who = c.kind === "ISSUED" ? "Issued to" : "Received from";
      const when = daysLeft <= 0 ? "today" : `in ${daysLeft} day(s)`;
      const rePresented = c.presentedCount > 0;
      await notify({
        category: "banking-cheque",
        title: rePresented
          ? `Cheque ${c.chequeNo} (re-presented): ₹${n2(c.amount).toFixed(2)} due ${when}`
          : `Cheque ${c.chequeNo}: ₹${n2(c.amount).toFixed(2)} due ${when}`,
        body: rePresented
          ? `${who} ${c.partyName ?? "party"}, dated ${iso(asDate(c.chequeDate))} — re-presented after bouncing.`
          : `${who} ${c.partyName ?? "party"}, dated ${iso(asDate(c.chequeDate))}.`,
        link,
        to: { permission: "banking.view" },
        level: daysLeft <= 0 ? "WARNING" : "INFO",
      });
      sent++;
    }
    return { checked: rows.length, sent };
  }

  /** The daily sweep across every tenant. */
  async sweepDueCheques(today = new Date()) {
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let sent = 0;
    for (const c of companies) {
      try {
        const res = await runAsTenant(c.id, () => this.warnDueCheques(today));
        sent += res.sent;
      } catch (err) {
        logger.error({ companyId: c.id, err }, "Cheque due-date sweep failed for a tenant");
      }
    }
    return { companies: companies.length, sent };
  }
}

export const bankingService = new BankingService();
