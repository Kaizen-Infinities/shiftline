import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { monthRange, placeFilter, type GstinScope } from "./gst-period";

/**
 * The input tax credit ledger (P1-13b). One `ItcEntry` per inward document carrying GST, rebuilt
 * from the documents whenever a period is computed: what credit the document brings, whether it
 * may be taken (section 17(5)), whether it had to be reversed because the supplier was not paid
 * within 180 days (rule 37), and whether it came back when the bill was settled. Rows are updated
 * in place and never deleted; a manual classification survives every rebuild.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const d2 = (v: number) => new Prisma.Decimal(n2(v).toFixed(2));

/** Rule 37: credit goes back when the bill is still unpaid this many days after the document. */
export const RULE_37_DAYS = 180;

/**
 * Section 17(5) blocked credits that can be recognised from the HSN/SAC alone. The list is the
 * common set, not the whole section: the per-document call (`Expense.itcEligible`) and a manual
 * classification on the entry are the real control, and this only saves the obvious cases.
 */
export const BLOCKED_HSN_PREFIXES = [
  "8703", // motor cars for the transport of persons
  "8711", // motorcycles
  "2202", // waters and other non-alcoholic beverages
  "2203", // beer
  "2204", // wine
  "2205",
  "2206",
  "2207",
  "2208", // spirits
  "2402", // cigarettes and cigars
  "9963", // accommodation, food and beverage service
  "9964", // passenger transport
  "9971", // life and health insurance falls here; membership of a club is 9995
  "9995", // services of membership organisations
];

export const isBlockedHsn = (hsn: string | null | undefined): boolean =>
  Boolean(hsn) && BLOCKED_HSN_PREFIXES.some((p) => (hsn as string).startsWith(p));

export type ItcDocType = "GRN" | "EXPENSE" | "PETTY_CASH";
export type ItcSource = "RCM" | "IMPORT_GOODS" | "IMPORT_SERVICES" | "ISD" | "OTHER";

/** What a rebuild computes for one inward document, before the manual override is applied. */
interface Candidate {
  docType: ItcDocType;
  docId: string;
  docNo: string;
  docDate: Date;
  supplierGstin: string | null;
  hsnCode: string | null;
  source: ItcSource;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  cancelled: boolean;
  /** False when the document itself says the credit is blocked. */
  eligible: boolean;
  /** Amount that must be paid for rule 37, and what has been paid by the end of the period. */
  payable: number;
  paid: number;
}

const statusOf = (
  c: Candidate
): { status: "ELIGIBLE" | "INELIGIBLE" | "VOID"; rule: string | null; reason: string | null } => {
  if (c.cancelled)
    return { status: "VOID", rule: "CANCELLED", reason: "The document was cancelled" };
  if (!c.eligible)
    return { status: "INELIGIBLE", rule: "17(5)", reason: "Blocked credit on the document" };
  if (isBlockedHsn(c.hsnCode))
    return { status: "INELIGIBLE", rule: "17(5)", reason: `Blocked credit for HSN ${c.hsnCode}` };
  return { status: "ELIGIBLE", rule: null, reason: null };
};

/** Days between two dates, ignoring the time of day. */
const daysBetween = (from: Date, to: Date) =>
  Math.floor(
    (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
      86400000
  );

class ItcService {
  /** The inward documents of a month, as ledger candidates. */
  private async candidates(periodKey: string, scope: GstinScope): Promise<Candidate[]> {
    const period = monthRange(periodKey);
    const place = placeFilter(scope);
    const [grns, expenses, petty] = await Promise.all([
      prisma.grnInvoice.findMany({
        where: { ...place, grnDate: { gte: period.from, lt: period.to } },
        include: {
          items: { select: { hsnCode: true } },
          paymentRecords: { select: { amount: true, paymentDate: true } },
          supplier: { select: { gstRegType: true } },
        },
      }),
      prisma.expense.findMany({
        where: { ...place, date: { gte: period.from, lt: period.to } },
        include: { supplier: { select: { gstRegType: true } } },
      }),
      prisma.pettyCashEntry.findMany({
        where: { ...place, entryDate: { gte: period.from, lt: period.to } },
      }),
    ]);

    const out: Candidate[] = [];
    for (const g of grns) {
      const igst = n2(g.totalIgst);
      const cgst = n2(g.totalCgst);
      const sgst = n2(g.totalSgst);
      const cess = n2(g.totalCess);
      if (igst + cgst + sgst + cess === 0 && !g.reverseCharge) continue;
      const paid = n2(
        g.paymentRecords
          .filter((p) => p.paymentDate < period.to)
          .reduce((s, p) => s + Number(p.amount), 0)
      );
      out.push({
        docType: "GRN",
        docId: g.id,
        docNo: g.grnNumber,
        docDate: g.supplierInvoiceDate ?? g.grnDate,
        supplierGstin: g.supplierGstin ?? null,
        hsnCode: g.items.find((i) => i.hsnCode)?.hsnCode ?? null,
        source: g.reverseCharge
          ? "RCM"
          : g.supplier?.gstRegType === "OVERSEAS"
            ? "IMPORT_GOODS"
            : "OTHER",
        taxable: n2(Number(g.subtotal) - Number(g.totalDiscount)),
        igst,
        cgst,
        sgst,
        cess,
        cancelled: g.cancelledAt !== null,
        eligible: true,
        payable: n2(g.netAmount),
        paid,
      });
    }
    for (const e of expenses) {
      const igst = n2(e.igstAmount);
      const cgst = n2(e.cgstAmount);
      const sgst = n2(e.sgstAmount);
      if (igst + cgst + sgst === 0 && !e.reverseCharge) continue;
      out.push({
        docType: "EXPENSE",
        docId: e.id,
        docNo: e.expenseNumber,
        docDate: e.date,
        supplierGstin: e.vendorGstin ?? null,
        hsnCode: e.hsnCode ?? null,
        source: e.reverseCharge
          ? "RCM"
          : e.supplier?.gstRegType === "OVERSEAS"
            ? "IMPORT_SERVICES"
            : "OTHER",
        taxable: n2(e.taxableAmount ?? Number(e.amount) - (igst + cgst + sgst)),
        igst,
        cgst,
        sgst,
        cess: 0,
        cancelled: e.cancelledAt !== null,
        eligible: e.itcEligible,
        // An expense is recorded when it is settled; rule 37 does not bite.
        payable: 0,
        paid: 0,
      });
    }
    for (const p of petty) {
      const tax = n2(p.taxAmount);
      if (tax === 0 || !p.vendorGstin) continue;
      // Petty cash carries one GST figure; the split follows the company's own state.
      const inter = p.vendorGstin.slice(0, 2) !== scope.stateCode;
      out.push({
        docType: "PETTY_CASH",
        docId: String(p.id),
        docNo: p.entryNo,
        docDate: p.entryDate,
        supplierGstin: p.vendorGstin,
        hsnCode: p.hsnCode ?? null,
        source: "OTHER",
        taxable: n2(Number(p.amount) - tax),
        igst: inter ? tax : 0,
        cgst: inter ? 0 : n2(tax / 2),
        sgst: inter ? 0 : n2(tax - n2(tax / 2)),
        cess: 0,
        cancelled: p.cancelledAt !== null,
        eligible: true,
        payable: 0,
        paid: 0,
      });
    }
    return out;
  }

  /**
   * Rebuilds the ledger rows of one month and then applies rule 37 across every earlier month,
   * as at the end of this period. Returns nothing; the tables read the rows back.
   */
  async rebuild(periodKey: string, scope: GstinScope): Promise<void> {
    const period = monthRange(periodKey);
    const cands = await this.candidates(periodKey, scope);
    const existing = await prisma.itcEntry.findMany({
      where: { periodKey, docType: { in: ["GRN", "EXPENSE", "PETTY_CASH"] } },
    });
    const byKey = new Map(existing.map((e) => [`${e.docType}|${e.docId}`, e]));

    for (const c of cands) {
      const call = statusOf(c);
      const prev = byKey.get(`${c.docType}|${c.docId}`);
      // A manual classification outranks the computed one, but never survives a cancellation.
      const manual = prev?.manualStatus ?? null;
      const status = call.status === "VOID" ? "VOID" : (manual ?? call.status);
      const data = {
        periodKey,
        docType: c.docType,
        docNo: c.docNo,
        docDate: c.docDate,
        supplierGstin: c.supplierGstin,
        hsnCode: c.hsnCode,
        source: c.source,
        taxable: d2(c.taxable),
        igst: d2(c.igst),
        cgst: d2(c.cgst),
        sgst: d2(c.sgst),
        cess: d2(c.cess),
        status,
        rule: manual && call.status !== "VOID" ? "MANUAL" : call.rule,
        reason: manual && call.status !== "VOID" ? (prev?.manualReason ?? null) : call.reason,
      };
      await prisma.itcEntry.upsert({
        where: {
          companyId_docType_docId: {
            companyId: requireTenantId(),
            docType: c.docType,
            docId: c.docId,
          },
        },
        create: { ...data, docId: c.docId },
        update: data,
      });
    }

    await this.applyRule37(period.to, periodKey);
  }

  /**
   * Rule 37 as at the end of the period: an unpaid bill older than 180 days gives its credit
   * back in this period; a reversed bill that has since been paid takes it back.
   */
  private async applyRule37(periodEnd: Date, periodKey: string): Promise<void> {
    const asAt = new Date(periodEnd.getTime() - 86400000); // the last day of the period
    const grnEntries = await prisma.itcEntry.findMany({
      where: { docType: "GRN", status: { in: ["ELIGIBLE", "REVERSED"] } },
    });
    if (grnEntries.length === 0) return;
    // Payments are read once for every bill in the ledger, not just this month's.
    const ids = grnEntries.map((e) => e.docId);
    const grns = await prisma.grnInvoice.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        netAmount: true,
        paymentRecords: { select: { amount: true, paymentDate: true } },
      },
    });
    const paidBy = new Map(
      grns.map((g) => [
        g.id,
        {
          payable: n2(g.netAmount),
          paid: n2(
            g.paymentRecords
              .filter((p) => p.paymentDate <= asAt)
              .reduce((s, p) => s + Number(p.amount), 0)
          ),
        },
      ])
    );
    for (const e of grnEntries) {
      const pay = paidBy.get(e.docId);
      if (!pay) continue;
      const settled = pay.paid + 0.01 >= pay.payable;
      const overdue = daysBetween(e.docDate, asAt) > RULE_37_DAYS;
      if (e.status === "ELIGIBLE" && overdue && !settled) {
        await prisma.itcEntry.update({
          where: { id: e.id },
          data: {
            status: "REVERSED",
            rule: "180D",
            reason: `Unpaid ${RULE_37_DAYS} days after ${e.docNo}`,
            reversedPeriod: periodKey,
          },
        });
      } else if (e.status === "REVERSED" && e.rule === "180D" && settled) {
        await prisma.itcEntry.update({
          where: { id: e.id },
          data: {
            status: "RECLAIMED",
            rule: "180D",
            reason: `Paid; credit reclaimed in ${periodKey}`,
            reclaimedPeriod: periodKey,
          },
        });
      }
    }
  }

  /** Every ledger row that touches a period: availed in it, reversed in it or reclaimed in it. */
  async forPeriod(periodKey: string) {
    return prisma.itcEntry.findMany({
      where: {
        OR: [{ periodKey }, { reversedPeriod: periodKey }, { reclaimedPeriod: periodKey }],
      },
      orderBy: [{ docDate: "asc" }, { docNo: "asc" }],
    });
  }

  /** A hand classification by an accountant; survives every later rebuild. */
  async classify(
    id: string,
    input: { status: "ELIGIBLE" | "INELIGIBLE"; reason: string },
    actor: { userId?: string }
  ) {
    return prisma.itcEntry.update({
      where: { id },
      data: {
        status: input.status,
        manualStatus: input.status,
        manualReason: input.reason,
        manualBy: actor.userId?.slice(0, 36) ?? null,
        rule: "MANUAL",
        reason: input.reason,
      },
    });
  }
}

export const itcService = new ItcService();
