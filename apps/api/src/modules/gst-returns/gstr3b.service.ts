import { prisma } from "../../config/prisma";
import { filingApprovalService, hashPayload } from "../filings/filing-approval.service";
import { monthRange, placeFilter, scopeFor, type GstinScope } from "./gst-period";
import { itcService } from "./itc.service";
import type {
  Gstr3bInterStateRow,
  Gstr3bPaymentRow,
  Gstr3bReturn,
  Gstr3bTable31,
  Gstr3bTable32,
  Gstr3bTable4,
  Gstr3bTable5,
  Gstr3bTable61,
  TaxAmounts,
} from "./gstr3b.types";

/**
 * GSTR-3B from the books (P1-13b): the summary return and the tax actually payable. The outward
 * side reads the same documents as GSTR-1; the credit side reads only the ITC ledger, so every
 * figure in table 4 can be traced to an inward document and the rule that classified it. The
 * month is registered on the filing gate with a hash of the tables, so any later change to a
 * document of the month voids the approval.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const zero = (): TaxAmounts => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const add = (t: TaxAmounts, v: Partial<TaxAmounts>, sign = 1): void => {
  t.taxable = n2(t.taxable + sign * (v.taxable ?? 0));
  t.igst = n2(t.igst + sign * (v.igst ?? 0));
  t.cgst = n2(t.cgst + sign * (v.cgst ?? 0));
  t.sgst = n2(t.sgst + sign * (v.sgst ?? 0));
  t.cess = n2(t.cess + sign * (v.cess ?? 0));
};
const sum = (...parts: TaxAmounts[]): TaxAmounts => {
  const t = zero();
  for (const p of parts) add(t, p);
  return t;
};
const minus = (a: TaxAmounts, b: TaxAmounts): TaxAmounts => {
  const t = { ...a };
  add(t, b, -1);
  return t;
};
const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);

/** Rows of table 3.2, kept by place of supply and summed. */
const posAdd = (
  map: Map<string, Gstr3bInterStateRow>,
  pos: string,
  taxable: number,
  igst: number
) => {
  const cur = map.get(pos) ?? { pos, taxable: 0, igst: 0 };
  cur.taxable = n2(cur.taxable + taxable);
  cur.igst = n2(cur.igst + igst);
  map.set(pos, cur);
};
const posRows = (map: Map<string, Gstr3bInterStateRow>): Gstr3bInterStateRow[] =>
  [...map.values()]
    .filter((r) => r.taxable !== 0 || r.igst !== 0)
    .sort((a, b) => a.pos.localeCompare(b.pos));

/**
 * Sections 49A and 49B: IGST credit is spent first (against IGST, then CGST, then SGST), then
 * CGST credit (CGST, then IGST) and SGST credit (SGST, then IGST). Cess only meets cess.
 * Reverse-charge liability never reaches this function: it is always cash.
 */
export const setOff = (
  liability: { igst: number; cgst: number; sgst: number; cess: number },
  credit: { igst: number; cgst: number; sgst: number; cess: number }
) => {
  const owed = { ...liability };
  const left = { ...credit };
  const used: Record<string, { igst: number; cgst: number; sgst: number; cess: number }> = {
    IGST: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    CGST: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    SGST: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    CESS: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  };
  const spend = (
    head: "IGST" | "CGST" | "SGST" | "CESS",
    from: "igst" | "cgst" | "sgst" | "cess"
  ) => {
    const owedKey = head.toLowerCase() as "igst" | "cgst" | "sgst" | "cess";
    const take = n2(Math.min(owed[owedKey], left[from]));
    if (take <= 0) return;
    owed[owedKey] = n2(owed[owedKey] - take);
    left[from] = n2(left[from] - take);
    used[head][from] = n2(used[head][from] + take);
  };
  spend("IGST", "igst");
  spend("CGST", "igst");
  spend("SGST", "igst");
  spend("CGST", "cgst");
  spend("IGST", "cgst");
  spend("SGST", "sgst");
  spend("IGST", "sgst");
  spend("CESS", "cess");
  return { owed, left, used };
};

class Gstr3bService {
  /**
   * `skipItcRebuild` is for a caller that has already rebuilt the ledger across the months it
   * needs — GSTR-9 builds twelve of these, and a rebuild per month would sweep the lookback
   * twelve times over for the same answer.
   */
  async build(
    periodKey: string,
    gstin?: string | null,
    opts: { skipItcRebuild?: boolean } = {}
  ): Promise<Gstr3bReturn> {
    const period = monthRange(periodKey);
    const scope = await scopeFor(gstin);
    const warnings: string[] = [];

    if (!opts.skipItcRebuild) await itcService.rebuild(periodKey, scope);
    const [outward, credit] = await Promise.all([
      this.outward(periodKey, scope),
      this.credit(periodKey, scope, warnings),
    ]);
    const table31: Gstr3bTable31 = {
      ...outward.table31,
      d: credit.reverseChargeLiability,
    };
    // The set-off can only spend credit that is actually available: a month whose reversals
    // exceed its credit pays the whole liability in cash and carries nothing forward.
    const net = credit.table4.net;
    const table61 = this.paymentFrom(
      {
        igst: n2(table31.a.igst + table31.b.igst),
        cgst: n2(table31.a.cgst + table31.b.cgst),
        sgst: n2(table31.a.sgst + table31.b.sgst),
        cess: n2(table31.a.cess + table31.b.cess),
      },
      table31.d,
      {
        igst: Math.max(0, net.igst),
        cgst: Math.max(0, net.cgst),
        sgst: Math.max(0, net.sgst),
        cess: Math.max(0, net.cess),
      }
    );

    const tables = {
      table31,
      table311: { ecoPays: zero(), registeredThroughEco: zero() },
      table32: outward.table32,
      table4: credit.table4,
      table5: credit.table5,
      table61,
    };
    const payloadHash = hashPayload({ gstin: scope.gstin, fp: period.fp, ...tables });
    const filing = await filingApprovalService.find("GSTR3B", periodKey, scope.filingPlaceId);
    return {
      gstin: scope.gstin,
      periodKey,
      fp: period.fp,
      ...tables,
      itc: credit.rows,
      warnings,
      payloadHash,
      filing,
    };
  }

  /** Tables 3.1(a)(b)(c)(e) and 3.2 from the sales documents of the month, net of credit notes. */
  private async outward(
    periodKey: string,
    scope: GstinScope
  ): Promise<{ table31: Gstr3bTable31; table32: Gstr3bTable32 }> {
    const period = monthRange(periodKey);
    const place = placeFilter(scope);
    const [invoices, returns] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: { ...place, invoiceDate: { gte: period.from, lt: period.to }, cancelledAt: null },
        include: {
          customer: { select: { gstRegType: true, stateCode: true } },
          items: true,
        },
      }),
      prisma.salesReturn.findMany({
        where: {
          ...place,
          returnDate: { gte: period.from, lt: period.to },
          cancelledAt: null,
          creditNoteNo: { not: null },
        },
        include: { customer: { select: { gstRegType: true, stateCode: true } }, items: true },
      }),
    ]);

    const table31: Gstr3bTable31 = { a: zero(), b: zero(), c: zero(), d: zero(), e: zero() };
    const unregistered = new Map<string, Gstr3bInterStateRow>();
    const composition = new Map<string, Gstr3bInterStateRow>();
    const uin = new Map<string, Gstr3bInterStateRow>();

    /** One document, `sign` −1 for a credit note. */
    const place31 = (
      supplyType: string,
      regType: string | null | undefined,
      pos: string,
      lines: {
        rate: number;
        taxable: number;
        igst: number;
        cgst: number;
        sgst: number;
        cess: number;
      }[],
      sign: number
    ) => {
      const zeroRated = supplyType === "EXPORT" || supplyType === "SEZ";
      const taxed = lines.filter((l) => l.rate > 0);
      const nil = lines.filter((l) => l.rate === 0);
      const totalOf = (ls: typeof lines) => ({
        taxable: n2(ls.reduce((s, l) => s + l.taxable, 0)),
        igst: n2(ls.reduce((s, l) => s + l.igst, 0)),
        cgst: n2(ls.reduce((s, l) => s + l.cgst, 0)),
        sgst: n2(ls.reduce((s, l) => s + l.sgst, 0)),
        cess: n2(ls.reduce((s, l) => s + l.cess, 0)),
      });
      if (zeroRated) {
        // An export is a zero-rated supply whether or not IGST was paid on it.
        add(table31.b, totalOf(lines), sign);
        return;
      }
      if (taxed.length) {
        const t = totalOf(taxed);
        add(table31.a, t, sign);
        // 3.2 reports the inter-state part of 3.1(a) by the buyer's kind and place of supply.
        if (supplyType === "INTER_STATE") {
          const map =
            regType === "COMPOSITION"
              ? composition
              : regType === "UIN"
                ? uin
                : regType === "UNREGISTERED"
                  ? unregistered
                  : null;
          if (map) posAdd(map, pos, n2(sign * t.taxable), n2(sign * t.igst));
        }
      }
      if (nil.length) add(table31.c, totalOf(nil), sign);
    };

    for (const inv of invoices) {
      place31(
        inv.supplyType,
        inv.customerGstin ? inv.customer.gstRegType : "UNREGISTERED",
        inv.placeOfSupply ?? inv.customer.stateCode ?? scope.stateCode,
        inv.items.map((it) => ({
          rate: n2(Number(it.igstRate) || Number(it.cgstRate) + Number(it.sgstRate)),
          taxable: n2(it.taxableAmount),
          igst: n2(it.igstAmount),
          cgst: n2(it.cgstAmount),
          sgst: n2(it.sgstAmount),
          cess: n2(it.cessAmount),
        })),
        1
      );
    }
    for (const ret of returns) {
      place31(
        ret.supplyType,
        ret.customerGstin ? ret.customer.gstRegType : "UNREGISTERED",
        ret.placeOfSupply ?? ret.customer.stateCode ?? scope.stateCode,
        ret.items.map((it) => ({
          rate: n2(it.taxRate),
          taxable: n2(it.taxableAmount),
          igst: n2(it.igstAmount),
          cgst: n2(it.cgstAmount),
          sgst: n2(it.sgstAmount),
          cess: 0,
        })),
        -1
      );
    }

    return {
      table31,
      table32: {
        unregistered: posRows(unregistered),
        composition: posRows(composition),
        uin: posRows(uin),
      },
    };
  }

  /** Tables 4, 5 and the reverse-charge liability of 3.1(d), all from the ITC ledger. */
  private async credit(periodKey: string, scope: GstinScope, warnings: string[]) {
    const period = monthRange(periodKey);
    const entries = await itcService.forPeriod(periodKey);
    const available: Gstr3bTable4["available"] = {
      importGoods: zero(),
      importServices: zero(),
      reverseCharge: zero(),
      isd: zero(),
      other: zero(),
      total: zero(),
    };
    const reversedOthers = zero();
    const reclaimed = zero();
    const ineligible = zero();
    const reverseChargeLiability = zero();

    for (const e of entries) {
      const v: TaxAmounts = {
        taxable: n2(e.taxable),
        igst: n2(e.igst),
        cgst: n2(e.cgst),
        sgst: n2(e.sgst),
        cess: n2(e.cess),
      };
      const availedHere = e.periodKey === periodKey;
      if (availedHere && e.source === "RCM" && e.status !== "VOID") add(reverseChargeLiability, v);
      if (availedHere && e.status === "ELIGIBLE") {
        const bucket =
          e.source === "IMPORT_GOODS"
            ? available.importGoods
            : e.source === "IMPORT_SERVICES"
              ? available.importServices
              : e.source === "RCM"
                ? available.reverseCharge
                : e.source === "ISD"
                  ? available.isd
                  : available.other;
        add(bucket, v);
      }
      if (availedHere && e.status === "INELIGIBLE") add(ineligible, v);
      if (e.reversedPeriod === periodKey && e.status === "REVERSED") add(reversedOthers, v);
      if (e.reclaimedPeriod === periodKey && e.status === "RECLAIMED") {
        // Reclaimed credit is taken again in 4A(5) and disclosed in 4D(1).
        add(available.other, v);
        add(reclaimed, v);
      }
    }

    // Credit given back on goods returned to the supplier in this month.
    const purchaseReturns = await prisma.purchaseReturn.findMany({
      where: {
        ...placeFilter(scope),
        returnDate: { gte: period.from, lt: period.to },
        cancelledAt: null,
      },
      select: {
        igstAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        items: { select: { taxableAmount: true } },
      },
    });
    for (const r of purchaseReturns) {
      add(reversedOthers, {
        taxable: n2(r.items.reduce((s, i) => s + Number(i.taxableAmount), 0)),
        igst: n2(r.igstAmount),
        cgst: n2(r.cgstAmount),
        sgst: n2(r.sgstAmount),
        cess: 0,
      });
    }

    available.total = sum(
      available.importGoods,
      available.importServices,
      available.reverseCharge,
      available.isd,
      available.other
    );
    // Rules 38, 42 and 43 need an exempt-turnover ratio the books do not carry yet (P1-13d).
    const reversedRules = zero();
    const reversedTotal = sum(reversedRules, reversedOthers);
    const table4: Gstr3bTable4 = {
      available,
      reversed: { rules: reversedRules, others: reversedOthers, total: reversedTotal },
      net: minus(available.total, reversedTotal),
      other: { reclaimed, ineligible },
    };
    if (
      table4.available.total.igst + table4.available.total.cgst + table4.available.total.sgst >
      0
    ) {
      warnings.push(
        "Table 4B(1) does not include a rules 42/43 proportional reversal; compute it by hand if the company has exempt turnover"
      );
    }

    return {
      table4,
      table5: await this.exemptInward(periodKey, scope),
      reverseChargeLiability,
      rows: entries.map((e) => ({
        id: e.id,
        docType: e.docType,
        docNo: e.docNo,
        docDate: ymd(e.docDate),
        supplierGstin: e.supplierGstin,
        source: e.source,
        status: e.status,
        rule: e.rule,
        reason: e.reason,
        igst: n2(e.igst),
        cgst: n2(e.cgst),
        sgst: n2(e.sgst),
        cess: n2(e.cess),
        taxable: n2(e.taxable),
        periodKey: e.periodKey,
        reversedPeriod: e.reversedPeriod,
        reclaimedPeriod: e.reclaimedPeriod,
      })),
    };
  }

  /** Table 5: inward supplies of the month that carried no GST at all. */
  private async exemptInward(periodKey: string, scope: GstinScope): Promise<Gstr3bTable5> {
    const period = monthRange(periodKey);
    const place = placeFilter(scope);
    const t: Gstr3bTable5 = {
      interState: { composition: 0, nilExempt: 0, nonGst: 0 },
      intraState: { composition: 0, nilExempt: 0, nonGst: 0 },
    };
    const [grns, expenses] = await Promise.all([
      prisma.grnInvoice.findMany({
        where: { ...place, grnDate: { gte: period.from, lt: period.to }, cancelledAt: null },
        select: {
          subtotal: true,
          totalDiscount: true,
          totalIgst: true,
          totalCgst: true,
          totalSgst: true,
          supplyType: true,
          reverseCharge: true,
          supplier: { select: { gstRegType: true } },
        },
      }),
      prisma.expense.findMany({
        where: { ...place, date: { gte: period.from, lt: period.to }, cancelledAt: null },
        select: {
          amount: true,
          igstAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          supplyType: true,
          reverseCharge: true,
          supplier: { select: { gstRegType: true } },
        },
      }),
    ]);
    const put = (
      supplyType: string,
      regType: string | null | undefined,
      value: number,
      taxed: boolean,
      rcm: boolean
    ) => {
      if (taxed || rcm || value <= 0) return;
      const side = supplyType === "INTRA_STATE" ? t.intraState : t.interState;
      if (regType === "COMPOSITION") side.composition = n2(side.composition + value);
      else side.nilExempt = n2(side.nilExempt + value);
    };
    for (const g of grns) {
      put(
        g.supplyType,
        g.supplier?.gstRegType,
        n2(Number(g.subtotal) - Number(g.totalDiscount)),
        n2(g.totalIgst) + n2(g.totalCgst) + n2(g.totalSgst) > 0,
        g.reverseCharge
      );
    }
    for (const e of expenses) {
      put(
        e.supplyType,
        e.supplier?.gstRegType,
        n2(e.amount),
        n2(e.igstAmount) + n2(e.cgstAmount) + n2(e.sgstAmount) > 0,
        e.reverseCharge
      );
    }
    return t;
  }

  /** Table 6.1: the set-off and what is left to pay in cash. */
  private paymentFrom(
    liability: { igst: number; cgst: number; sgst: number; cess: number },
    rcm: TaxAmounts,
    credit: { igst: number; cgst: number; sgst: number; cess: number }
  ): Gstr3bTable61 {
    const { owed, left, used } = setOff(liability, credit);
    const heads: Gstr3bPaymentRow["head"][] = ["IGST", "CGST", "SGST", "CESS"];
    const rows = heads.map((head) => {
      const key = head.toLowerCase() as "igst" | "cgst" | "sgst" | "cess";
      return {
        head,
        payable: liability[key],
        paidThroughItc: used[head],
        cash: owed[key],
      };
    });
    // Reverse-charge tax cannot be paid out of credit (section 49(4)); it is always cash.
    const rcmRows: Gstr3bPaymentRow[] = heads.map((head) => {
      const key = head.toLowerCase() as "igst" | "cgst" | "sgst" | "cess";
      const payable = n2(rcm[key]);
      return {
        head,
        payable,
        paidThroughItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
        cash: payable,
      };
    });
    const cash = {
      igst: n2(owed.igst + rcm.igst),
      cgst: n2(owed.cgst + rcm.cgst),
      sgst: n2(owed.sgst + rcm.sgst),
      cess: n2(owed.cess + rcm.cess),
      total: 0,
    };
    cash.total = n2(cash.igst + cash.cgst + cash.sgst + cash.cess);
    return {
      otherThanReverseCharge: rows,
      reverseCharge: rcmRows,
      cashPayable: cash,
      creditBalance: left,
    };
  }

  /** Registers (or refreshes) the month on the filing gate with the hash of the tables. */
  async register(periodKey: string, gstin: string | null | undefined, actor: { userId?: string }) {
    const ret = await this.build(periodKey, gstin);
    const scope = await scopeFor(gstin);
    const row = await filingApprovalService.upsertDraft(
      {
        filingType: "GSTR3B",
        periodKey,
        businessPlaceId: scope.filingPlaceId === null ? null : Number(scope.filingPlaceId),
        payloadHash: ret.payloadHash,
        summary: {
          gstin: ret.gstin,
          outwardTaxable: ret.table31.a.taxable,
          outwardTax: n2(ret.table31.a.igst + ret.table31.a.cgst + ret.table31.a.sgst),
          netItc: n2(ret.table4.net.igst + ret.table4.net.cgst + ret.table4.net.sgst),
          cashPayable: ret.table61.cashPayable.total,
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
      "GSTR3B",
      periodKey,
      ret.payloadHash,
      scope.filingPlaceId
    );
    const row = await filingApprovalService.markSubmitted(gate.id, submissionRef, actor);
    return { ...ret, filing: row };
  }
}

export const gstr3bService = new Gstr3bService();
