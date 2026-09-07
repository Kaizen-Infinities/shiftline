import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  AGEING_BUCKETS,
  bucketFor,
  daysOverdue,
  dueDateFrom,
  emptyBuckets,
  overdueInterest,
  type AgeingBucket,
  type BucketTotals,
} from "./ageing";

/**
 * Receivable and payable ageing (P1-10): unpaid document balances bucketed by days past due,
 * per party, with the documents behind a party's row when one party is asked for. Balances
 * come from the documents themselves (grand total less the payments recorded on them), which
 * is what a customer or supplier recognises on a statement.
 */
export interface AgedDocument {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  amount: number;
  paid: number;
  balance: number;
  daysOverdue: number;
  bucket: AgeingBucket;
  interest: number;
}

export interface AgeingRow {
  partyId: string;
  code: string;
  name: string;
  phone: string | null;
  creditDays: number | null;
  interestRate: number | null;
  buckets: BucketTotals;
  total: number;
  overdue: number;
  interest: number;
  oldestDueDate: string | null;
  documents?: AgedDocument[];
}

export interface AgeingReport {
  asOnDate: string;
  buckets: readonly AgeingBucket[];
  rows: AgeingRow[];
  totals: BucketTotals & { total: number; overdue: number; interest: number };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const paymentsTotal = (raw: unknown): number => {
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((sum: number, p) => {
    const amount = p && typeof p === "object" ? Number((p as { amount?: unknown }).amount) : 0;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
};

const firstPhone = (raw: unknown): string | null => {
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : null;
  return typeof raw === "string" && raw ? raw : null;
};

const parseAsOn = (asOnDate?: string): Date => {
  if (!asOnDate) return new Date();
  const d = new Date(`${asOnDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "asOnDate must be YYYY-MM-DD");
  return d;
};

interface PartyInput {
  partyId: string;
  code: string;
  name: string;
  phone: string | null;
  creditDays: number | null;
  interestRate: number | null;
  docs: {
    id: string;
    number: string;
    date: Date;
    dueDate: Date | null;
    amount: number;
    paid: number;
  }[];
}

const buildReport = (asOn: Date, parties: PartyInput[], withDocuments: boolean): AgeingReport => {
  const totals = { ...emptyBuckets(), total: 0, overdue: 0, interest: 0 };
  const rows: AgeingRow[] = [];
  for (const party of parties) {
    const buckets = emptyBuckets();
    let total = 0;
    let overdue = 0;
    let interest = 0;
    let oldest: Date | null = null;
    const documents: AgedDocument[] = [];
    for (const doc of party.docs) {
      const balance = round2(doc.amount - doc.paid);
      if (balance <= 0.005) continue;
      const due = doc.dueDate ?? dueDateFrom(doc.date, party.creditDays);
      const days = daysOverdue(due, asOn);
      const bucket = bucketFor(days);
      const docInterest = overdueInterest(balance, days, party.interestRate);
      buckets[bucket] = round2(buckets[bucket] + balance);
      total = round2(total + balance);
      if (days >= 0) {
        overdue = round2(overdue + balance);
        if (!oldest || due < oldest) oldest = due;
      }
      interest = round2(interest + docInterest);
      if (withDocuments) {
        documents.push({
          id: doc.id,
          number: doc.number,
          date: isoDay(doc.date),
          dueDate: isoDay(due),
          amount: round2(doc.amount),
          paid: round2(doc.paid),
          balance,
          daysOverdue: days,
          bucket,
          interest: docInterest,
        });
      }
    }
    if (total <= 0.005 && !withDocuments) continue;
    for (const b of AGEING_BUCKETS) totals[b] = round2(totals[b] + buckets[b]);
    totals.total = round2(totals.total + total);
    totals.overdue = round2(totals.overdue + overdue);
    totals.interest = round2(totals.interest + interest);
    rows.push({
      partyId: party.partyId,
      code: party.code,
      name: party.name,
      phone: party.phone,
      creditDays: party.creditDays,
      interestRate: party.interestRate,
      buckets,
      total,
      overdue,
      interest,
      oldestDueDate: oldest ? isoDay(oldest) : null,
      ...(withDocuments && {
        documents: documents.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      }),
    });
  }
  rows.sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name));
  return { asOnDate: isoDay(asOn), buckets: AGEING_BUCKETS, rows, totals };
};

class AgeingService {
  async receivable(params: { asOnDate?: string; customerId?: string; search?: string }) {
    const asOn = parseAsOn(params.asOnDate);
    const customers = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...(params.customerId && { id: params.customerId }),
        ...(params.search && {
          OR: [
            { firmName: { contains: params.search, mode: "insensitive" } },
            { customerCode: { contains: params.search, mode: "insensitive" } },
          ],
        }),
      },
      select: {
        id: true,
        customerCode: true,
        firmName: true,
        mobile: true,
        creditDays: true,
        overdueInterestRate: true,
      },
      orderBy: { firmName: "asc" },
    });
    if (params.customerId && customers.length === 0) {
      throw new ApiError(404, "Customer not found");
    }
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        customerId: { in: customers.map((c) => c.id) },
        cancelledAt: null,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        invoiceDate: { lte: asOn },
      },
      select: {
        id: true,
        customerId: true,
        invoiceNo: true,
        invoiceDate: true,
        dueDate: true,
        grandTotal: true,
        payments: true,
      },
    });
    const byCustomer = new Map<string, PartyInput["docs"]>();
    for (const inv of invoices) {
      const list = byCustomer.get(inv.customerId) ?? [];
      list.push({
        id: inv.id,
        number: inv.invoiceNo,
        date: inv.invoiceDate,
        dueDate: inv.dueDate,
        amount: Number(inv.grandTotal),
        paid: paymentsTotal(inv.payments),
      });
      byCustomer.set(inv.customerId, list);
    }
    return buildReport(
      asOn,
      customers.map((c) => ({
        partyId: c.id,
        code: c.customerCode,
        name: c.firmName,
        phone: firstPhone(c.mobile),
        creditDays: c.creditDays,
        interestRate: c.overdueInterestRate === null ? null : Number(c.overdueInterestRate),
        docs: byCustomer.get(c.id) ?? [],
      })),
      Boolean(params.customerId)
    );
  }

  async payable(params: { asOnDate?: string; supplierId?: string; search?: string }) {
    const asOn = parseAsOn(params.asOnDate);
    const supplierId = params.supplierId ? Number(params.supplierId) : undefined;
    if (params.supplierId && !Number.isInteger(supplierId)) {
      throw new ApiError(400, "supplierId must be a number");
    }
    const suppliers = await prisma.supplier.findMany({
      where: {
        ...(supplierId && { id: supplierId }),
        ...(params.search && {
          OR: [
            { legalName: { contains: params.search, mode: "insensitive" } },
            { supplierCode: { contains: params.search, mode: "insensitive" } },
          ],
        }),
      },
      select: { id: true, supplierCode: true, legalName: true, mobile: true, creditDays: true },
      orderBy: { legalName: "asc" },
    });
    if (supplierId && suppliers.length === 0) throw new ApiError(404, "Supplier not found");
    const bills = await prisma.grnInvoice.findMany({
      where: {
        supplierId: { in: suppliers.map((s) => s.id) },
        cancelledAt: null,
        status: { not: "CANCELLED" },
        grnDate: { lte: asOn },
      },
      select: {
        id: true,
        supplierId: true,
        grnNumber: true,
        invoiceNo: true,
        grnDate: true,
        supplierInvoiceDate: true,
        billDueDate: true,
        netAmount: true,
        payments: true,
      },
    });
    const bySupplier = new Map<number, PartyInput["docs"]>();
    for (const bill of bills) {
      const list = bySupplier.get(bill.supplierId) ?? [];
      list.push({
        id: String(bill.id),
        number: bill.invoiceNo || bill.grnNumber,
        date: bill.supplierInvoiceDate ?? bill.grnDate,
        dueDate: bill.billDueDate,
        amount: Number(bill.netAmount),
        paid: paymentsTotal(bill.payments),
      });
      bySupplier.set(bill.supplierId, list);
    }
    return buildReport(
      asOn,
      suppliers.map((s) => ({
        partyId: String(s.id),
        code: s.supplierCode,
        name: s.legalName,
        phone: firstPhone(s.mobile),
        creditDays: s.creditDays,
        interestRate: null,
        docs: bySupplier.get(s.id) ?? [],
      })),
      Boolean(supplierId)
    );
  }
}

export const ageingService = new AgeingService();
