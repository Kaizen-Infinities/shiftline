/**
 * Document numbering (P1-08): one series per document type, optional branch and
 * financial year, from `DocumentSequence`. Numbers are `PREFIX/FY/SEQ`
 * (e.g. `INV/2026-27/0001`), which keeps within GST's 16-character limit with a
 * prefix of up to four characters. `next()` increments atomically inside the
 * caller's transaction; `peek()` shows the next number without consuming it.
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { companyGstProfile, resolveIssuingPlace } from "../gst/gst.context";
import { ApiError } from "../../utils/ApiError";

type Db = Prisma.TransactionClient | typeof prisma;

/** Default prefixes; a tenant may change them on the sequence rows. */
export const DOCUMENT_PREFIXES: Record<string, string> = {
  SALES_ORDER: "SO",
  SALES_INVOICE: "INV",
  BILL_OF_SUPPLY: "BOS",
  EXPORT_INVOICE: "EX",
  PURCHASE_ORDER: "PO",
  GRN: "GRN",
  RECEIPT: "RCT",
  PAYMENT: "PMT",
  JOURNAL: "JV",
  CONTRA: "CTR",
  CREDIT_NOTE: "CN",
  DEBIT_NOTE: "DN",
  DELIVERY_CHALLAN: "DC",
  SALES_RETURN: "SR",
  PURCHASE_RETURN: "PR",
  EXPENSE: "EXP",
  /** P1-14: advances taken before the invoice, and the voucher that gives one back. */
  RECEIPT_VOUCHER: "RV",
  REFUND_VOUCHER: "RFV",
  JOB_WORK_CHALLAN: "JW",
  /** TN-05: an MSME delayed-payment claim on a buyer (not a tax document). */
  MSME_CLAIM: "MSC",
  /** QA F4: distinct from purchase orders ("PO"); new series only, existing codes are untouched. */
  PRODUCTION_ORDER: "MO",
  /** TN-10: a subsidy / scheme claim to a government body (not a tax document). */
  SUBSIDY_CLAIM: "SUB",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Financial-year code for a date given the FY's first month (1–12): `2026-27`, or `2026` for a calendar year. */
export const fyCodeFor = (date: Date, fyStartMonth: number): string => {
  const m = date.getUTCMonth() + 1;
  const y = date.getUTCFullYear();
  const startYear = m >= fyStartMonth ? y : y - 1;
  return fyStartMonth === 1 ? `${startYear}` : `${startYear}-${pad2((startYear + 1) % 100)}`;
};

export interface NumberOptions {
  date?: Date;
  businessPlaceId?: bigint | null;
  tx?: Db;
}

class DocumentNumberService {
  private async fyStartMonth(db: Db): Promise<number> {
    const setting = await db.invoiceSetting.findUnique({ where: { companyId: requireTenantId() } });
    return setting ? setting.financialYearStart.getUTCMonth() + 1 : 4;
  }

  private format(prefix: string, fyCode: string, n: number, padding: number) {
    return `${prefix}/${fyCode}/${String(n).padStart(padding, "0")}`;
  }

  /** A branch series starts from the head-office prefix plus the place code. */
  private async prefixFor(db: Db, docType: string, businessPlaceId: bigint | null) {
    const prefix = DOCUMENT_PREFIXES[docType];
    if (!prefix) throw new ApiError(400, `No numbering series for ${docType}`);
    if (businessPlaceId) {
      const place = await db.businessPlace.findUnique({ where: { id: businessPlaceId } });
      if (place && !place.isHeadOffice) return `${prefix}-${place.code}`.slice(0, 8);
    }
    return prefix;
  }

  private async ensureRow(db: Db, docType: string, businessPlaceId: bigint | null, fyCode: string) {
    const found = await db.documentSequence.findFirst({
      where: { docType, businessPlaceId, fyCode },
    });
    if (found) return found;
    const fullPrefix = await this.prefixFor(db, docType, businessPlaceId);
    return db.documentSequence.create({
      data: { docType, businessPlaceId, fyCode, prefix: fullPrefix },
    });
  }

  /** Consumes and returns the next number in the series. */
  async next(docType: string, opts: NumberOptions = {}): Promise<string> {
    if (!opts.tx) {
      // Raw SQL only sees the tenant's rows inside a tenant transaction (set_config runs there).
      return prisma.$transaction((tx) => this.next(docType, { ...opts, tx }));
    }
    const db = opts.tx;
    const companyId = requireTenantId();
    const date = opts.date ?? new Date();
    const fyCode = fyCodeFor(date, await this.fyStartMonth(db));
    const businessPlaceId = opts.businessPlaceId ?? null;
    await this.ensureRow(db, docType, businessPlaceId, fyCode);
    // Atomic increment; the row lock serialises concurrent callers within the tenant.
    const rows = await db.$queryRaw<{ next: number; prefix: string; padding: number }[]>`
      UPDATE document_sequences
         SET next = next + 1, updated_at = now()
       WHERE company_id = ${companyId}::uuid
         AND doc_type = ${docType}
         AND business_place_id IS NOT DISTINCT FROM ${businessPlaceId}
         AND fy_code = ${fyCode}
      RETURNING next - 1 AS next, prefix, padding`;
    if (!rows.length) throw new ApiError(500, `Numbering series for ${docType} vanished`);
    const r = rows[0];
    return this.format(r.prefix, fyCode, Number(r.next), r.padding);
  }

  /**
   * The number `next()` would return, without consuming it, locking the series or creating its
   * row. With no `businessPlaceId` it uses the place a document is raised from by default (the
   * head office), exactly as the document services resolve it, so a form's preview is the number
   * the save assigns.
   */
  async peek(docType: string, opts: NumberOptions = {}): Promise<string> {
    const db = opts.tx ?? prisma;
    const date = opts.date ?? new Date();
    const fyCode = fyCodeFor(date, await this.fyStartMonth(db));
    const { row, businessPlaceId } = await this.findRow(db, docType, fyCode, opts);
    if (row) return this.format(row.prefix, fyCode, row.next, row.padding);
    // No row yet: the number a fresh series would start at (schema defaults: next 1, padding 4).
    return this.format(await this.prefixFor(db, docType, businessPlaceId), fyCode, 1, 4);
  }

  /** Read-only: the series row `next()` would use for these options (null if not created yet). */
  private async findRow(db: Db, docType: string, fyCode: string, opts: NumberOptions) {
    let businessPlaceId = opts.businessPlaceId ?? null;
    let row = null;
    if (opts.businessPlaceId === undefined) {
      businessPlaceId = (await resolveIssuingPlace(null, await companyGstProfile(db), db)).id;
      row = await db.documentSequence.findFirst({ where: { docType, businessPlaceId, fyCode } });
      if (!row && businessPlaceId) {
        // Services that number without a place (year-end, claims) keep a company-wide series.
        const company = await db.documentSequence.findFirst({
          where: { docType, businessPlaceId: null, fyCode },
        });
        if (company) {
          row = company;
          businessPlaceId = null;
        }
      }
    } else {
      row = await db.documentSequence.findFirst({ where: { docType, businessPlaceId, fyCode } });
    }
    return { row, businessPlaceId };
  }

  /**
   * Forms that submit the number they were shown (the production order screen) get that number
   * when it is still the series' next one; if somebody else took it meanwhile (or the number is
   * stale or from the future) they get a fresh `next()` number instead. Never a duplicate and
   * never a failure. The check and the increment are one conditional UPDATE, so two saves of the
   * same preview cannot both win. An empty `shown` just allocates the next number. Call inside the saving transaction (pass `tx`) so a failed save
   * does not burn a number.
   */
  async takeShownOrNext(docType: string, shown: string, opts: NumberOptions = {}): Promise<string> {
    if (!opts.tx) {
      return prisma.$transaction((tx) => this.takeShownOrNext(docType, shown, { ...opts, tx }));
    }
    const db = opts.tx;
    const date = opts.date ?? new Date();
    const fyCode = fyCodeFor(date, await this.fyStartMonth(db));
    const { row, businessPlaceId } = await this.findRow(db, docType, fyCode, opts);
    const seq = shown ? Number(shown.split("/")[2]) : NaN;
    if (
      !row ||
      !Number.isInteger(seq) ||
      this.format(row.prefix, fyCode, seq, row.padding) !== shown
    ) {
      // A fresh series (no row yet) still starts at 1; anything not matching the live row is stale.
      if (!row && Number.isInteger(seq) && seq === 1) {
        const fresh = await this.ensureRow(db, docType, businessPlaceId, fyCode);
        if (this.format(fresh.prefix, fyCode, 1, fresh.padding) === shown) {
          return (await this.claimExact(db, fresh.id, seq)) ? shown : this.next(docType, opts);
        }
      }
      return this.next(docType, { ...opts, businessPlaceId });
    }
    return (await this.claimExact(db, row.id, seq))
      ? shown
      : this.next(docType, { ...opts, businessPlaceId });
  }

  /** Advances the series past `seq` only if `seq` is still the next number. */
  private async claimExact(db: Db, rowId: string, seq: number): Promise<boolean> {
    const claimed = await db.$queryRaw<{ id: string }[]>`
      UPDATE document_sequences
         SET next = next + 1, updated_at = now()
       WHERE id = ${rowId}::uuid AND next = ${seq}
      RETURNING id`;
    return claimed.length > 0;
  }
}

export const documentNumberService = new DocumentNumberService();
