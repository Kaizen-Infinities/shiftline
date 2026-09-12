import { Prisma, type Gstr2bMatchStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { monthRange, placeFilter, scopeFor, type GstinScope } from "./gst-period";
import { envelopeOf, normaliseDocNo, parse2b } from "./gstr2b.parse";
import {
  DEFAULT_TOLERANCE,
  type BookDocument,
  type Gstr2bJson,
  type MatchTolerance,
  type MismatchField,
  type ParsedRecord,
  type ReconciliationSummary,
} from "./gstr2b.types";
import { providerFor } from "./providers";

/**
 * GSTR-2B (P1-13c): what the suppliers filed, brought in from the portal and placed against the
 * company's own purchase register.
 *
 * The two never agree exactly, and the differences are the month's work: a supplier who filed
 * late, filed a different value, or did not file at all is credit the company cannot take,
 * whatever its books say. Records are evidence and are never edited — the company's only input
 * is the IMS decision (`ims.service.ts`) it takes on each one.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const DAY = 86400000;

/** The books' side of the reconciliation: every inward document of the period. */
const bookDocuments = async (periodKey: string, scope: GstinScope): Promise<BookDocument[]> => {
  const period = monthRange(periodKey);
  const window = { gte: period.from, lt: period.to };
  const place = placeFilter(scope);
  const [grns, expenses] = await Promise.all([
    prisma.grnInvoice.findMany({
      where: { ...place, grnDate: window, cancelledAt: null },
      include: { items: { select: { taxableAmount: true } } },
    }),
    prisma.expense.findMany({
      where: { ...place, date: window, cancelledAt: null, vendorGstin: { not: null } },
    }),
  ]);
  const out: BookDocument[] = [];
  for (const g of grns) {
    const docNo = g.invoiceNo || g.grnNumber;
    out.push({
      docType: "GRN",
      docId: g.id,
      docNo,
      docNoNorm: normaliseDocNo(docNo),
      docDate: g.supplierInvoiceDate ?? g.grnDate,
      supplierGstin: g.supplierGstin,
      taxable: n2(g.items.reduce((s, i) => s + Number(i.taxableAmount), 0)),
      igst: n2(g.totalIgst),
      cgst: n2(g.totalCgst),
      sgst: n2(g.totalSgst),
      cess: n2(g.totalCess),
      docValue: n2(g.netAmount),
    });
  }
  for (const e of expenses) {
    out.push({
      docType: "EXPENSE",
      docId: e.id,
      docNo: e.expenseNumber,
      docNoNorm: normaliseDocNo(e.expenseNumber),
      docDate: e.date,
      supplierGstin: e.vendorGstin,
      taxable: n2(e.taxableAmount ?? 0),
      igst: n2(e.igstAmount),
      cgst: n2(e.cgstAmount),
      sgst: n2(e.sgstAmount),
      cess: 0,
      docValue: n2(e.amount),
    });
  }
  return out;
};

/** What differs between a book document and the supplier's filing, and by how much. */
const differences = (
  book: BookDocument,
  portal: {
    docDate: Date;
    taxable: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  },
  tolerance: MatchTolerance
): MismatchField[] => {
  const out: MismatchField[] = [];
  const dayGap = Math.abs(book.docDate.getTime() - portal.docDate.getTime()) / DAY;
  if (dayGap > tolerance.days) {
    out.push({
      field: "docDate",
      inBooks: book.docDate.toISOString().slice(0, 10),
      inPortal: portal.docDate.toISOString().slice(0, 10),
      difference: Math.round(dayGap),
    });
  }
  const heads: ("taxable" | "igst" | "cgst" | "sgst" | "cess")[] = [
    "taxable",
    "igst",
    "cgst",
    "sgst",
    "cess",
  ];
  for (const head of heads) {
    const diff = n2(book[head] - portal[head]);
    if (Math.abs(diff) > tolerance.value) {
      out.push({ field: head, inBooks: book[head], inPortal: portal[head], difference: diff });
    }
  }
  return out;
};

class Gstr2bService {
  /** Writes a parsed 2B into the ledger, replacing what an earlier import of the period said. */
  private async store(
    periodKey: string,
    gstin: string,
    records: ParsedRecord[],
    sourceKind: string
  ) {
    let written = 0;
    for (const r of records) {
      const data = {
        periodKey,
        gstin,
        supplierGstin: r.supplierGstin,
        supplierName: r.supplierName?.slice(0, 160) ?? null,
        docType: r.docType,
        docNo: r.docNo.slice(0, 40),
        docNoNorm: normaliseDocNo(r.docNo),
        docDate: r.docDate,
        docValue: r.docValue,
        placeOfSupply: r.placeOfSupply,
        reverseCharge: r.reverseCharge,
        taxable: r.taxable,
        igst: r.igst,
        cgst: r.cgst,
        sgst: r.sgst,
        cess: r.cess,
        itcAvailable: r.itcAvailable,
        itcReason: r.itcReason?.slice(0, 120) ?? null,
        filingPeriod: r.filingPeriod,
        filingDate: r.filingDate,
        sourceKind,
        raw: r.raw as object,
      };
      await prisma.gstr2bRecord.upsert({
        where: {
          companyId_periodKey_supplierGstin_docType_docNo: {
            companyId: requireTenantId(),
            periodKey,
            supplierGstin: r.supplierGstin,
            docType: r.docType,
            docNo: r.docNo.slice(0, 40),
          },
        },
        create: data,
        update: data,
      });
      written++;
    }
    return written;
  }

  /** Imports the JSON an accountant downloaded from the portal. */
  async importJson(periodKey: string, gstin: string | null | undefined, json: Gstr2bJson) {
    const scope = await scopeFor(gstin);
    const envelope = envelopeOf(json);
    if (envelope.gstin && envelope.gstin !== scope.gstin) {
      throw new ApiError(
        400,
        `That file was drawn for ${envelope.gstin}, not ${scope.gstin}`,
        "GSTIN_MISMATCH"
      );
    }
    if (envelope.periodKey && envelope.periodKey !== periodKey) {
      throw new ApiError(
        400,
        `That file is the 2B for ${envelope.periodKey}, not ${periodKey}`,
        "PERIOD_MISMATCH"
      );
    }
    const records = parse2b(json);
    const written = await this.store(periodKey, scope.gstin, records, "IMPORT");
    logger.info({ periodKey, gstin: scope.gstin, written }, "GSTR-2B imported");
    return this.reconcile(periodKey, scope.gstin);
  }

  /** Pulls the 2B through the configured provider. */
  async pull(periodKey: string, gstin: string | null | undefined) {
    const scope = await scopeFor(gstin);
    const config = await prisma.eInvoiceConfig.findFirst();
    const provider = providerFor(config?.provider ?? "FIXTURE");
    const json = await provider.fetch2b(periodKey, {
      baseUrl: config?.baseUrl ?? null,
      clientId: config?.clientId ?? null,
      clientSecret: config?.clientSecret ?? null,
      username: config?.username ?? null,
      password: config?.password ?? null,
      gstin: scope.gstin,
    });
    const records = parse2b(json);
    await this.store(periodKey, scope.gstin, records, provider.name);
    return this.reconcile(periodKey, scope.gstin);
  }

  /**
   * Places every 2B record of the period against the purchase register and every book document
   * against the 2B, and records the verdict on each record.
   *
   * A record and a document are the same thing when the supplier GSTIN agrees and the
   * normalised document numbers agree; the date and the values then decide MATCHED or MISMATCH.
   * Nothing is matched twice: a document already claimed by one record is out of the running for
   * the next, so two invoices with the same number cannot both point at it.
   */
  async reconcile(
    periodKey: string,
    gstin?: string | null,
    tolerance: MatchTolerance = DEFAULT_TOLERANCE
  ) {
    const scope = await scopeFor(gstin);
    const [records, books] = await Promise.all([
      prisma.gstr2bRecord.findMany({
        where: { periodKey, gstin: scope.gstin },
        orderBy: [{ supplierGstin: "asc" }, { docDate: "asc" }],
      }),
      bookDocuments(periodKey, scope),
    ]);

    const byKey = new Map<string, BookDocument[]>();
    for (const b of books) {
      if (!b.supplierGstin) continue;
      const key = `${b.supplierGstin}|${b.docNoNorm}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(b);
      else byKey.set(key, [b]);
    }
    const claimed = new Set<string>();

    for (const rec of records) {
      const key = `${rec.supplierGstin}|${rec.docNoNorm}`;
      const candidate = (byKey.get(key) ?? []).find((b) => !claimed.has(`${b.docType}:${b.docId}`));
      if (!candidate) {
        await prisma.gstr2bRecord.update({
          where: { id: rec.id },
          data: {
            matchStatus: "MISSING_IN_BOOKS",
            matchedDocType: null,
            matchedDocId: null,
            mismatchFields: Prisma.DbNull,
          },
        });
        continue;
      }
      claimed.add(`${candidate.docType}:${candidate.docId}`);
      const diffs = differences(
        candidate,
        {
          docDate: rec.docDate,
          taxable: n2(rec.taxable),
          igst: n2(rec.igst),
          cgst: n2(rec.cgst),
          sgst: n2(rec.sgst),
          cess: n2(rec.cess),
        },
        tolerance
      );
      await prisma.gstr2bRecord.update({
        where: { id: rec.id },
        data: {
          matchStatus: diffs.length === 0 ? "MATCHED" : "MISMATCH",
          matchedDocType: candidate.docType,
          matchedDocId: candidate.docId,
          mismatchFields: diffs.length === 0 ? Prisma.DbNull : (diffs as object[]),
        },
      });
    }

    // Whatever the 2B never mentioned is credit the books claim and the supplier did not file.
    const missingIn2b = books.filter(
      (b) => b.supplierGstin && !claimed.has(`${b.docType}:${b.docId}`)
    );
    return this.summary(periodKey, scope.gstin, missingIn2b);
  }

  /** The reconciliation as a person reads it: the four buckets and the two credit totals. */
  async summary(periodKey: string, gstin: string, missingIn2b: BookDocument[] = []) {
    const records = await prisma.gstr2bRecord.findMany({
      where: { periodKey, gstin },
      include: { imsAction: true },
      orderBy: [{ supplierGstin: "asc" }, { docDate: "asc" }],
    });
    const count = (status: Gstr2bMatchStatus) =>
      records.filter((r) => r.matchStatus === status).length;
    const credit = (rows: { igst: unknown; cgst: unknown; sgst: unknown; cess: unknown }[]) => ({
      igst: n2(rows.reduce((s, r) => s + Number(r.igst), 0)),
      cgst: n2(rows.reduce((s, r) => s + Number(r.cgst), 0)),
      sgst: n2(rows.reduce((s, r) => s + Number(r.sgst), 0)),
      cess: n2(rows.reduce((s, r) => s + Number(r.cess), 0)),
    });
    // Only what the portal actually offers counts as available credit: a record the portal
    // marks unavailable, or a note, is not credit the company can take.
    const offered = records.filter((r) => r.itcAvailable && r.docType !== "CRN");
    const summary: ReconciliationSummary = {
      matched: count("MATCHED"),
      mismatch: count("MISMATCH"),
      missingIn2b: missingIn2b.length,
      missingInBooks: count("MISSING_IN_BOOKS"),
      portalCredit: credit(offered),
      bookCredit: credit([
        ...records.filter((r) => r.matchStatus === "MATCHED" || r.matchStatus === "MISMATCH"),
        ...missingIn2b,
      ]),
    };
    return { periodKey, gstin, summary, records, missingIn2b };
  }

  async list(periodKey: string, gstin: string | null | undefined, status?: Gstr2bMatchStatus) {
    const scope = await scopeFor(gstin);
    return prisma.gstr2bRecord.findMany({
      where: { periodKey, gstin: scope.gstin, ...(status ? { matchStatus: status } : {}) },
      include: { imsAction: true },
      orderBy: [{ supplierGstin: "asc" }, { docDate: "asc" }],
    });
  }
}

export const gstr2bService = new Gstr2bService();
