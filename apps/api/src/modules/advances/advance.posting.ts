import { Prisma, VoucherType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";

/**
 * Vouchers for advances (P1-14).
 *
 * An advance is not income and not a receipt against a debt: it is money the company holds and
 * owes back until it is earned. So it credits the advances liability, and the GST on it credits
 * the output-tax ledgers straight away, because the tax fell due the day the money arrived.
 *
 *   Receipt     Dr Cash/Bank            Cr Advances from customers, Cr CGST/SGST/IGST payable
 *   Adjustment  Dr Advances             Cr the customer's account (the invoice already has the
 *                                          tax, so only the money moves here)
 *   Refund      Dr Advances,            Cr Cash/Bank
 *               Dr CGST/SGST/IGST payable (the tax comes back with it)
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

const ledgerByCode = async (db: Db, code: string) => {
  const row = await db.accountLedger.findFirst({ where: { code } });
  if (!row) throw new ApiError(500, `Missing system ledger ${code}`, "MISSING_LEDGER");
  return row;
};

/** The GST lines for an advance's tax, on whichever side the movement needs. */
const taxLines = async (
  db: Db,
  side: "debit" | "credit",
  split: { igst: number; cgst: number; sgst: number },
  label: string
): Promise<Line[]> => {
  const parts: [string, number, string][] = [
    ["CGST-LIA-001", split.cgst, `CGST ${label}`],
    ["SGST-LIA-001", split.sgst, `SGST ${label}`],
    ["IGST-LIA-001", split.igst, `IGST ${label}`],
  ];
  const out: Line[] = [];
  for (const [code, amount, narration] of parts) {
    if (amount <= 0) continue;
    const ledger = await ledgerByCode(db, code);
    out.push(
      side === "debit" ? debit(ledger.id, amount, narration) : credit(ledger.id, amount, narration)
    );
  }
  return out;
};

/** The same duplicate-safe create the other posting paths use, with the period gate. */
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

export const advancePosting = {
  /** Money in: the company now owes it, and the tax on it is already due. */
  async receipt(db: Db, advanceId: string) {
    const advance = await db.advanceReceipt.findUnique({
      where: { id: advanceId },
      include: { customer: { select: { firmName: true } } },
    });
    if (!advance) return null;
    await accountsService.ensureSystemLedgersExist(db as Prisma.TransactionClient);
    const isCash = (advance.paymentMethod || "").toLowerCase().includes("cash");
    const money = await ledgerByCode(db, isCash ? "CASH-001" : "BANK-001");
    const advances = await ledgerByCode(db, "ADV-CUST-001");
    const tax = await taxLines(
      db,
      "credit",
      { igst: Number(advance.igst), cgst: Number(advance.cgst), sgst: Number(advance.sgst) },
      `on advance ${advance.receiptNo}`
    );
    const net =
      Number(advance.amount) - Number(advance.igst) - Number(advance.cgst) - Number(advance.sgst);

    return createVoucher(
      db,
      {
        voucherNo: advance.receiptNo,
        type: VoucherType.RECEIPT,
        date: advance.receiptDate,
        narration: `Advance from ${advance.customer.firmName}`,
        refDocType: "ADVANCE_RECEIPT",
        refDocId: advance.id,
        items: {
          create: [
            debit(money.id, Number(advance.amount), `Advance received (${advance.paymentMethod})`),
            credit(advances.id, net, `Advance from ${advance.customer.firmName}`),
            ...tax,
          ],
        },
      },
      "ADVANCE_RECEIPT",
      advance.id
    );
  },

  /**
   * The advance is applied to an invoice: the liability goes and the customer's receivable
   * falls. No tax moves — the invoice carries its own, and the adjustment is what stops the
   * same supply being taxed twice.
   */
  async adjustment(db: Db, adjustmentId: string) {
    const row = await db.advanceAdjustment.findUnique({
      where: { id: adjustmentId },
      include: {
        advance: { include: { customer: true } },
        salesInvoice: { select: { invoiceNo: true } },
      },
    });
    if (!row || row.kind !== "ADJUSTED") return null;
    await accountsService.ensureSystemLedgersExist(db as Prisma.TransactionClient);
    const advances = await ledgerByCode(db, "ADV-CUST-001");
    const customerLedger = await accountsService.ensureCustomerLedger(row.advance.customer, db);
    if (!customerLedger) {
      logger.error({ adjustmentId }, "[Advance] no customer ledger; adjustment not posted");
      return null;
    }
    return createVoucher(
      db,
      {
        voucherNo: `ADJ-${row.advance.receiptNo}-${row.id.slice(0, 6)}`,
        type: VoucherType.JOURNAL,
        date: row.adjustedOn,
        narration: `Advance ${row.advance.receiptNo} applied to invoice ${row.salesInvoice?.invoiceNo ?? ""}`,
        refDocType: "ADVANCE_ADJUSTMENT",
        refDocId: row.id,
        items: {
          create: [
            debit(advances.id, Number(row.amount), `Advance applied`),
            credit(
              customerLedger.id,
              Number(row.amount),
              `Against ${row.salesInvoice?.invoiceNo ?? "invoice"}`
            ),
          ],
        },
      },
      "ADVANCE_ADJUSTMENT",
      row.id
    );
  },

  /** The advance is given back, and the tax paid on it comes back with it. */
  async refund(db: Db, adjustmentId: string) {
    const row = await db.advanceAdjustment.findUnique({
      where: { id: adjustmentId },
      include: { advance: { include: { customer: { select: { firmName: true } } } } },
    });
    if (!row || row.kind !== "REFUNDED") return null;
    await accountsService.ensureSystemLedgersExist(db as Prisma.TransactionClient);
    const isCash = (row.advance.paymentMethod || "").toLowerCase().includes("cash");
    const money = await ledgerByCode(db, isCash ? "CASH-001" : "BANK-001");
    const advances = await ledgerByCode(db, "ADV-CUST-001");
    const tax = await taxLines(
      db,
      "debit",
      { igst: Number(row.igst), cgst: Number(row.cgst), sgst: Number(row.sgst) },
      `reversed on refund ${row.refundVoucherNo}`
    );
    const net = Number(row.amount) - Number(row.igst) - Number(row.cgst) - Number(row.sgst);

    return createVoucher(
      db,
      {
        voucherNo: row.refundVoucherNo ?? `RFV-${row.id.slice(0, 8)}`,
        type: VoucherType.PAYMENT,
        date: row.adjustedOn,
        narration: `Advance ${row.advance.receiptNo} refunded to ${row.advance.customer.firmName}`,
        refDocType: "ADVANCE_REFUND",
        refDocId: row.id,
        items: {
          create: [
            debit(advances.id, net, "Advance returned"),
            ...tax,
            credit(money.id, Number(row.amount), `Refund paid (${row.advance.paymentMethod})`),
          ],
        },
      },
      "ADVANCE_REFUND",
      row.id
    );
  },
};
