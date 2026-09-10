import type { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { YEAR_END_REF } from "../year-end/year-end.constants";
import { accountsService } from "./accounts.service";
import type { CashFlowQuery } from "./books.types";

/**
 * Cash flow statement, indirect method (P1-10b). Every balance-sheet ledger's movement in the
 * period is a cash effect of the opposite sign (an asset that grows absorbed cash; a liability
 * that grows supplied it), classified by the ledger's system group: operating working capital,
 * investing (fixed assets, investments) or financing (capital, reserves, loans). Cash and cash
 * equivalents are cash-in-hand and bank ledgers less bank overdrafts. Depreciation is added back
 * to profit and taken out of the fixed-asset movement, which assumes it is posted against a
 * ledger in the Fixed Assets group (net block), as the seeded chart does.
 *
 * Because every voucher balances, operating + investing + financing equals the change in cash to
 * the paisa; `reconciles` compares that with the opening and closing cash from the trial balance.
 */
const CASH_GROUPS = new Set(["CASH_IN_HAND", "BANK_ACCOUNTS"]);
const OVERDRAFT_GROUPS = new Set(["BANK_OD"]);
const INVESTING_GROUPS = new Set(["FIXED_ASSETS", "INVESTMENTS"]);
const FINANCING_GROUPS = new Set([
  "CAPITAL",
  "RESERVES_SURPLUS",
  "LOANS_LIABILITY",
  "SECURED_LOANS",
  "UNSECURED_LOANS",
]);
const DEPRECIATION_GROUPS = new Set(["DEPRECIATION"]);
const FALLBACK_GROUP: Record<string, { code: string; name: string }> = {
  ASSET: { code: "OTHER_CURRENT_ASSETS", name: "Other Current Assets" },
  LIABILITY: { code: "OTHER_CURRENT_LIABILITIES", name: "Other Current Liabilities" },
  EQUITY: { code: "CAPITAL", name: "Capital Account" },
};

type Section = "operating" | "investing" | "financing" | "cash" | "overdraft" | "pnl";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export interface CashFlowLedgerLine {
  ledgerId: number;
  code: string;
  name: string;
  /** Cash effect: positive is an inflow. */
  amount: number;
}

export interface CashFlowGroupLine {
  groupCode: string;
  groupName: string;
  amount: number;
  ledgers: CashFlowLedgerLine[];
}

class CashFlowService {
  /** Maps every group id to the nearest ancestor that the statement classifies. */
  private async groupResolver() {
    const groups = await prisma.ledgerGroup.findMany({
      select: { id: true, code: true, name: true, parentId: true, isSystem: true },
    });
    const byId = new Map(groups.map((g) => [g.id, g]));
    const known = (code: string) =>
      CASH_GROUPS.has(code) ||
      OVERDRAFT_GROUPS.has(code) ||
      INVESTING_GROUPS.has(code) ||
      FINANCING_GROUPS.has(code) ||
      DEPRECIATION_GROUPS.has(code) ||
      code === "SUSPENSE" ||
      /^(SUNDRY_|STOCK_|LOANS_ADVANCES|DEPOSITS_|TAX_|OTHER_CURRENT|MISC_EXPENSES|PROVISIONS)/.test(
        code
      );
    return (groupId: number | null) => {
      let g = groupId === null ? undefined : byId.get(groupId);
      let hops = 0;
      while (g && !known(g.code) && g.parentId !== null && hops < 20) {
        g = byId.get(g.parentId);
        hops += 1;
      }
      return g ? { code: g.code, name: g.name } : null;
    };
  }

  private sectionOf(type: string, groupCode: string): Section {
    if (type === "INCOME" || type === "EXPENSE") return "pnl";
    if (CASH_GROUPS.has(groupCode)) return "cash";
    if (OVERDRAFT_GROUPS.has(groupCode)) return "overdraft";
    if (INVESTING_GROUPS.has(groupCode)) return "investing";
    if (FINANCING_GROUPS.has(groupCode)) return "financing";
    return "operating";
  }

  async statement(q: CashFlowQuery) {
    if (q.endDate < q.startDate) throw new ApiError(400, "endDate must not be before startDate");
    await accountsService.ensureSystemLedgersExist();
    const resolve = await this.groupResolver();

    const voucher: Prisma.VoucherWhereInput = {
      date: {
        gte: new Date(`${q.startDate}T00:00:00.000Z`),
        lte: new Date(`${q.endDate}T23:59:59.999Z`),
      },
      OR: [{ refDocType: null }, { refDocType: { not: YEAR_END_REF } }],
    };
    const { ledgers, debitSums, creditSums } = await prisma.$transaction(async (tx) => {
      const ledgers = await tx.accountLedger.findMany({
        select: { id: true, code: true, name: true, type: true, groupId: true },
        orderBy: { code: "asc" },
      });
      const [debitSums, creditSums] = await Promise.all([
        tx.journalItem.groupBy({
          by: ["debitLedgerId"],
          where: { debitLedgerId: { not: null }, voucher },
          _sum: { debitAmount: true },
        }),
        tx.journalItem.groupBy({
          by: ["creditLedgerId"],
          where: { creditLedgerId: { not: null }, voucher },
          _sum: { creditAmount: true },
        }),
      ]);
      return { ledgers, debitSums, creditSums };
    });
    const debit = new Map(debitSums.map((r) => [r.debitLedgerId, Number(r._sum.debitAmount ?? 0)]));
    const credit = new Map(
      creditSums.map((r) => [r.creditLedgerId, Number(r._sum.creditAmount ?? 0)])
    );

    let netProfit = 0;
    let depreciation = 0;
    let cashMovement = 0;
    const sections: Record<
      "operating" | "investing" | "financing",
      Map<string, CashFlowGroupLine>
    > = { operating: new Map(), investing: new Map(), financing: new Map() };
    const cashLedgers: CashFlowLedgerLine[] = [];

    for (const ledger of ledgers) {
      const dr = debit.get(ledger.id) ?? 0;
      const cr = credit.get(ledger.id) ?? 0;
      if (dr === 0 && cr === 0) continue;
      const group = resolve(ledger.groupId) ??
        FALLBACK_GROUP[ledger.type] ?? { code: "OTHER", name: "Other" };
      const section = this.sectionOf(ledger.type, group.code);
      const effect = round2(cr - dr); // inflow when a liability grows or an asset shrinks
      if (section === "pnl") {
        netProfit = round2(netProfit + effect);
        if (DEPRECIATION_GROUPS.has(group.code)) depreciation = round2(depreciation + (dr - cr));
        continue;
      }
      if (section === "cash" || section === "overdraft") {
        // Cash movement is the asset-side change; an overdraft that grows is more cash on hand.
        const change = section === "cash" ? round2(dr - cr) : round2(cr - dr);
        cashMovement = round2(cashMovement + change);
        cashLedgers.push({
          ledgerId: ledger.id,
          code: ledger.code,
          name: ledger.name,
          amount: change,
        });
        continue;
      }
      const bucket = sections[section];
      const line = bucket.get(group.code) ?? {
        groupCode: group.code,
        groupName: group.name,
        amount: 0,
        ledgers: [],
      };
      line.amount = round2(line.amount + effect);
      line.ledgers.push({
        ledgerId: ledger.id,
        code: ledger.code,
        name: ledger.name,
        amount: effect,
      });
      bucket.set(group.code, line);
    }

    // Depreciation sits inside the fixed-asset movement; show it as an operating add-back instead.
    if (depreciation !== 0) {
      const fa = sections.investing.get("FIXED_ASSETS") ?? {
        groupCode: "FIXED_ASSETS",
        groupName: "Fixed Assets",
        amount: 0,
        ledgers: [],
      };
      fa.amount = round2(fa.amount - depreciation);
      sections.investing.set("FIXED_ASSETS", fa);
    }

    const total = (m: Map<string, CashFlowGroupLine>) =>
      round2([...m.values()].reduce((s, l) => s + l.amount, 0));
    const workingCapital = [...sections.operating.values()];
    const operatingTotal = round2(netProfit + depreciation + total(sections.operating));
    const investingTotal = total(sections.investing);
    const financingTotal = total(sections.financing);
    const netChange = round2(operatingTotal + investingTotal + financingTotal);

    const [openingCash, closingCash] = await Promise.all([
      this.cashAsOn(dayBefore(q.startDate), resolve),
      this.cashAsOn(q.endDate, resolve),
    ]);
    const difference = round2(closingCash - openingCash - netChange);

    return {
      startDate: q.startDate,
      endDate: q.endDate,
      operating: { netProfit, depreciation, workingCapital, total: operatingTotal },
      investing: { lines: [...sections.investing.values()], total: investingTotal },
      financing: { lines: [...sections.financing.values()], total: financingTotal },
      netChange,
      cashMovement,
      openingCash,
      closingCash,
      cashLedgers,
      difference,
      reconciles: Math.abs(difference) < 0.01,
    };
  }

  /** Cash and equivalents from the trial balance: cash + bank − overdraft, as on a date. */
  private async cashAsOn(
    asOnDate: string,
    resolve: (groupId: number | null) => { code: string; name: string } | null
  ) {
    const tb = await accountsService.getTrialBalance({ asOnDate, showZeroBalance: true });
    const groupIds = new Map(
      (
        await prisma.accountLedger.findMany({
          where: { id: { in: tb.rows.map((r) => r.ledgerId) } },
          select: { id: true, groupId: true },
        })
      ).map((l) => [l.id, l.groupId])
    );
    let cash = 0;
    for (const row of tb.rows) {
      const code = resolve(groupIds.get(row.ledgerId) ?? null)?.code ?? "";
      if (CASH_GROUPS.has(code)) cash += row.closingBalance;
      else if (OVERDRAFT_GROUPS.has(code)) cash -= row.closingBalance;
    }
    return round2(cash);
  }
}

export const cashFlowService = new CashFlowService();
