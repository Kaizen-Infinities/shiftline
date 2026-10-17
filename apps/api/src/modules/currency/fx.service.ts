import { Prisma, VoucherType } from "@prisma/client";

import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId, runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import { currencyService } from "./currency.service";
import { rateProviderFor } from "./providers";

/**
 * Foreign exchange differences (P1-17).
 *
 * A foreign-currency bill is worth what the rupee says it is worth, and the rupee moves. Two
 * differences come out of that, and they are not the same thing:
 *
 *  - **Realised.** The bill was raised at one rate and settled at another. That difference is a
 *    fact and belongs in the accounts on the day the money moved.
 *  - **Unrealised.** The bill is still open at a period end and has to be restated at the closing
 *    rate (AS 11 / Ind AS 21). That difference is an *opinion about a rate*, so the entry posts
 *    on the last day of the period and **reverses on the first day of the next one** — otherwise
 *    the month the bill is finally settled counts the same movement twice.
 *
 * The reversal is the part that gets forgotten, and it is the part that silently doubles a year's
 * exchange gain.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Db = Prisma.TransactionClient | typeof prisma;
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
const ledgerByCode = async (db: Db, code: string) => {
  const row = await db.accountLedger.findFirst({ where: { code } });
  if (!row) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
  return row;
};

export interface FxLine {
  documentType: string;
  documentId: string;
  documentNo: string;
  partyName: string;
  /** The party's own ledger (P2-06): the restatement posts against this, not a net Sundry line. */
  partyLedgerCode: string;
  currencyCode: string;
  foreignAmount: number;
  /** What the books carry it at: the rate on the day it was raised. */
  bookedRate: number;
  bookedInr: number;
  /** What it is worth at the closing rate. */
  closingRate: number;
  restatedInr: number;
  /** Positive is a gain to the company, negative a loss. */
  difference: number;
}

class FxService {
  /** Pulls a day's rates from a provider and stores whatever came back. */
  async pullRates(input: { on: Date; provider?: string; currencies?: string[] }) {
    const provider = rateProviderFor(input.provider ?? "FIXTURE");
    const wanted =
      input.currencies ??
      (await currencyService.list()).map((c) => c.code).filter((c) => c !== "INR");
    const quotes = await provider.fetch(input.on, wanted);
    for (const q of quotes) {
      await currencyService.setRate({
        currencyCode: q.currencyCode,
        rate: q.rate,
        rateDate: q.on,
        source: "RBI",
      });
    }
    return {
      provider: provider.name,
      on: iso(input.on),
      fetched: quotes.length,
      // Saying what did *not* come back matters: a holiday has no RBI rate at all, and a caller
      // that treats the gap as zero puts a zero rate into the books.
      missing: wanted.filter((c) => !quotes.some((q) => q.currencyCode === c)),
    };
  }

  /**
   * The realised difference on settling a foreign-currency document.
   *
   * `bookedRate` is what the document was raised at and `settledRate` what the money actually
   * came in at; the gain or loss is the gap, on the amount settled.
   */
  async realise(
    input: {
      documentType: string;
      documentId: string;
      documentNo: string;
      partyLedgerCode: string;
      currencyCode: string;
      foreignAmount: number;
      bookedRate: number;
      settledRate: number;
      on: Date | string;
      narration?: string | null;
    },
    actor: { userId?: string },
    txClient?: Db
  ) {
    const on = new Date(
      typeof input.on === "string" ? `${input.on.slice(0, 10)}T00:00:00Z` : input.on
    );
    const difference = n2(input.foreignAmount * (input.settledRate - input.bookedRate));
    if (Math.abs(difference) < 0.01) {
      return { posted: false, difference: 0, voucherId: null as number | null };
    }

    // Called from inside a receipt/payment's own transaction (P2-06) so the settlement voucher
    // and the realised gain/loss either both land or neither does; standalone callers (the web
    // FX screen) get their own transaction as before.
    const run = async (tx: Prisma.TransactionClient | typeof prisma) => {
      await accountsService.ensureSystemLedgersExist(tx);
      await periodService.assertPostingAllowed(on, undefined, tx);
      const party = await ledgerByCode(tx, input.partyLedgerCode);
      const gain = await ledgerByCode(tx, "FX-GAIN-001");
      const loss = await ledgerByCode(tx, "FX-LOSS-001");
      const label = `${input.documentNo} (${input.currencyCode} at ${input.settledRate} against ${input.bookedRate})`;

      // A receivable worth more rupees than it was booked at is a gain; the party account carries
      // the correction so its balance still agrees with what is actually owed.
      const items: Line[] =
        difference > 0
          ? [
              debit(party.id, difference, `Exchange gain — ${label}`),
              credit(gain.id, difference, `Exchange gain — ${label}`),
            ]
          : [
              debit(loss.id, -difference, `Exchange loss — ${label}`),
              credit(party.id, -difference, `Exchange loss — ${label}`),
            ];

      const existing = await tx.voucher.findFirst({
        where: { refDocType: "FX_REALISED", refDocId: input.documentId, status: "POSTED" },
      });
      if (existing) return { posted: false, difference, voucherId: existing.id };

      const voucher = await tx.voucher.create({
        data: {
          voucherNo: `FXR-${input.documentNo}`.slice(0, 30),
          type: VoucherType.JOURNAL,
          date: on,
          narration: input.narration ?? `Exchange difference on ${input.documentNo}`,
          refDocType: "FX_REALISED",
          refDocId: input.documentId,
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: items },
        },
      });
      return { posted: true, difference, voucherId: voucher.id };
    };

    return txClient ? run(txClient) : prisma.$transaction((tx) => run(tx));
  }

  /**
   * What is still open in a foreign currency at a date, restated at the closing rate.
   *
   * Only documents that carry a currency and a rate are in scope; a rupee invoice has no
   * exchange difference to have.
   */
  async openExposure(asOn: Date): Promise<FxLine[]> {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        invoiceDate: { lte: asOn },
        status: { not: "CANCELLED" },
        currencyCode: { not: "INR" },
      },
      include: {
        customer: { select: { id: true, customerCode: true, firmName: true } },
        paymentRecords: true,
      },
      take: 1000,
    });

    const lines: FxLine[] = [];
    for (const inv of invoices) {
      const currencyCode = inv.currencyCode ?? "INR";
      const bookedRate = Number(inv.exchangeRate ?? 1);
      if (currencyCode === "INR" || bookedRate <= 0) continue;
      if (!inv.customer) continue;
      const paidInr = n2(
        inv.paymentRecords
          .filter((p) => p.paymentDate <= asOn)
          .reduce((s, p) => s + Number(p.amount), 0)
      );
      const outstandingInr = n2(Number(inv.grandTotal) - paidInr);
      if (outstandingInr <= 0.009) continue;
      // The foreign balance is what is left, at the rate it was booked at.
      const foreignAmount = n2(outstandingInr / bookedRate);
      const closingRate = await currencyService.rateFor(currencyCode, asOn).catch(() => 0);
      if (!closingRate) continue;
      const restatedInr = n2(foreignAmount * closingRate);
      const partyLedger = await accountsService.ensureCustomerLedger(inv.customer);
      lines.push({
        documentType: "SALES_INVOICE",
        documentId: inv.id,
        documentNo: inv.invoiceNo,
        partyName: inv.customer.firmName ?? "",
        partyLedgerCode: partyLedger.code,
        currencyCode,
        foreignAmount,
        bookedRate,
        bookedInr: outstandingInr,
        closingRate,
        restatedInr,
        difference: n2(restatedInr - outstandingInr),
      });
    }

    // Payables (P2-06): a foreign-currency GRN invoice is worth restating exactly the same way,
    // just on the other side of the books — a gain to us is what we now owe fewer rupees for.
    const bills = await prisma.grnInvoice.findMany({
      where: {
        grnDate: { lte: asOn },
        status: { not: "CANCELLED" },
        currencyCode: { not: "INR" },
      },
      include: {
        supplier: { select: { id: true, supplierCode: true, legalName: true } },
        paymentRecords: true,
      },
      take: 1000,
    });
    for (const bill of bills) {
      const currencyCode = bill.currencyCode ?? "INR";
      const bookedRate = Number(bill.exchangeRate ?? 1);
      if (currencyCode === "INR" || bookedRate <= 0) continue;
      if (!bill.supplier) continue;
      const paidInr = n2(
        bill.paymentRecords
          .filter((p) => p.paymentDate <= asOn)
          .reduce((s, p) => s + Number(p.amount), 0)
      );
      const outstandingInr = n2(Number(bill.netAmount) - paidInr);
      if (outstandingInr <= 0.009) continue;
      const foreignAmount = n2(outstandingInr / bookedRate);
      const closingRate = await currencyService.rateFor(currencyCode, asOn).catch(() => 0);
      if (!closingRate) continue;
      const restatedInr = n2(foreignAmount * closingRate);
      const partyLedger = await accountsService.ensureSupplierLedger(bill.supplier);
      lines.push({
        documentType: "GRN_INVOICE",
        documentId: bill.id,
        documentNo: bill.invoiceNo,
        partyName: bill.supplier.legalName ?? "",
        partyLedgerCode: partyLedger.code,
        currencyCode,
        foreignAmount,
        bookedRate,
        bookedInr: outstandingInr,
        closingRate,
        restatedInr,
        // A payable is worth more when the rupee weakens, but that costs us rather than gains
        // us — so a payable's difference carries the opposite sign to a receivable's.
        difference: n2(outstandingInr - restatedInr),
      });
    }
    return lines;
  }

  /** What a revaluation would post, without writing anything. */
  async previewRevaluation(periodKey: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
    if (!match) throw new ApiError(400, "A period looks like 2026-08");
    const y = Number(match[1]);
    const m = Number(match[2]);
    const asOn = new Date(Date.UTC(y, m, 0));
    const lines = await this.openExposure(asOn);
    return {
      periodKey,
      asOn: iso(asOn),
      lines,
      netAmount: n2(lines.reduce((s, l) => s + l.difference, 0)),
    };
  }

  /**
   * Restates every open foreign-currency balance and posts the difference, with the reversal on
   * day one of the next period in the same transaction — so it is impossible to have one without
   * the other, which is the mistake that doubles a year's exchange gain.
   */
  async revalue(periodKey: string, actor: { userId?: string }) {
    const existing = await prisma.fxRevaluation.findFirst({ where: { periodKey } });
    if (existing && existing.status === "POSTED") {
      throw new ApiError(409, "That period has already been revalued", "ALREADY_REVALUED");
    }
    const preview = await this.previewRevaluation(periodKey);
    if (preview.lines.length === 0) {
      throw new ApiError(400, "Nothing is open in a foreign currency at that date", "NOTHING_OPEN");
    }
    const asOn = new Date(`${preview.asOn}T00:00:00Z`);
    const nextDay = new Date(asOn.getTime() + 86400000);

    // Grouped by the party's own ledger (P2-06) rather than netted to one Sundry Debtors/Creditors
    // line, so a single customer's or supplier's ledger can be checked against the restatement —
    // the total across every party line is exactly the net amount either way.
    const byParty = new Map<string, { partyName: string; amount: number }>();
    for (const line of preview.lines) {
      const row = byParty.get(line.partyLedgerCode) ?? { partyName: line.partyName, amount: 0 };
      row.amount = n2(row.amount + line.difference);
      byParty.set(line.partyLedgerCode, row);
    }

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      await periodService.assertPostingAllowed(asOn, undefined, tx);
      await periodService.assertPostingAllowed(nextDay, undefined, tx);
      const gain = await ledgerByCode(tx, "FX-GAIN-001");
      const loss = await ledgerByCode(tx, "FX-LOSS-001");
      const label = `Restatement at ${preview.asOn}`;

      const build = async (reverse: boolean): Promise<Line[]> => {
        const items: Line[] = [];
        for (const [code, row] of byParty) {
          if (Math.abs(row.amount) < 0.01) continue;
          const party = await ledgerByCode(tx, code);
          const amount = Math.abs(row.amount);
          const isGain = row.amount > 0;
          const partyLine = `${row.partyName} — ${label}`;
          // A gain raises what the party owes us (or lowers what we owe them) and credits the
          // gain ledger; the reversal is the same entry the other way round.
          const raiseParty = isGain !== reverse;
          items.push(
            raiseParty
              ? debit(party.id, amount, partyLine)
              : debit(isGain ? gain.id : loss.id, amount, partyLine),
            raiseParty
              ? credit(isGain ? gain.id : loss.id, amount, partyLine)
              : credit(party.id, amount, partyLine)
          );
        }
        return items;
      };

      const voucher = await tx.voucher.create({
        data: {
          voucherNo: `FXV-${periodKey}`,
          type: VoucherType.JOURNAL,
          date: asOn,
          narration: `Foreign exchange restatement for ${periodKey}`,
          refDocType: "FX_REVALUATION",
          refDocId: `${periodKey}`,
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: await build(false) },
        },
      });
      const reversal = await tx.voucher.create({
        data: {
          voucherNo: `FXV-${periodKey}-REV`,
          type: VoucherType.JOURNAL,
          date: nextDay,
          narration: `Reversal of the foreign exchange restatement for ${periodKey}`,
          refDocType: "FX_REVALUATION_REVERSAL",
          refDocId: `${periodKey}`,
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: await build(true) },
        },
      });

      const data = {
        periodKey,
        asOn,
        status: "POSTED" as const,
        netAmount: preview.netAmount,
        lines: preview.lines as unknown as Prisma.InputJsonValue,
        voucherId: voucher.id,
        reversalVoucherId: reversal.id,
        preparedBy: actor.userId?.slice(0, 36) ?? null,
        postedBy: actor.userId?.slice(0, 36) ?? null,
        postedAt: new Date(),
      };
      return tx.fxRevaluation.upsert({
        where: { companyId_periodKey: { companyId: requireTenantId(), periodKey } },
        create: data,
        update: data,
      });
    });
  }

  async revaluations(limit = 24) {
    return prisma.fxRevaluation.findMany({ orderBy: { periodKey: "desc" }, take: limit });
  }

  /** The daily rate pull across every tenant. */
  async sweepAllTenants(on = new Date()) {
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let pulled = 0;
    for (const c of companies) {
      try {
        const res = await runAsTenant(c.id, () =>
          this.pullRates({ on, provider: env.RATE_PROVIDER })
        );
        pulled += res.fetched;
      } catch (err) {
        logger.error({ companyId: c.id, err }, "Exchange rate pull failed for a tenant");
      }
    }
    return { companies: companies.length, pulled };
  }
}

export const fxService = new FxService();
