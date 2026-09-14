import { createHash } from "node:crypto";

import { MsmeCategory } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { filingApprovalService } from "../filings/filing-approval.service";
import { notify } from "../notifications/notify";

/**
 * MSME dues and section 43B(h) (P1-07).
 *
 * Section 15 of the MSMED Act gives a buyer 45 days to pay a micro or small supplier where there
 * is a written agreement and 15 days where there is not — and since April 2024 section 43B(h) of
 * the Income-tax Act allows a late payment as a deduction only in the year it is actually paid.
 * A bill missed by a day therefore moves out of this year's profit and into next year's, which
 * is a tax cost on profit the company never made.
 *
 * Two details decide whether the numbers here are right:
 *
 *  - the clock runs from the **day of acceptance**, not the invoice date, so the receipt date is
 *    used where there is one; and
 *  - the limit is **derived**, never typed. Agreeing to 60 days does not make 60 days lawful:
 *    section 15 caps the agreement at 45, and without a written one the limit is 15.
 */
export const LIMIT_WITHOUT_CONTRACT = 15;
export const LIMIT_WITH_CONTRACT_MAX = 45;
/**
 * Days left when a nudge goes out. On the 45-day clock these land on day 30 and day 43; on the
 * 15-day one the first is already past, so only the second fires, which is the honest answer.
 */
export const WARN_DAYS_LEFT = [15, 2];
/** The categories section 43B(h) reaches. A medium enterprise is outside it entirely. */
export const COVERED: MsmeCategory[] = [MsmeCategory.MICRO, MsmeCategory.SMALL];

/** UDYAM-XX-00-0000000: state code, district code and a seven-digit serial. */
export const UDYAM_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
export const isValidUdyam = (v: string | null | undefined): boolean =>
  typeof v === "string" && UDYAM_RE.test(v.trim().toUpperCase());

const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface MsmeBillRow {
  /** GRN invoice id, or expense id when `source` is "EXPENSE". */
  grnId: string;
  /** GRN number, or the expense number when `source` is "EXPENSE". */
  grnNumber: string;
  /** GRN invoices carry the section 15 clock from acceptance; supplier expenses from the expense date (P2-10). */
  source: "GRN" | "EXPENSE";
  invoiceNo: string;
  supplierId: number;
  supplierName: string;
  udyamNumber: string | null;
  category: MsmeCategory;
  /** What section 15 counts from: the day the goods were accepted. */
  acceptedOn: string;
  limitDays: number;
  dueDate: string;
  billAmount: number;
  paid: number;
  outstanding: number;
  /** The day the balance was finally cleared, when it has been. */
  settledOn: string | null;
  /** Negative once the section 15 date has passed. */
  daysLeft: number;
  overdue: boolean;
  /** Paid, but after the section 15 date — the year of payment gets the deduction. */
  paidLate: boolean;
}

/**
 * The limit for a supplier. The cap is the point: an agreement for 60 days is worth nothing
 * against section 15, and treating it as valid is how a company ends up disallowed by surprise.
 */
export const limitFor = (supplier: {
  hasWrittenContract: boolean;
  agreedPaymentDays: number | null;
}): number =>
  supplier.hasWrittenContract
    ? Math.min(supplier.agreedPaymentDays ?? LIMIT_WITH_CONTRACT_MAX, LIMIT_WITH_CONTRACT_MAX)
    : LIMIT_WITHOUT_CONTRACT;

class MsmeService {
  /**
   * Every bill from a micro or small supplier in a window, with its clock worked out.
   *
   * Payments are read from `GrnInvoicePayment` rather than the bill's own status, because the
   * date each instalment landed is what decides the year the deduction falls in.
   */
  async bills(
    opts: {
      from?: Date;
      to?: Date;
      asOn?: Date;
      supplierId?: number;
      openOnly?: boolean;
      overdueOnly?: boolean;
    } = {}
  ): Promise<MsmeBillRow[]> {
    const asOn = startOfDay(opts.asOn ?? new Date());
    const rows = await prisma.grnInvoice.findMany({
      where: {
        supplier: { msmeCategory: { in: COVERED } },
        ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
        ...(opts.from || opts.to
          ? {
              grnDate: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      include: {
        supplier: {
          select: {
            id: true,
            legalName: true,
            msmeCategory: true,
            udyamNumber: true,
            hasWrittenContract: true,
            agreedPaymentDays: true,
          },
        },
        paymentRecords: { select: { amount: true, paymentDate: true } },
      },
      orderBy: { grnDate: "asc" },
      take: 2000,
    });

    const out: MsmeBillRow[] = [];
    for (const g of rows) {
      // Payments after the cut-off have not happened yet as far as this report is concerned.
      const payments = g.paymentRecords
        .filter((p) => startOfDay(p.paymentDate) <= asOn)
        .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime());
      const billAmount = n2(g.netAmount);
      const paid = n2(payments.reduce((s, p) => s + Number(p.amount), 0));
      const outstanding = n2(billAmount - paid);
      // Acceptance, not invoicing: section 15 counts from the day the goods were taken in.
      const acceptedOn = startOfDay(g.receiveDate ?? g.grnDate);
      const limitDays = limitFor(g.supplier);
      const dueDate = addDays(acceptedOn, limitDays);
      const settled =
        outstanding <= 0.009 ? (payments[payments.length - 1]?.paymentDate ?? null) : null;

      if (opts.openOnly && outstanding <= 0.009) continue;
      const overdue = outstanding > 0.009 && asOn > dueDate;
      if (opts.overdueOnly && !overdue) continue;

      out.push({
        grnId: g.id,
        grnNumber: g.grnNumber,
        source: "GRN",
        invoiceNo: g.invoiceNo,
        supplierId: g.supplier.id,
        supplierName: g.supplier.legalName,
        udyamNumber: g.supplier.udyamNumber,
        category: g.supplier.msmeCategory,
        acceptedOn: iso(acceptedOn),
        limitDays,
        dueDate: iso(dueDate),
        billAmount,
        paid,
        outstanding: Math.max(outstanding, 0),
        settledOn: settled ? iso(startOfDay(settled)) : null,
        daysLeft: Math.round((dueDate.getTime() - asOn.getTime()) / 86400000),
        overdue,
        paidLate: Boolean(settled) && startOfDay(settled as Date) > dueDate,
      });
    }

    // Supplier expenses (P2-10): only a GRN invoice carried the section 15 clock until now, but
    // a bill against a micro or small supplier booked as an expense is exactly the same risk.
    // There is no instalment table for an expense — it is either still awaiting approval (fully
    // outstanding) or Approved, which is also the day `voucherPostingService` posts it as paid.
    const expenses = await prisma.expense.findMany({
      where: {
        supplier: { msmeCategory: { in: COVERED } },
        supplierId: { not: null },
        cancelledAt: null,
        status: { in: ["Pending", "Approved"] },
        ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
        ...(opts.from || opts.to
          ? {
              date: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      include: {
        supplier: {
          select: {
            id: true,
            legalName: true,
            msmeCategory: true,
            udyamNumber: true,
            hasWrittenContract: true,
            agreedPaymentDays: true,
          },
        },
      },
      orderBy: { date: "asc" },
      take: 2000,
    });

    for (const e of expenses) {
      if (!e.supplier) continue;
      const billAmount = n2(e.amount);
      const isApproved = e.status === "Approved";
      const approvedOn = e.approvedAt ?? e.date;
      const paid = isApproved && startOfDay(approvedOn) <= asOn ? billAmount : 0;
      const outstanding = n2(billAmount - paid);
      const acceptedOn = startOfDay(e.date);
      const limitDays = limitFor(e.supplier);
      const dueDate = addDays(acceptedOn, limitDays);
      const settled = paid > 0 ? approvedOn : null;

      if (opts.openOnly && outstanding <= 0.009) continue;
      const overdue = outstanding > 0.009 && asOn > dueDate;
      if (opts.overdueOnly && !overdue) continue;

      out.push({
        grnId: e.id,
        grnNumber: e.expenseNumber,
        source: "EXPENSE",
        invoiceNo: e.expenseNumber,
        supplierId: e.supplier.id,
        supplierName: e.supplier.legalName,
        udyamNumber: e.supplier.udyamNumber,
        category: e.supplier.msmeCategory,
        acceptedOn: iso(acceptedOn),
        limitDays,
        dueDate: iso(dueDate),
        billAmount,
        paid,
        outstanding: Math.max(outstanding, 0),
        settledOn: settled ? iso(startOfDay(settled)) : null,
        daysLeft: Math.round((dueDate.getTime() - asOn.getTime()) / 86400000),
        overdue,
        paidLate: Boolean(settled) && startOfDay(settled as Date) > dueDate,
      });
    }

    out.sort((a, b) => a.acceptedOn.localeCompare(b.acceptedOn));
    return out;
  }

  /**
   * Section 43B(h) as at a year end.
   *
   * Two numbers, and they are not the same thing. **Disallowed** is what is still unpaid at the
   * year end and already past its section 15 date: it comes out of this year's profit. **Allowed
   * on payment** is what was paid late *during* the year: it was disallowed last year and the
   * deduction comes back now. An accountant needs both or the adjustment is only half made.
   */
  async disallowance(fyCode: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(fyCode);
    if (!match) throw new ApiError(400, "A financial year looks like 2026-27");
    const startYear = Number(match[1]);
    const fyStart = new Date(Date.UTC(startYear, 3, 1));
    const fyEnd = new Date(Date.UTC(startYear + 1, 2, 31));

    const all = await this.bills({ to: fyEnd, asOn: fyEnd });
    const disallowed = all.filter((b) => b.overdue);
    const allowedOnPayment = all.filter(
      (b) => b.paidLate && b.settledOn && b.settledOn >= iso(fyStart) && b.settledOn <= iso(fyEnd)
    );

    const bySupplier = (rows: MsmeBillRow[], amount: (b: MsmeBillRow) => number) => {
      const map = new Map<
        number,
        {
          supplierId: number;
          supplierName: string;
          udyamNumber: string | null;
          category: MsmeCategory;
          bills: number;
          amount: number;
        }
      >();
      for (const b of rows) {
        const cur = map.get(b.supplierId) ?? {
          supplierId: b.supplierId,
          supplierName: b.supplierName,
          udyamNumber: b.udyamNumber,
          category: b.category,
          bills: 0,
          amount: 0,
        };
        cur.bills++;
        cur.amount = n2(cur.amount + amount(b));
        map.set(b.supplierId, cur);
      }
      return [...map.values()].sort((a, b) => b.amount - a.amount);
    };

    return {
      fyCode,
      fyStart: iso(fyStart),
      fyEnd: iso(fyEnd),
      disallowed: {
        total: n2(disallowed.reduce((s, b) => s + b.outstanding, 0)),
        bills: disallowed,
        suppliers: bySupplier(disallowed, (b) => b.outstanding),
      },
      allowedOnPayment: {
        total: n2(allowedOnPayment.reduce((s, b) => s + b.billAmount, 0)),
        bills: allowedOnPayment,
        suppliers: bySupplier(allowedOnPayment, (b) => b.billAmount),
      },
    };
  }

  /**
   * MSME Form 1, the half-yearly return to the MCA of dues outstanding beyond 45 days.
   *
   * The form asks for 45 days whatever the parties agreed, so the threshold here is the statutory
   * 45 rather than the supplier's own limit — a bill on a 15-day clock is late for section 15 but
   * not yet reportable on this form.
   */
  async form1(periodKey: string) {
    const match = /^(\d{4})-H([12])$/.exec(periodKey);
    if (!match) throw new ApiError(400, "A half-year looks like 2026-H1");
    const year = Number(match[1]);
    const first = match[2] === "1";
    const from = new Date(Date.UTC(year, first ? 3 : 9, 1));
    const to = first ? new Date(Date.UTC(year, 8, 30)) : new Date(Date.UTC(year + 1, 2, 31));

    const rows = (await this.bills({ to, asOn: to, openOnly: true })).filter((b) => {
      const days = Math.round(
        (to.getTime() - new Date(`${b.acceptedOn}T00:00:00Z`).getTime()) / 86400000
      );
      return days > LIMIT_WITH_CONTRACT_MAX;
    });

    const lines = rows.map((b) => ({
      supplierName: b.supplierName,
      udyamNumber: b.udyamNumber,
      invoiceNo: b.invoiceNo,
      amountOutstanding: b.outstanding,
      dueSince: b.dueDate,
      reason: b.limitDays === LIMIT_WITHOUT_CONTRACT ? "No written agreement" : "Awaiting funds",
    }));
    const payload = { periodKey, from: iso(from), to: iso(to), lines };
    return {
      periodKey,
      from: iso(from),
      to: iso(to),
      total: n2(lines.reduce((s, l) => s + l.amountOutstanding, 0)),
      lines,
      payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      filing: null as unknown,
    };
  }

  /** Registers the half-year on the filing gate. */
  async registerForm1(periodKey: string, actor: { userId?: string }) {
    const ret = await this.form1(periodKey);
    const row = await filingApprovalService.upsertDraft(
      {
        filingType: "MSME_1",
        periodKey,
        businessPlaceId: null,
        payloadHash: ret.payloadHash,
        summary: { periodKey, suppliers: ret.lines.length, total: ret.total },
        notes: ret.lines.length === 0 ? "Nil return" : null,
      },
      actor
    );
    return { ...ret, filing: row };
  }

  /**
   * The daily nudge. The link carries the bill and which of the two thresholds it is, so a
   * reminder goes out once rather than every day until the money moves.
   */
  async warnUpcoming(today = new Date()) {
    const rows = await this.bills({ asOn: today, openOnly: true });
    let sent = 0;
    for (const b of rows) {
      if (!WARN_DAYS_LEFT.includes(b.daysLeft)) continue;
      const link = `/payable/msme?grn=${b.grnId}&d=${b.daysLeft}&source=${b.source}`;
      const already = await prisma.notification.findFirst({
        where: { category: "msme", link },
        select: { id: true },
      });
      if (already) continue;
      await notify({
        category: "msme",
        title: `${b.supplierName}: ₹${b.outstanding.toFixed(2)} due in ${b.daysLeft} day(s)`,
        body:
          `Bill ${b.invoiceNo} accepted on ${b.acceptedOn} has to be paid by ${b.dueDate} ` +
          `(${b.limitDays} days under section 15). After that the deduction moves to the year it is paid.`,
        link,
        to: { permission: "payable.view" },
        level: b.daysLeft <= 2 ? "WARNING" : "INFO",
      });
      sent++;
    }
    return { checked: rows.length, sent };
  }

  /**
   * What a payment run should know before it pays somebody (P2-10). Paying a micro or small
   * supplier directly shows that supplier's own bills about to breach the clock; paying anyone
   * else shows how many small-supplier bills elsewhere are about to breach, since the money that
   * goes out today is money that cannot go to them instead. Never a reason to block the payment.
   */
  /**
   * A payment run may pay several people in one voucher (the multi-row entry grid); every debit
   * row with a `supplierId` is a payee, and the warning has to look at all of them, not just the
   * first (P2-18). `payeeSupplierIds` accepts one id, several, or none.
   */
  async paymentWarning(
    payeeSupplierIds?: number | number[],
    asOn = new Date()
  ): Promise<
    | { type: "PAYEE_SMALL"; bills: MsmeBillRow[]; count: number; amount: number }
    | { type: "OTHER_SMALL"; count: number; amount: number }
  > {
    const dueSoon = (rows: MsmeBillRow[]) => rows.filter((b) => b.overdue || b.daysLeft <= 5);
    const ids = [
      ...new Set(
        (Array.isArray(payeeSupplierIds)
          ? payeeSupplierIds
          : payeeSupplierIds
            ? [payeeSupplierIds]
            : []
        ).filter((id): id is number => typeof id === "number" && Number.isFinite(id))
      ),
    ];

    if (ids.length > 0) {
      const covered = await prisma.supplier.findMany({
        where: { id: { in: ids }, msmeCategory: { in: COVERED } },
        select: { id: true },
      });
      if (covered.length > 0) {
        const perPayee = await Promise.all(
          covered.map((s) => this.bills({ asOn, supplierId: s.id, openOnly: true }))
        );
        const bills = dueSoon(perPayee.flat());
        return {
          type: "PAYEE_SMALL",
          bills,
          count: bills.length,
          amount: n2(bills.reduce((s, b) => s + b.outstanding, 0)),
        };
      }
    }
    const bills = dueSoon(await this.bills({ asOn, openOnly: true }));
    return {
      type: "OTHER_SMALL",
      count: bills.length,
      amount: n2(bills.reduce((s, b) => s + b.outstanding, 0)),
    };
  }

  /** The daily sweep across every tenant. */
  async sweepAllTenants(today = new Date()) {
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let sent = 0;
    for (const c of companies) {
      try {
        const res = await runAsTenant(c.id, () => this.warnUpcoming(today));
        sent += res.sent;
      } catch (err) {
        logger.error({ companyId: c.id, err }, "MSME payment clock sweep failed for a tenant");
      }
    }
    return { companies: companies.length, sent };
  }
}

export const msmeService = new MsmeService();
