import { createHash } from "node:crypto";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { unitCode } from "../e-invoice/e-invoice.payload";
import { filingApprovalService, hashPayload } from "../filings/filing-approval.service";
import { advanceService } from "../advances/advance.service";
import { gstinScopes, monthRange, placeFilter, scopeFor, type GstinScope } from "./gst-period";
import type {
  Gstr1AdvanceRow,
  Gstr1B2b,
  Gstr1B2cl,
  Gstr1B2cs,
  Gstr1Cdnr,
  Gstr1Cdnur,
  Gstr1DocIssue,
  Gstr1Exp,
  Gstr1Hsn,
  Gstr1Item,
  Gstr1Json,
  Gstr1Nil,
  Gstr1Return,
  Gstr1Totals,
} from "./gstr1.types";

/**
 * GSTR-1 from the books (P1-13a): every tax invoice, bill of supply, export invoice and credit
 * note of the month for one GSTIN, placed in the portal's tables and serialised as the
 * offline tool's JSON. The return is registered on the filing gate with a hash of the JSON, so
 * any later change to a document of the month voids an approval.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const dmy = (d: Date) => {
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${x.getUTCFullYear()}`;
};
const B2CL_THRESHOLD = 250000;

interface Line {
  rate: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  hsn: string | null;
  qty: number;
  uom: string | null;
  desc: string;
}

/** Lines grouped by rate into the portal's item list. */
const itemsByRate = (lines: Line[], inter: boolean): Gstr1Item[] => {
  const byRate = new Map<number, Line>();
  for (const l of lines) {
    const cur = byRate.get(l.rate) ?? { ...l, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    cur.taxable += l.taxable;
    cur.igst += l.igst;
    cur.cgst += l.cgst;
    cur.sgst += l.sgst;
    cur.cess += l.cess;
    byRate.set(l.rate, cur);
  }
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, l], i) => ({
      num: i + 1,
      itm_det: {
        rt: rate,
        txval: n2(l.taxable),
        ...(inter ? { iamt: n2(l.igst) } : { camt: n2(l.cgst), samt: n2(l.sgst) }),
        csamt: n2(l.cess),
      },
    }));
};

const invTyp = (supplyType: string, igst: number): "R" | "SEWP" | "SEWOP" | "DE" =>
  supplyType === "SEZ"
    ? igst > 0
      ? "SEWP"
      : "SEWOP"
    : supplyType === "DEEMED_EXPORT"
      ? "DE"
      : "R";

class Gstr1Service {
  async build(periodKey: string, gstin?: string | null): Promise<Gstr1Return> {
    const period = monthRange(periodKey);
    const scope = await scopeFor(gstin);
    const where = { ...placeFilter(scope), invoiceDate: { gte: period.from, lt: period.to } };
    const [invoices, returns, cancelledInvoices, cancelledNotes] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: { ...where, cancelledAt: null },
        include: {
          customer: { select: { gstRegType: true, stateCode: true, firmName: true } },
          items: {
            include: {
              product: { select: { productName: true, uom: { select: { uomName: true } } } },
            },
          },
        },
        orderBy: { invoiceNo: "asc" },
      }),
      prisma.salesReturn.findMany({
        where: {
          ...placeFilter(scope),
          returnDate: { gte: period.from, lt: period.to },
          cancelledAt: null,
          creditNoteNo: { not: null },
        },
        include: {
          customer: { select: { gstRegType: true, stateCode: true } },
          items: {
            include: {
              product: { select: { productName: true, uom: { select: { uomName: true } } } },
            },
          },
        },
        orderBy: { creditNoteNo: "asc" },
      }),
      prisma.salesInvoice.findMany({
        where: { ...where, cancelledAt: { not: null } },
        select: { invoiceNo: true },
      }),
      prisma.salesReturn.findMany({
        where: {
          ...placeFilter(scope),
          returnDate: { gte: period.from, lt: period.to },
          cancelledAt: { not: null },
          creditNoteNo: { not: null },
        },
        select: { creditNoteNo: true },
      }),
    ]);

    const warnings: string[] = [];
    // 11A and 11B: tax on an advance falls due when the money arrives, and is released when the
    // invoice finally goes out. Both belong to the month they happened in (P1-14).
    const advances = await advanceService.gstr1Tables(
      period.from,
      period.to,
      scope.businessPlaceIds
    );
    const advanceRow = (
      r: { pos: string; rate: number; taxable: number; igst: number; cgst: number; sgst: number },
      inter: boolean
    ): Gstr1AdvanceRow => ({
      pos: r.pos,
      sply_ty: inter ? "INTER" : "INTRA",
      rt: r.rate,
      ad_amt: n2(r.taxable),
      ...(inter ? { iamt: n2(r.igst) } : { camt: n2(r.cgst), samt: n2(r.sgst) }),
      csamt: 0,
    });
    const advanceRows = {
      table11A: advances.table11A.map((r) => advanceRow(r, r.igst > 0)),
      table11B: advances.table11B.map((r) => advanceRow(r, r.igst > 0)),
    };
    const b2b = new Map<string, Gstr1B2b>();
    const b2cl = new Map<string, Gstr1B2cl>();
    const b2cs = new Map<string, Gstr1B2cs>();
    const cdnr = new Map<string, Gstr1Cdnr>();
    const cdnur: Gstr1Cdnur[] = [];
    const exp = new Map<"WPAY" | "WOPAY", Gstr1Exp>();
    const hsn = new Map<string, Gstr1Hsn>();
    const nil: Record<Gstr1Nil["inv"][number]["sply_ty"], number> = {
      INTRB2B: 0,
      INTRB2C: 0,
      INTRAB2B: 0,
      INTRAB2C: 0,
    };
    const totals: Gstr1Totals = {
      invoices: 0,
      creditNotes: 0,
      taxable: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
      total: 0,
      byTable: {},
    };
    const count = (table: string, taxable: number, tax: number) => {
      const t = (totals.byTable[table] ??= { count: 0, taxable: 0, tax: 0 });
      t.count++;
      t.taxable = n2(t.taxable + taxable);
      t.tax = n2(t.tax + tax);
    };
    const addHsn = (l: Line, inter: boolean) => {
      if (!l.hsn) return;
      const key = `${l.hsn}|${l.rate}|${unitCode(l.uom)}`;
      const cur = hsn.get(key) ?? {
        num: 0,
        hsn_sc: l.hsn,
        desc: l.desc.slice(0, 30),
        uqc: unitCode(l.uom),
        qty: 0,
        txval: 0,
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
        rt: l.rate,
      };
      cur.qty = Math.round((cur.qty + l.qty) * 1000) / 1000;
      cur.txval = n2(cur.txval + l.taxable);
      cur.iamt = n2(cur.iamt + (inter ? l.igst : 0));
      cur.camt = n2(cur.camt + l.cgst);
      cur.samt = n2(cur.samt + l.sgst);
      cur.csamt = n2(cur.csamt + l.cess);
      hsn.set(key, cur);
    };

    for (const inv of invoices) {
      const lines: Line[] = inv.items.map((it) => ({
        rate: n2(Number(it.igstRate) || Number(it.cgstRate) + Number(it.sgstRate)),
        taxable: n2(it.taxableAmount),
        igst: n2(it.igstAmount),
        cgst: n2(it.cgstAmount),
        sgst: n2(it.sgstAmount),
        cess: n2(it.cessAmount),
        hsn: it.hsnCode,
        qty: Number(it.quantity),
        uom: it.product?.uom?.uomName ?? null,
        desc: it.product?.productName ?? it.description ?? "",
      }));
      const taxable = n2(lines.reduce((s, l) => s + l.taxable, 0));
      const igst = n2(lines.reduce((s, l) => s + l.igst, 0));
      const cgst = n2(lines.reduce((s, l) => s + l.cgst, 0));
      const sgst = n2(lines.reduce((s, l) => s + l.sgst, 0));
      const cess = n2(lines.reduce((s, l) => s + l.cess, 0));
      const inter = inv.supplyType !== "INTRA_STATE";
      const pos = inv.placeOfSupply ?? inv.customer.stateCode ?? scope.stateCode;
      const val = n2(inv.grandTotal);
      const taxed = lines.filter((l) => l.rate > 0);
      const zero = lines.filter((l) => l.rate === 0);
      const registered = Boolean(inv.customerGstin);
      for (const l of lines) addHsn(l, inter);
      if (lines.some((l) => !l.hsn)) warnings.push(`${inv.invoiceNo}: a line has no HSN`);
      totals.invoices++;
      totals.taxable = n2(totals.taxable + taxable);
      totals.igst = n2(totals.igst + igst);
      totals.cgst = n2(totals.cgst + cgst);
      totals.sgst = n2(totals.sgst + sgst);
      totals.cess = n2(totals.cess + cess);
      totals.total = n2(totals.total + val);

      if (inv.supplyType === "EXPORT") {
        // The document says how it was exported; the tax on it is the fallback when it does not.
        const typ = inv.exportType === "WITH_TAX" || igst > 0 ? "WPAY" : "WOPAY";
        if (!inv.shippingBillNo) {
          warnings.push(`${inv.invoiceNo}: an export with no shipping bill number`);
        }
        const e = exp.get(typ) ?? { exp_typ: typ, inv: [] };
        e.inv.push({
          inum: inv.invoiceNo,
          idt: dmy(inv.invoiceDate),
          val,
          // The shipping bill is what proves the goods left; without it the portal cannot
          // match the export to customs and the refund does not come.
          ...(inv.shippingBillNo ? { sbnum: inv.shippingBillNo } : {}),
          ...(inv.shippingBillDate ? { sbdt: dmy(inv.shippingBillDate) } : {}),
          ...(inv.portCode ? { sbpcode: inv.portCode } : {}),
          itms: itemsByRate(taxed.length ? taxed : lines, true).map((i) => ({
            txval: i.itm_det.txval,
            rt: i.itm_det.rt,
            iamt: i.itm_det.iamt ?? 0,
            csamt: i.itm_det.csamt,
          })),
        });
        exp.set(typ, e);
        count("exp", taxable, igst);
        continue;
      }
      if (zero.length) {
        const key = `${inter ? "INTR" : "INTRA"}${registered ? "B2B" : "B2C"}` as keyof typeof nil;
        nil[key] = n2(nil[key] + zero.reduce((s, l) => s + l.taxable, 0));
      }
      if (taxed.length === 0) {
        count("nil", taxable, 0);
        continue;
      }
      if (registered) {
        const ctin = inv.customerGstin as string;
        const g = b2b.get(ctin) ?? { ctin, inv: [] };
        g.inv.push({
          inum: inv.invoiceNo,
          idt: dmy(inv.invoiceDate),
          val,
          pos,
          rchrg: "N",
          inv_typ: invTyp(inv.supplyType, igst),
          itms: itemsByRate(taxed, inter),
        });
        b2b.set(ctin, g);
        count("b2b", taxable, igst + cgst + sgst + cess);
      } else if (inter && val > B2CL_THRESHOLD) {
        const g = b2cl.get(pos) ?? { pos, inv: [] };
        g.inv.push({
          inum: inv.invoiceNo,
          idt: dmy(inv.invoiceDate),
          val,
          itms: itemsByRate(taxed, true),
        });
        b2cl.set(pos, g);
        count("b2cl", taxable, igst + cess);
      } else {
        for (const l of taxed) {
          const key = `${inter ? "INTER" : "INTRA"}|${pos}|${l.rate}`;
          const cur = b2cs.get(key) ?? {
            sply_ty: inter ? "INTER" : "INTRA",
            rt: l.rate,
            typ: "OE",
            pos,
            txval: 0,
            ...(inter ? { iamt: 0 } : { camt: 0, samt: 0 }),
            csamt: 0,
          };
          cur.txval = n2(cur.txval + l.taxable);
          if (inter) cur.iamt = n2((cur.iamt ?? 0) + l.igst);
          else {
            cur.camt = n2((cur.camt ?? 0) + l.cgst);
            cur.samt = n2((cur.samt ?? 0) + l.sgst);
          }
          cur.csamt = n2(cur.csamt + l.cess);
          b2cs.set(key, cur);
        }
        count("b2cs", taxable, igst + cgst + sgst + cess);
      }
    }

    for (const ret of returns) {
      const lines: Line[] = ret.items.map((it) => ({
        rate: n2(it.taxRate),
        taxable: n2(it.taxableAmount),
        igst: n2(it.igstAmount),
        cgst: n2(it.cgstAmount),
        sgst: n2(it.sgstAmount),
        cess: 0,
        hsn: it.hsnCode,
        qty: -Number(it.quantity),
        uom: it.product?.uom?.uomName ?? it.uom ?? null,
        desc: it.product?.productName ?? "",
      }));
      const taxable = n2(lines.reduce((s, l) => s + l.taxable, 0));
      const igst = n2(lines.reduce((s, l) => s + l.igst, 0));
      const cgst = n2(lines.reduce((s, l) => s + l.cgst, 0));
      const sgst = n2(lines.reduce((s, l) => s + l.sgst, 0));
      const inter = ret.supplyType !== "INTRA_STATE";
      const pos = ret.placeOfSupply ?? ret.customer.stateCode ?? scope.stateCode;
      const val = n2(ret.grandTotal);
      const note = ret.creditNoteNo as string;
      const taxed = lines.filter((l) => l.rate > 0);
      totals.creditNotes++;
      totals.taxable = n2(totals.taxable - taxable);
      totals.igst = n2(totals.igst - igst);
      totals.cgst = n2(totals.cgst - cgst);
      totals.sgst = n2(totals.sgst - sgst);
      totals.total = n2(totals.total - val);
      if (ret.customerGstin) {
        const g = cdnr.get(ret.customerGstin) ?? { ctin: ret.customerGstin, nt: [] };
        g.nt.push({
          ntty: "C",
          nt_num: note,
          nt_dt: dmy(ret.returnDate),
          p_gst: "N",
          val,
          pos,
          rchrg: "N",
          inv_typ: invTyp(ret.supplyType, igst),
          itms: itemsByRate(taxed.length ? taxed : lines, inter),
        });
        cdnr.set(ret.customerGstin, g);
        count("cdnr", -taxable, -(igst + cgst + sgst));
      } else {
        cdnur.push({
          typ: ret.supplyType === "EXPORT" ? (igst > 0 ? "EXPWP" : "EXPWOP") : "B2CL",
          ntty: "C",
          nt_num: note,
          nt_dt: dmy(ret.returnDate),
          val,
          pos,
          itms: itemsByRate(taxed.length ? taxed : lines, true),
        });
        count("cdnur", -taxable, -igst);
      }
    }

    const docIssue = (
      docNum: number,
      docTyp: string,
      numbers: string[],
      cancelled: number
    ): Gstr1DocIssue | null => {
      if (numbers.length + cancelled === 0) return null;
      const sorted = [...numbers].sort();
      return {
        doc_num: docNum,
        doc_typ: docTyp,
        docs: [
          {
            num: 1,
            from: sorted[0] ?? "",
            to: sorted[sorted.length - 1] ?? "",
            totnum: numbers.length + cancelled,
            cancel: cancelled,
            net_issue: numbers.length,
          },
        ],
      };
    };
    const doc_det = [
      docIssue(
        1,
        "Invoices for outward supply",
        invoices.map((i) => i.invoiceNo),
        cancelledInvoices.length
      ),
      docIssue(
        5,
        "Credit Note",
        returns.map((r) => r.creditNoteNo as string),
        cancelledNotes.length
      ),
    ].filter((d): d is Gstr1DocIssue => d !== null);

    const hsnData = [...hsn.values()]
      .sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.rt - b.rt)
      .map((h, i) => ({ ...h, num: i + 1 }));
    const json: Omit<Gstr1Json, "hash"> = {
      gstin: scope.gstin,
      fp: period.fp,
      version: "GST3.1.8",
      b2b: [...b2b.values()],
      b2cl: [...b2cl.values()],
      b2cs: [...b2cs.values()],
      cdnr: [...cdnr.values()],
      cdnur,
      exp: [...exp.values()],
      nil: {
        inv: (Object.keys(nil) as (keyof typeof nil)[])
          .filter((k) => nil[k] > 0)
          .map((k) => ({ sply_ty: k, nil_amt: nil[k], expt_amt: 0, ngsup_amt: 0 })),
      },
      at: advanceRows.table11A,
      txpd: advanceRows.table11B,
      hsn: { data: hsnData },
      doc_issue: { doc_det },
    };
    const payloadHash = hashPayload(json);
    const filing = await filingApprovalService.find("GSTR1", periodKey, scope.filingPlaceId);
    return {
      gstin: scope.gstin,
      periodKey,
      fp: period.fp,
      json: {
        ...json,
        hash: createHash("sha256").update(JSON.stringify(json)).digest("hex").slice(0, 16),
      },
      totals,
      warnings,
      payloadHash,
      filing,
    };
  }

  /** Registers (or refreshes) the month on the filing gate with the hash of the tables. */
  async register(periodKey: string, gstin: string | null | undefined, actor: { userId?: string }) {
    const ret = await this.build(periodKey, gstin);
    const scope = await scopeFor(gstin);
    const row = await filingApprovalService.upsertDraft(
      {
        filingType: "GSTR1",
        periodKey,
        businessPlaceId: scope.filingPlaceId === null ? null : Number(scope.filingPlaceId),
        payloadHash: ret.payloadHash,
        summary: {
          gstin: ret.gstin,
          invoices: ret.totals.invoices,
          creditNotes: ret.totals.creditNotes,
          taxable: ret.totals.taxable,
          igst: ret.totals.igst,
          cgst: ret.totals.cgst,
          sgst: ret.totals.sgst,
          cess: ret.totals.cess,
          warnings: ret.warnings.length,
        },
        notes: ret.warnings.slice(0, 3).join("; ") || null,
      },
      actor
    );
    return { ...ret, filing: row };
  }

  /** The gate: approved and unchanged since approval; then the return is marked filed. */
  async markFiled(
    periodKey: string,
    gstin: string | null | undefined,
    submissionRef: string | null,
    actor: { userId?: string }
  ) {
    const ret = await this.build(periodKey, gstin);
    const scope = await scopeFor(gstin);
    const gate = await filingApprovalService.assertSubmittable(
      "GSTR1",
      periodKey,
      ret.payloadHash,
      scope.filingPlaceId
    );
    const row = await filingApprovalService.markSubmitted(gate.id, submissionRef, actor);
    return { ...ret, filing: row };
  }

  scopes(): Promise<GstinScope[]> {
    return gstinScopes();
  }
}

export const gstr1Service = new Gstr1Service();

export const assertMonth = (key: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))
    throw new ApiError(400, "period must look like 2026-08");
  return key;
};
