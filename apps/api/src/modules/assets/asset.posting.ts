import { Prisma, VoucherType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { periodService } from "../accounts/period.service";

/**
 * Vouchers for fixed assets (P1-18).
 *
 *   Depreciation  Dr Depreciation expense        Cr Accumulated depreciation
 *                 (one pair per class, so the P&L reads by class rather than by machine)
 *   Disposal      Dr Accumulated depreciation    Cr Asset at cost
 *                 Dr Cash/Bank (the proceeds)
 *                 and the difference to profit or loss on sale of assets
 *
 * The asset ledger is never credited with the written-down value: cost and accumulated
 * depreciation are separate balances and both have to come off, or the register and the balance
 * sheet stop agreeing the first time anything is sold.
 */
type Db = Prisma.TransactionClient | typeof prisma;
type Line = {
  debitLedgerId?: number;
  creditLedgerId?: number;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  narration: string;
};

const D = (n: number) => new Prisma.Decimal(Math.round((n + Number.EPSILON) * 100) / 100);
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

export const ledgerByCode = async (db: Db, code: string) => {
  const row = await db.accountLedger.findFirst({ where: { code } });
  if (!row) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
  return row;
};

const createVoucher = async (
  db: Db,
  data: Prisma.VoucherUncheckedCreateInput & { items: { create: Line[] } },
  refDocType: string,
  refDocId: string
) => {
  await periodService.assertPostingAllowed(new Date(data.date as Date), undefined, db);
  const existing = await db.voucher.findFirst({
    where: { refDocType, refDocId, status: "POSTED" },
  });
  if (existing) return existing;
  const created = await db.voucher.create({ data, include: { items: true } });
  try {
    const { emitToTenant } = await import("../../lib/realtime.js");
    emitToTenant("voucher:created", created);
  } catch {
    // Realtime is best-effort; a voucher is not held up by a socket.
  }
  return created;
};

export const assetPosting = {
  /**
   * One opening-balance journal for one asset class (P2-07): Dr the asset at cost, Cr the
   * accumulated depreciation given, Cr the opening-balance equity for what is left of the cost.
   * `createVoucher` already returns the existing voucher rather than posting twice, which is what
   * makes "only when the class has no opening yet" true without a separate check here.
   */
  async openingBalanceForClass(
    db: Db,
    cls: {
      id: string;
      code: string;
      name: string;
      assetLedgerCode: string;
      accumDepLedgerCode: string;
    },
    totals: { cost: number; accumulatedDepreciation: number },
    on: Date,
    createdBy?: string
  ) {
    if (totals.cost <= 0) return null;
    const assetLedger = await ledgerByCode(db, cls.assetLedgerCode);
    const eqLedger = await ledgerByCode(db, "EQ-001");
    const items: Line[] = [debit(assetLedger.id, totals.cost, `Opening cost — ${cls.name}`)];
    const accum = D(totals.accumulatedDepreciation).toNumber();
    if (accum > 0) {
      const accumLedger = await ledgerByCode(db, cls.accumDepLedgerCode);
      items.push(credit(accumLedger.id, accum, `Opening accumulated depreciation — ${cls.name}`));
    }
    const wdv = D(totals.cost - accum).toNumber();
    if (wdv > 0) items.push(credit(eqLedger.id, wdv, `Opening written-down value — ${cls.name}`));

    return createVoucher(
      db,
      {
        voucherNo: `FA-OP-${cls.code}`,
        type: VoucherType.JOURNAL,
        date: on,
        narration: `Opening balance — ${cls.name}`,
        refDocType: "ASSET_OPENING_BALANCE",
        refDocId: cls.id,
        createdBy: createdBy ?? null,
        items: { create: items },
      },
      "ASSET_OPENING_BALANCE",
      cls.id
    );
  },

  /**
   * Moves cost off a purchase or expense ledger and onto the asset ledger (P2-07): the amount
   * that was debited to `PURCH-001` or `EXP-001` for this line becomes the asset's opening cost
   * instead.
   */
  async capitalise(
    db: Db,
    asset: { id: string; code: string; name: string; assetLedgerCode: string },
    amount: number,
    sourceLedgerCode: string,
    on: Date,
    createdBy?: string
  ) {
    if (amount <= 0) return null;
    const assetLedger = await ledgerByCode(db, asset.assetLedgerCode);
    const sourceLedger = await ledgerByCode(db, sourceLedgerCode);
    return createVoucher(
      db,
      {
        voucherNo: `FA-CAP-${asset.code}`,
        type: VoucherType.JOURNAL,
        date: on,
        narration: `Capitalised as ${asset.name}`,
        refDocType: "ASSET_CAPITALISATION",
        refDocId: asset.id,
        createdBy: createdBy ?? null,
        items: {
          create: [
            debit(assetLedger.id, amount, `Capitalised as ${asset.name}`),
            credit(sourceLedger.id, amount, `Capitalised as ${asset.name}`),
          ],
        },
      },
      "ASSET_CAPITALISATION",
      asset.id
    );
  },

  /** One journal for the month, with a debit and a credit per class. */
  async depreciation(
    db: Db,
    run: { id: string; periodKey: string },
    byClass: {
      classCode: string;
      className: string;
      depExpenseLedgerCode: string;
      accumDepLedgerCode: string;
      amount: number;
    }[],
    on: Date,
    createdBy?: string
  ) {
    const items: Line[] = [];
    for (const c of byClass) {
      if (c.amount <= 0) continue;
      const expense = await ledgerByCode(db, c.depExpenseLedgerCode);
      const accum = await ledgerByCode(db, c.accumDepLedgerCode);
      items.push(debit(expense.id, c.amount, `Depreciation — ${c.className}`));
      items.push(credit(accum.id, c.amount, `Depreciation — ${c.className}`));
    }
    if (items.length === 0) return null;
    return createVoucher(
      db,
      {
        voucherNo: `DEP-${run.periodKey}`,
        type: VoucherType.JOURNAL,
        date: on,
        narration: `Depreciation for ${run.periodKey}`,
        refDocType: "DEPRECIATION_RUN",
        refDocId: run.id,
        createdBy: createdBy ?? null,
        items: { create: items },
      },
      "DEPRECIATION_RUN",
      run.id
    );
  },

  /**
   * Taking an asset off the books. Cost and accumulated depreciation both come off; what the
   * proceeds do not cover is the loss, and anything over is the profit.
   */
  async disposal(
    db: Db,
    asset: {
      id: string;
      code: string;
      name: string;
      cost: number;
      accumulated: number;
      proceeds: number;
      assetLedgerCode: string;
      accumDepLedgerCode: string;
    },
    on: Date,
    moneyLedgerCode: string,
    createdBy?: string
  ) {
    const assetLedger = await ledgerByCode(db, asset.assetLedgerCode);
    const accum = await ledgerByCode(db, asset.accumDepLedgerCode);
    const money = await ledgerByCode(db, moneyLedgerCode);
    const result = await ledgerByCode(db, "ASSET-PL-001");
    const wdv = Math.round((asset.cost - asset.accumulated) * 100) / 100;
    const gain = Math.round((asset.proceeds - wdv) * 100) / 100;

    const items: Line[] = [
      credit(assetLedger.id, asset.cost, `${asset.name} at cost`),
      debit(accum.id, asset.accumulated, `Depreciation written back — ${asset.name}`),
    ];
    if (asset.proceeds > 0) items.push(debit(money.id, asset.proceeds, `Sale of ${asset.name}`));
    if (gain > 0) items.push(credit(result.id, gain, `Profit on sale of ${asset.name}`));
    if (gain < 0) items.push(debit(result.id, -gain, `Loss on sale of ${asset.name}`));

    return createVoucher(
      db,
      {
        voucherNo: `ASD-${asset.code}`,
        type: VoucherType.JOURNAL,
        date: on,
        narration: `Disposal of ${asset.name}`,
        refDocType: "ASSET_DISPOSAL",
        refDocId: asset.id,
        createdBy: createdBy ?? null,
        items: { create: items },
      },
      "ASSET_DISPOSAL",
      asset.id
    );
  },
};
