import { Prisma, VoucherType, type CostCentreKind } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import { valuationService } from "./valuation.service";

/**
 * Cost centres, budgets, the product cost sheet and the closing-stock posting (P1-19).
 *
 * The theme running through all four is that a number nobody can take apart is a number nobody
 * believes: the cost-centre report shows what is *unallocated* rather than quietly spreading it,
 * the cost sheet keeps the material lines it was built from, and the closing stock is posted from
 * the valuation ledger rather than typed.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const n4 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 10000) / 10000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const monthRange = (periodKey: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new ApiError(400, "A period looks like 2026-08");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return { from: new Date(Date.UTC(y, mo - 1, 1)), to: new Date(Date.UTC(y, mo, 0)) };
};
const fyRange = (fyCode: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(fyCode);
  if (!m) throw new ApiError(400, "A financial year looks like 2026-27");
  const y = Number(m[1]);
  return { from: new Date(Date.UTC(y, 3, 1)), to: new Date(Date.UTC(y + 1, 2, 31)) };
};

/** How overhead is spread across what was made. The tenant picks; the sheet records which. */
export const OVERHEAD_BASES = ["QUANTITY", "MATERIAL_VALUE", "LABOUR_HOURS"] as const;
export type OverheadBasis = (typeof OVERHEAD_BASES)[number];

class CostingService {
  // ── Cost centres ───────────────────────────────────────────────────────────
  async costCentres(includeInactive = false) {
    const rows = await prisma.costCentre.findMany({ orderBy: { code: "asc" } });
    return includeInactive ? rows : rows.filter((c) => c.isActive);
  }

  async upsertCostCentre(input: {
    code: string;
    name: string;
    kind?: CostCentreKind;
    parentId?: string | null;
    isActive?: boolean;
  }) {
    const code = input.code.trim().toUpperCase();
    const data = {
      name: input.name.trim().slice(0, 120),
      kind: input.kind ?? ("PRODUCTION" as CostCentreKind),
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
    };
    return prisma.costCentre.upsert({
      where: { companyId_code: { companyId: requireTenantId(), code } },
      create: { code, ...data },
      update: data,
    });
  }

  /** Tags journal lines with a cost centre after the fact; a voucher can be split across many. */
  async tagLines(input: { journalItemIds: number[]; costCentreId: string | null }) {
    if (input.costCentreId) {
      const centre = await prisma.costCentre.findUnique({ where: { id: input.costCentreId } });
      if (!centre) throw new ApiError(404, "That cost centre does not exist");
    }
    const res = await prisma.journalItem.updateMany({
      where: { id: { in: input.journalItemIds } },
      data: { costCentreId: input.costCentreId },
    });
    return { tagged: res.count };
  }

  /**
   * Profit and loss by cost centre for a period.
   *
   * Unallocated is a row of its own rather than being spread across the centres. Spreading it
   * makes every centre's number wrong by an unknown amount and hides the fact that the tagging
   * is incomplete — which is the thing the reader most needs to know.
   */
  async costCentreProfitAndLoss(from: Date, to: Date) {
    const items = await prisma.journalItem.findMany({
      where: {
        voucher: { date: { gte: from, lte: to }, status: "POSTED" },
        OR: [
          { debitLedger: { type: { in: ["INCOME", "EXPENSE"] } } },
          { creditLedger: { type: { in: ["INCOME", "EXPENSE"] } } },
        ],
      },
      include: {
        debitLedger: { select: { id: true, type: true, name: true } },
        creditLedger: { select: { id: true, type: true, name: true } },
        costCentre: { select: { id: true, code: true, name: true, kind: true } },
      },
      take: 20000,
    });

    const centres = new Map<
      string,
      { costCentreId: string | null; code: string; name: string; income: number; expense: number }
    >();
    const bump = (
      centre: { id: string; code: string; name: string } | null,
      type: string,
      amount: number
    ) => {
      const key = centre?.id ?? "__none__";
      const row = centres.get(key) ?? {
        costCentreId: centre?.id ?? null,
        code: centre?.code ?? "—",
        name: centre?.name ?? "Unallocated",
        income: 0,
        expense: 0,
      };
      if (type === "INCOME") row.income = n2(row.income + amount);
      else row.expense = n2(row.expense + amount);
      centres.set(key, row);
    };

    for (const i of items) {
      // Income is a credit and expense a debit; the other side of each is a balance-sheet account
      // and has no place in a profit and loss.
      if (i.creditLedger?.type === "INCOME") bump(i.costCentre, "INCOME", Number(i.creditAmount));
      if (i.debitLedger?.type === "INCOME") bump(i.costCentre, "INCOME", -Number(i.debitAmount));
      if (i.debitLedger?.type === "EXPENSE") bump(i.costCentre, "EXPENSE", Number(i.debitAmount));
      if (i.creditLedger?.type === "EXPENSE")
        bump(i.costCentre, "EXPENSE", -Number(i.creditAmount));
    }

    const rows = [...centres.values()].map((r) => ({ ...r, result: n2(r.income - r.expense) }));
    const allocated = rows.filter((r) => r.costCentreId !== null);
    const unallocated = rows.find((r) => r.costCentreId === null) ?? null;
    return {
      from: iso(from),
      to: iso(to),
      rows: rows.sort((a, b) => b.result - a.result),
      totals: {
        income: n2(rows.reduce((s, r) => s + r.income, 0)),
        expense: n2(rows.reduce((s, r) => s + r.expense, 0)),
        result: n2(rows.reduce((s, r) => s + r.result, 0)),
      },
      // Said out loud so nobody mistakes a partial report for a complete one.
      allocatedCentres: allocated.length,
      unallocatedResult: unallocated ? unallocated.result : 0,
    };
  }

  // ── Budgets ────────────────────────────────────────────────────────────────
  private scopeKey(
    fyCode: string,
    periodKey: string | null,
    ledgerId: number,
    costCentreId: string | null
  ) {
    return `${fyCode}|${periodKey ?? "FY"}|${ledgerId}|${costCentreId ?? "ALL"}`.slice(0, 120);
  }

  async budgets(fyCode: string) {
    return prisma.budget.findMany({
      where: { fyCode },
      include: {
        ledger: { select: { code: true, name: true, type: true } },
        costCentre: { select: { code: true, name: true } },
      },
      orderBy: [{ periodKey: "asc" }, { ledgerId: "asc" }],
    });
  }

  async setBudget(
    input: {
      fyCode: string;
      periodKey?: string | null;
      ledgerId: number;
      costCentreId?: string | null;
      amount: number;
      notes?: string | null;
    },
    actor: { userId?: string }
  ) {
    fyRange(input.fyCode);
    if (input.periodKey) monthRange(input.periodKey);
    const ledger = await prisma.accountLedger.findUnique({ where: { id: input.ledgerId } });
    if (!ledger) throw new ApiError(404, "That ledger does not exist");
    const scopeKey = this.scopeKey(
      input.fyCode,
      input.periodKey ?? null,
      input.ledgerId,
      input.costCentreId ?? null
    );
    const data = {
      fyCode: input.fyCode,
      periodKey: input.periodKey ?? null,
      ledgerId: input.ledgerId,
      costCentreId: input.costCentreId ?? null,
      amount: n2(input.amount),
      notes: input.notes ?? null,
    };
    return prisma.budget.upsert({
      where: { companyId_scopeKey: { companyId: requireTenantId(), scopeKey } },
      create: { ...data, scopeKey, createdBy: actor.userId?.slice(0, 36) ?? null },
      update: data,
    });
  }

  /**
   * Budget against actual for a year.
   *
   * The sign is the part worth getting right: spending more than budgeted is bad and earning more
   * than budgeted is good, so the variance is read against the ledger's nature rather than as a
   * bare subtraction that would call a good month a bad one.
   */
  async variance(fyCode: string, periodKey?: string | null) {
    const range = periodKey ? monthRange(periodKey) : fyRange(fyCode);
    const budgets = await prisma.budget.findMany({
      where: { fyCode, ...(periodKey ? { periodKey } : {}) },
      include: {
        ledger: { select: { id: true, code: true, name: true, type: true } },
        costCentre: { select: { id: true, code: true, name: true } },
      },
    });

    const items = await prisma.journalItem.findMany({
      where: { voucher: { date: { gte: range.from, lte: range.to }, status: "POSTED" } },
      select: {
        debitLedgerId: true,
        creditLedgerId: true,
        debitAmount: true,
        creditAmount: true,
        costCentreId: true,
      },
      take: 20000,
    });

    const actualFor = (ledgerId: number, costCentreId: string | null, type: string) => {
      let total = 0;
      for (const i of items) {
        if (costCentreId && i.costCentreId !== costCentreId) continue;
        const debit = i.debitLedgerId === ledgerId ? Number(i.debitAmount) : 0;
        const credit = i.creditLedgerId === ledgerId ? Number(i.creditAmount) : 0;
        total += type === "INCOME" ? credit - debit : debit - credit;
      }
      return n2(total);
    };

    const rows = budgets.map((b) => {
      const budget = n2(b.amount);
      const actual = actualFor(b.ledgerId, b.costCentreId, b.ledger.type);
      // Favourable means better than budget: under on a cost, over on an income.
      const variance = b.ledger.type === "INCOME" ? n2(actual - budget) : n2(budget - actual);
      return {
        id: b.id,
        periodKey: b.periodKey,
        ledgerCode: b.ledger.code,
        ledgerName: b.ledger.name,
        ledgerType: b.ledger.type,
        costCentre: b.costCentre?.code ?? null,
        budget,
        actual,
        variance,
        favourable: variance >= 0,
        usedPercent: budget === 0 ? null : Math.round((actual / budget) * 1000) / 10,
      };
    });

    return {
      fyCode,
      periodKey: periodKey ?? null,
      from: iso(range.from),
      to: iso(range.to),
      rows: rows.sort((a, b) => a.variance - b.variance),
      totals: {
        budget: n2(rows.reduce((s, r) => s + r.budget, 0)),
        actual: n2(rows.reduce((s, r) => s + r.actual, 0)),
        adverse: rows.filter((r) => !r.favourable).length,
      },
    };
  }

  // ── Cost sheet ─────────────────────────────────────────────────────────────
  /**
   * What a product cost in a month.
   *
   * Material is what was actually issued, at the weighted average it left at — not at a standard
   * and not at the latest purchase price. Scrap is credited back, because scrap carried at full
   * material cost overstates the finished goods by exactly the value of the waste.
   */
  async buildCostSheet(
    input: {
      productId: string;
      periodKey: string;
      quantityProduced: number;
      labourCost?: number;
      overheadCost?: number;
      overheadBasis?: OverheadBasis;
    },
    actor: { userId?: string }
  ) {
    const period = monthRange(input.periodKey);
    const product = await prisma.product.findUnique({ where: { id: BigInt(input.productId) } });
    if (!product) throw new ApiError(404, "That product does not exist");
    if (input.quantityProduced <= 0) {
      throw new ApiError(400, "A cost sheet needs the quantity that was made");
    }

    // Everything issued in the month, at what it left the store at.
    const issues = await prisma.stockValuationEntry.findMany({
      where: {
        kind: "ISSUE",
        movedOn: { gte: period.from, lte: period.to },
        refDocType: { in: ["PRODUCTION_ORDER", "PRODUCTION"] },
      },
      take: 5000,
    });
    const scrap = await prisma.stockValuationEntry.findMany({
      where: { kind: "SCRAP", movedOn: { gte: period.from, lte: period.to } },
      take: 5000,
    });

    const byItem = new Map<string, { itemId: string; quantity: number; value: number }>();
    for (const i of issues) {
      const cur = byItem.get(i.itemId) ?? { itemId: i.itemId, quantity: 0, value: 0 };
      cur.quantity = Math.round((cur.quantity + Number(i.quantity)) * 1000) / 1000;
      cur.value = n2(cur.value + Number(i.value));
      byItem.set(i.itemId, cur);
    }
    const materialCost = n2([...byItem.values()].reduce((s, l) => s + l.value, 0));
    const scrapCredit = n2(scrap.reduce((s, e) => s + Number(e.value), 0));
    const labourCost = n2(input.labourCost ?? 0);
    const overheadCost = n2(input.overheadCost ?? 0);
    const totalCost = n2(materialCost + labourCost + overheadCost - scrapCredit);

    const data = {
      productId: BigInt(input.productId),
      periodKey: input.periodKey,
      quantityProduced: input.quantityProduced,
      materialCost,
      labourCost,
      overheadCost,
      scrapCredit,
      totalCost,
      perUnitCost: n4(totalCost / input.quantityProduced),
      overheadBasis: input.overheadBasis ?? "QUANTITY",
      lines: [...byItem.values()] as unknown as Prisma.InputJsonValue,
    };
    const row = await prisma.productCostSheet.upsert({
      where: {
        companyId_productId_periodKey: {
          companyId: requireTenantId(),
          productId: BigInt(input.productId),
          periodKey: input.periodKey,
        },
      },
      create: data,
      update: data,
    });
    return { ...row, productId: String(row.productId), preparedBy: actor.userId ?? null };
  }

  async costSheets(periodKey?: string) {
    const rows = await prisma.productCostSheet.findMany({
      where: periodKey ? { periodKey } : {},
      include: { product: { select: { productCode: true, productName: true } } },
      orderBy: { periodKey: "desc" },
      take: 200,
    });
    return rows.map((r) => ({ ...r, productId: String(r.productId) }));
  }

  // ── Closing stock ──────────────────────────────────────────────────────────
  /**
   * Posts the movement in stock for a period: the difference between what the valuation ledger
   * says at the start and at the end, against "Change in Inventories". Posting the closing figure
   * itself rather than the movement would double the stock every month.
   */
  async postClosingStock(periodKey: string, actor: { userId?: string }) {
    const period = monthRange(periodKey);
    const dayBefore = new Date(period.from.getTime() - 86400000);
    const opening = (await valuationService.closingStock(dayBefore)).total;
    const closing = (await valuationService.closingStock(period.to)).total;
    const movement = n2(closing - opening);
    if (Math.abs(movement) < 0.01) {
      return { posted: false, opening, closing, movement: 0, voucherId: null as number | null };
    }

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      await periodService.assertPostingAllowed(period.to, undefined, tx);
      const ledger = async (code: string) => {
        const row = await tx.accountLedger.findFirst({ where: { code } });
        if (!row) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
        return row;
      };
      const stock = await ledger("STOCK-001");
      const change = await ledger("STOCK-CHG-001");
      const existing = await tx.voucher.findFirst({
        where: { refDocType: "CLOSING_STOCK", refDocId: periodKey, status: "POSTED" },
      });
      if (existing) {
        return { posted: false, opening, closing, movement, voucherId: existing.id };
      }

      const D = (n: number) => new Prisma.Decimal(n2(n));
      const amount = Math.abs(movement);
      // Stock went up: the asset rises and the charge to the profit and loss falls.
      const items =
        movement > 0
          ? [
              {
                debitLedgerId: stock.id,
                debitAmount: D(amount),
                creditAmount: D(0),
                narration: `Increase in stock — ${periodKey}`,
              },
              {
                creditLedgerId: change.id,
                debitAmount: D(0),
                creditAmount: D(amount),
                narration: `Increase in stock — ${periodKey}`,
              },
            ]
          : [
              {
                debitLedgerId: change.id,
                debitAmount: D(amount),
                creditAmount: D(0),
                narration: `Decrease in stock — ${periodKey}`,
              },
              {
                creditLedgerId: stock.id,
                debitAmount: D(0),
                creditAmount: D(amount),
                narration: `Decrease in stock — ${periodKey}`,
              },
            ];

      const voucher = await tx.voucher.create({
        data: {
          voucherNo: `STK-${periodKey}`,
          type: VoucherType.JOURNAL,
          date: period.to,
          narration: `Movement in stock for ${periodKey}`,
          refDocType: "CLOSING_STOCK",
          refDocId: periodKey,
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: items },
        },
      });
      return { posted: true, opening, closing, movement, voucherId: voucher.id };
    });
  }
}

export const costingService = new CostingService();
