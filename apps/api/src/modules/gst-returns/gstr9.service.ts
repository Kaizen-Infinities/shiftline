import { createHash } from "node:crypto";

import { prisma } from "../../config/prisma";
import { filingApprovalService } from "../filings/filing-approval.service";
import { unitCode } from "../e-invoice/e-invoice.payload";
import { fyRange, placeFilter, scopeFor, type GstinScope } from "./gst-period";
import { gstr3bService } from "./gstr3b.service";
import type { Gstr3bReturn, TaxAmounts } from "./gstr3b.types";
import { itcService } from "./itc.service";
import type {
  Gstr9HsnRow,
  Gstr9Return,
  Gstr9Table4,
  Gstr9Table5,
  Gstr9Table6,
  Gstr9Table7,
  Gstr9Table8,
  Gstr9Table9Row,
} from "./gstr9.types";

/**
 * GSTR-9 working papers (P1-13d): the twelve months added up the way the annual return asks.
 *
 * This is deliberately not a filing. The annual return is reconciled by a person against the
 * books and the monthly returns, and the tables that matter most are the *differences* — 6(J)
 * between the credit taken in 3B and the credit the documents justify, and 8(D) between what
 * suppliers filed and what the company claimed. Those two are where an annual return is won or
 * lost, so they are computed rather than left blank, and the rest is the arithmetic around them.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const zero = (): TaxAmounts => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const add = (t: TaxAmounts, r: Partial<TaxAmounts>, sign = 1): TaxAmounts => {
  t.taxable = n2(t.taxable + sign * (r.taxable ?? 0));
  t.igst = n2(t.igst + sign * (r.igst ?? 0));
  t.cgst = n2(t.cgst + sign * (r.cgst ?? 0));
  t.sgst = n2(t.sgst + sign * (r.sgst ?? 0));
  t.cess = n2(t.cess + sign * (r.cess ?? 0));
  return t;
};
const sum = (...parts: TaxAmounts[]): TaxAmounts => parts.reduce((acc, p) => add(acc, p), zero());
const minus = (a: TaxAmounts, ...rest: TaxAmounts[]): TaxAmounts => {
  const out = add(zero(), a);
  for (const r of rest) add(out, r, -1);
  return out;
};

/** The twelve month keys of an Indian financial year, April first. */
export const monthsOfFy = (fyKey: string): string[] => {
  const range = fyRange(fyKey);
  const out: string[] = [];
  const d = new Date(range.from);
  while (d < range.to) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
};

/** HSN rows keyed by code, rate and unit, the way tables 17 and 18 want them. */
const hsnBucket = () => {
  const map = new Map<string, Gstr9HsnRow>();
  return {
    add(row: Omit<Gstr9HsnRow, "uqc"> & { uom: string | null }) {
      if (!row.hsn) return;
      const uqc = unitCode(row.uom);
      const key = `${row.hsn}|${row.rate}|${uqc}`;
      const cur =
        map.get(key) ??
        ({
          hsn: row.hsn,
          uqc,
          quantity: 0,
          taxable: 0,
          rate: row.rate,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
        } as Gstr9HsnRow);
      cur.quantity = Math.round((cur.quantity + row.quantity) * 1000) / 1000;
      cur.taxable = n2(cur.taxable + row.taxable);
      cur.igst = n2(cur.igst + row.igst);
      cur.cgst = n2(cur.cgst + row.cgst);
      cur.sgst = n2(cur.sgst + row.sgst);
      cur.cess = n2(cur.cess + row.cess);
      map.set(key, cur);
    },
    rows: () => [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
  };
};

class Gstr9Service {
  async build(fyKey: string, gstin?: string | null): Promise<Gstr9Return> {
    const range = fyRange(fyKey);
    const scope = await scopeFor(gstin);
    const months = monthsOfFy(fyKey);
    const warnings: string[] = [];

    // One rebuild covers the year: the lookback from the last month reaches back past April.
    await itcService.rebuild(months[months.length - 1], scope);

    const [outward, table8, monthly] = await Promise.all([
      this.outward(fyKey, scope),
      this.portalCredit(range.from, range.to, scope),
      this.monthly(months, scope),
    ]);
    const table6and7 = await this.credit(months, monthly.returns, scope, warnings);

    const table9 = this.taxPaid(monthly.returns);
    const table18 = await this.inwardHsn(range.from, range.to, scope);

    // 8(B) is the credit the books claim on ordinary inward supplies, and 8(D) the gap against
    // what the suppliers actually filed. Both need table 6, so they are finished here.
    add(table8.asPerBooks, sum(table6and7.table6.inward, table6and7.table6.reclaimed));
    add(table8.difference, minus(table8.asPer2b, table8.asPerBooks, table8.availedNextYear));
    add(table8.igstCreditAvailed, table6and7.table6.importGoods);
    add(table8.importDifference, minus(table8.igstOnImports, table8.igstCreditAvailed));

    // 6(J) is the finding an annual return exists to surface: credit taken in the monthly
    // returns that the documents do not account for, or the other way round.
    const drift = table6and7.table6.difference;
    if (drift.igst || drift.cgst || drift.sgst || drift.cess) {
      warnings.push(
        `Table 6(J): the credit taken in GSTR-3B differs from the documents by ` +
          `${n2(drift.igst + drift.cgst + drift.sgst + drift.cess)}`
      );
    }
    const gap = table8.difference;
    if (gap.igst + gap.cgst + gap.sgst > 0) {
      warnings.push(
        `Table 8(D): suppliers filed ${n2(gap.igst + gap.cgst + gap.sgst)} of credit the company did not claim`
      );
    }
    if (outward.table4.advances.taxable !== 0) {
      warnings.push("Table 4(F) advances are not modelled; the figure is zero");
    }

    const tables = {
      table4: outward.table4,
      table5: outward.table5,
      table6: table6and7.table6,
      table7: table6and7.table7,
      table8,
      table9,
      table17: outward.table17,
      table18,
    };
    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ gstin: scope.gstin, fyKey, ...tables }))
      .digest("hex");

    return {
      gstin: scope.gstin,
      fyKey,
      months,
      ...tables,
      monthly: monthly.rows,
      warnings,
      payloadHash,
      filing: null,
    };
  }

  /** Tables 4, 5 and 17 from the year's sales documents. */
  private async outward(fyKey: string, scope: GstinScope) {
    const range = fyRange(fyKey);
    const place = placeFilter(scope);
    const window = { gte: range.from, lt: range.to };
    const [invoices, returns] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: { ...place, invoiceDate: window, cancelledAt: null },
        include: {
          customer: { select: { gstRegType: true } },
          items: {
            include: { product: { select: { uom: { select: { uomName: true } } } } },
          },
        },
      }),
      prisma.salesReturn.findMany({
        where: {
          ...place,
          returnDate: window,
          cancelledAt: null,
          creditNoteNo: { not: null },
        },
        include: { customer: { select: { gstRegType: true } }, items: true },
      }),
    ]);

    const t4: Gstr9Table4 = {
      b2c: zero(),
      b2b: zero(),
      exportWithTax: zero(),
      sezWithTax: zero(),
      deemedExport: zero(),
      advances: zero(),
      reverseCharge: zero(),
      subTotal: zero(),
      creditNotes: zero(),
      debitNotes: zero(),
      amendments: zero(),
      total: zero(),
    };
    const t5: Gstr9Table5 = {
      exportWithoutTax: zero(),
      sezWithoutTax: zero(),
      reverseChargeOutward: zero(),
      exempted: zero(),
      nilRated: zero(),
      nonGst: zero(),
      creditNotes: zero(),
      debitNotes: zero(),
      total: zero(),
      grossTurnover: 0,
      turnoverForTheYear: 0,
    };
    const hsn = hsnBucket();

    /**
     * Where a document belongs. Tables 4 and 5 split on one question the monthly return never
     * asks: was tax payable on this supply at all? An export under a bond pays none and sits in
     * 5(A); the same export with IGST paid sits in 4(C).
     */
    const bucketFor = (supplyType: string, registered: boolean, taxed: boolean, igst: number) => {
      if (supplyType === "EXPORT") return igst > 0 ? t4.exportWithTax : t5.exportWithoutTax;
      if (supplyType === "SEZ") return igst > 0 ? t4.sezWithTax : t5.sezWithoutTax;
      if (supplyType === "DEEMED_EXPORT") return t4.deemedExport;
      if (!taxed) return t5.nilRated;
      return registered ? t4.b2b : t4.b2c;
    };

    for (const inv of invoices) {
      const lines = inv.items.map((it) => ({
        rate: n2(Number(it.igstRate) || Number(it.cgstRate) + Number(it.sgstRate)),
        taxable: n2(it.taxableAmount),
        igst: n2(it.igstAmount),
        cgst: n2(it.cgstAmount),
        sgst: n2(it.sgstAmount),
        cess: n2(it.cessAmount),
        hsn: it.hsnCode,
        qty: Number(it.quantity),
        uom: it.product?.uom?.uomName ?? null,
      }));
      const totals = lines.reduce((a, l) => add(a, l), zero());
      const taxed = lines.some((l) => l.rate > 0);
      add(bucketFor(inv.supplyType, Boolean(inv.customerGstin), taxed, totals.igst), totals);
      for (const l of lines) {
        hsn.add({
          hsn: l.hsn ?? "",
          rate: l.rate,
          quantity: l.qty,
          uom: l.uom,
          taxable: l.taxable,
          igst: l.igst,
          cgst: l.cgst,
          sgst: l.sgst,
          cess: l.cess,
        });
      }
    }

    // Notes get their own rows rather than being netted off: the portal asks for them
    // separately, and a year with heavy returns reads very differently once they are visible.
    for (const ret of returns) {
      const totals = ret.items.reduce(
        (a, it) =>
          add(a, {
            taxable: n2(it.taxableAmount),
            igst: n2(it.igstAmount),
            cgst: n2(it.cgstAmount),
            sgst: n2(it.sgstAmount),
          }),
        zero()
      );
      const taxed = totals.igst + totals.cgst + totals.sgst > 0;
      if (ret.supplyType === "EXPORT" || ret.supplyType === "SEZ" || !taxed) {
        add(t5.creditNotes, totals);
      } else {
        add(t4.creditNotes, totals);
      }
    }

    add(
      t4.subTotal,
      sum(
        t4.b2c,
        t4.b2b,
        t4.exportWithTax,
        t4.sezWithTax,
        t4.deemedExport,
        t4.advances,
        t4.reverseCharge
      )
    );
    add(t4.total, minus(sum(t4.subTotal, t4.debitNotes, t4.amendments), t4.creditNotes));
    add(
      t5.total,
      minus(
        sum(
          t5.exportWithoutTax,
          t5.sezWithoutTax,
          t5.reverseChargeOutward,
          t5.exempted,
          t5.nilRated,
          t5.nonGst,
          t5.debitNotes
        ),
        t5.creditNotes
      )
    );
    t5.grossTurnover = n2(t4.total.taxable + t5.total.taxable);
    // (P) takes out the inward reverse charge, which is not turnover at all.
    t5.turnoverForTheYear = n2(t5.grossTurnover - t4.reverseCharge.taxable);

    return { table4: t4, table5: t5, table17: hsn.rows() };
  }

  /**
   * Tables 6 and 7. The rows come from the twelve monthly returns, so 6(I) and the monthly
   * figures cannot drift apart; 6(A) comes from the GSTR-3B that was *filed* where the month
   * was filed, which is what makes 6(J) worth computing at all. A month recomputed from today's
   * books against a return submitted months ago is exactly the drift an annual return exists
   * to surface; when no return was filed the recomputed figure stands in and the month is named
   * in the warnings.
   */
  private async credit(
    months: string[],
    returns: Gstr3bReturn[],
    scope: GstinScope,
    warnings: string[]
  ) {
    const t6: Gstr9Table6 = {
      availedIn3b: zero(),
      inward: zero(),
      reverseChargeUnregistered: zero(),
      reverseChargeRegistered: zero(),
      importGoods: zero(),
      importServices: zero(),
      isd: zero(),
      reclaimed: zero(),
      subTotal: zero(),
      difference: zero(),
      transition: zero(),
      total: zero(),
    };
    const t7: Gstr9Table7 = {
      rule37: zero(),
      rule39: zero(),
      rule42: zero(),
      rule43: zero(),
      section17_5: zero(),
      transition: zero(),
      other: zero(),
      total: zero(),
      net: zero(),
    };

    const filed = await prisma.filingApproval.findMany({
      where: {
        filingType: "GSTR3B",
        periodKey: { in: months },
        status: "SUBMITTED",
        businessPlaceId: scope.filingPlaceId === null ? null : Number(scope.filingPlaceId),
      },
      select: { periodKey: true, summary: true },
    });
    const filedByMonth = new Map(
      filed.map((f) => [f.periodKey, f.summary as Record<string, unknown>])
    );
    const unfiled: string[] = [];

    for (const ret of returns) {
      const t4 = ret.table4;
      // 6(B) is ordinary inward credit; the builder folds the rule 37 reclaim into the same
      // bucket for 4A(5), so it comes back out here and goes to 6(H) where the portal wants it.
      add(t6.inward, minus(t4.available.other, t4.other.reclaimed));
      add(t6.reclaimed, t4.other.reclaimed);
      add(t6.importGoods, t4.available.importGoods);
      add(t6.importServices, t4.available.importServices);
      add(t6.isd, t4.available.isd);
      add(t7.rule37, t4.reversed.others);
      add(t7.rule42, t4.reversed.rules);
      add(t7.section17_5, t4.other.ineligible);

      const summary = filedByMonth.get(ret.periodKey);
      const filedItc = summary?.netItc as Partial<TaxAmounts> | undefined;
      if (filedItc) {
        // What went to the portal, which is what 6(A) means.
        add(t6.availedIn3b, {
          igst: Number(filedItc.igst ?? 0),
          cgst: Number(filedItc.cgst ?? 0),
          sgst: Number(filedItc.sgst ?? 0),
          cess: Number(filedItc.cess ?? 0),
        });
      } else {
        unfiled.push(ret.periodKey);
        add(t6.availedIn3b, t4.net);
      }
    }

    // 6(C) and 6(D) split the reverse charge by whether the supplier is registered; the monthly
    // tables do not carry that split, so it comes from the ledger rows themselves.
    for (const month of months) {
      for (const row of await itcService.forPeriod(month)) {
        if (row.source !== "RCM" || row.periodKey !== month) continue;
        if (row.status === "VOID" || row.status === "INELIGIBLE") continue;
        add(row.supplierGstin ? t6.reverseChargeRegistered : t6.reverseChargeUnregistered, {
          taxable: n2(row.taxable),
          igst: n2(row.igst),
          cgst: n2(row.cgst),
          sgst: n2(row.sgst),
          cess: n2(row.cess),
        });
      }
    }

    if (unfiled.length) {
      warnings.push(
        `Table 6(A) uses the recomputed figures for ${unfiled.length} month(s) with no filed ` +
          `GSTR-3B (${unfiled.slice(0, 3).join(", ")}${unfiled.length > 3 ? ", …" : ""})`
      );
    }

    add(
      t6.subTotal,
      sum(
        t6.inward,
        t6.reverseChargeUnregistered,
        t6.reverseChargeRegistered,
        t6.importGoods,
        t6.importServices,
        t6.isd,
        t6.reclaimed
      )
    );
    // 6(J): what the documents justify, less what the monthly returns actually claimed.
    add(t6.difference, minus(minus(t6.subTotal, t7.total), t6.availedIn3b));
    add(t6.total, sum(t6.subTotal, t6.transition));
    add(
      t7.total,
      sum(t7.rule37, t7.rule39, t7.rule42, t7.rule43, t7.section17_5, t7.transition, t7.other)
    );
    add(t7.net, minus(t6.total, t7.total));
    // The difference is only meaningful once the reversals are known, so it is finished here.
    t6.difference = minus(minus(t6.subTotal, t7.total), t6.availedIn3b);
    return { table6: t6, table7: t7 };
  }

  /** Table 8: the year's 2B against the credit the books claimed. */
  private async portalCredit(from: Date, to: Date, scope: GstinScope): Promise<Gstr9Table8> {
    const records = await prisma.gstr2bRecord.findMany({
      where: { gstin: scope.gstin, docDate: { gte: from, lt: to }, itcAvailable: true },
    });
    const asPer2b = zero();
    const igstOnImports = zero();
    for (const r of records) {
      const amounts = {
        taxable: n2(r.taxable),
        igst: n2(r.igst),
        cgst: n2(r.cgst),
        sgst: n2(r.sgst),
        cess: n2(r.cess),
      };
      // A credit note reduces the credit the supplier filed, so it comes off the total.
      add(asPer2b, amounts, r.docType === "CRN" ? -1 : 1);
      if (r.docType === "IMPG") add(igstOnImports, amounts);
    }
    return {
      asPer2b,
      asPerBooks: zero(), // 8(B), 8(D) and the import rows are completed in `build`
      availedNextYear: zero(),
      difference: zero(),
      igstOnImports,
      igstCreditAvailed: zero(),
      importDifference: zero(),
    };
  }

  /** Table 9 from the twelve monthly 6.1 tables. */
  private taxPaid(returns: Gstr3bReturn[]): Gstr9Table9Row[] {
    const heads: Gstr9Table9Row["head"][] = ["IGST", "CGST", "SGST", "CESS"];
    const rows: Gstr9Table9Row[] = heads.map((head) => ({
      head,
      payable: 0,
      paidInCash: 0,
      paidThroughItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    }));
    for (const ret of returns) {
      for (const line of [...ret.table61.otherThanReverseCharge, ...ret.table61.reverseCharge]) {
        const row = rows.find((r) => r.head === line.head);
        if (!row) continue;
        row.payable = n2(row.payable + line.payable);
        row.paidInCash = n2(row.paidInCash + line.cash);
        row.paidThroughItc.igst = n2(row.paidThroughItc.igst + line.paidThroughItc.igst);
        row.paidThroughItc.cgst = n2(row.paidThroughItc.cgst + line.paidThroughItc.cgst);
        row.paidThroughItc.sgst = n2(row.paidThroughItc.sgst + line.paidThroughItc.sgst);
        row.paidThroughItc.cess = n2(row.paidThroughItc.cess + line.paidThroughItc.cess);
      }
    }
    // Interest and late fee are entered on the portal, not computed here; the rows exist so the
    // working paper has the same shape as the return.
    rows.push(
      {
        head: "INTEREST",
        payable: 0,
        paidInCash: 0,
        paidThroughItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      },
      {
        head: "LATE_FEE",
        payable: 0,
        paidInCash: 0,
        paidThroughItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      }
    );
    return rows;
  }

  /** The twelve monthly returns, built once each with the ledger already rebuilt. */
  private async monthly(months: string[], scope: GstinScope) {
    const returns = [];
    for (const month of months) {
      returns.push(await gstr3bService.build(month, scope.gstin, { skipItcRebuild: true }));
    }
    return {
      returns,
      rows: returns.map((r) => ({
        periodKey: r.periodKey,
        outputTax: sum(r.table31.a, r.table31.b),
        netItc: r.table4.net,
        cashPaid: r.table61.cashPayable.total,
      })),
    };
  }

  /** Table 18 from the year's purchase documents. */
  private async inwardHsn(from: Date, to: Date, scope: GstinScope): Promise<Gstr9HsnRow[]> {
    const grns = await prisma.grnInvoice.findMany({
      where: { ...placeFilter(scope), grnDate: { gte: from, lt: to }, cancelledAt: null },
      include: { items: true },
    });
    const hsn = hsnBucket();
    for (const g of grns) {
      for (const it of g.items) {
        hsn.add({
          hsn: it.hsnCode ?? "",
          rate: n2(Number(it.igstRate) || Number(it.cgstRate) + Number(it.sgstRate)),
          quantity: Number(it.quantity),
          uom: it.uom,
          taxable: n2(it.taxableAmount),
          igst: n2(it.igstAmount),
          cgst: n2(it.cgstAmount),
          sgst: n2(it.sgstAmount),
          cess: n2(it.cessAmount),
        });
      }
    }
    return hsn.rows();
  }

  async register(fyKey: string, gstin: string | null | undefined, actor: { userId?: string }) {
    const ret = await this.build(fyKey, gstin);
    const scope = await scopeFor(gstin);
    const row = await filingApprovalService.upsertDraft(
      {
        filingType: "GSTR9",
        periodKey: fyKey,
        businessPlaceId: scope.filingPlaceId === null ? null : Number(scope.filingPlaceId),
        payloadHash: ret.payloadHash,
        summary: {
          gstin: ret.gstin,
          turnover: ret.table5.turnoverForTheYear,
          taxPayable: ret.table4.total,
          itcAvailed: ret.table6.total,
          itcReversed: ret.table7.total,
          creditGap8D: ret.table8.difference,
          warnings: ret.warnings.length,
        },
        notes: ret.warnings.slice(0, 3).join("; ") || null,
      },
      actor
    );
    return { ...ret, filing: row };
  }

  async markFiled(
    fyKey: string,
    gstin: string | null | undefined,
    submissionRef: string | null,
    actor: { userId?: string }
  ) {
    const ret = await this.build(fyKey, gstin);
    const scope = await scopeFor(gstin);
    const gate = await filingApprovalService.assertSubmittable(
      "GSTR9",
      fyKey,
      ret.payloadHash,
      scope.filingPlaceId
    );
    const row = await filingApprovalService.markSubmitted(gate.id, submissionRef, actor);
    return { ...ret, filing: row };
  }
}

export const gstr9Service = new Gstr9Service();
