import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { filingApprovalService } from "../filings/filing-approval.service";
import { createHash } from "node:crypto";
import { requireTenantId } from "../../lib/tenant-context";

/**
 * Quarterly TDS returns (P1-15).
 *
 * The e-TDS utility reads a pipe-delimited text file of numbered line types, not a
 * spreadsheet: one FH (file header), one BH (batch) per form, a CD (challan) per challan and a
 * DD (deductee) per deduction under it. The numbering is positional and the utility rejects the
 * whole file on one bad row, so the shape below is deliberate rather than pretty.
 *
 * 26Q is for resident payees and 27Q for non-resident ones; the difference is which deductions
 * go in, so one builder serves both.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const ddmmyyyy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}`;

export type TdsFormType = "26Q" | "27Q";

export interface TdsReturnLine {
  section: string;
  deducteeName: string;
  deducteePan: string | null;
  deducteeType: string;
  docNo: string;
  deductionDate: string;
  /** What the payee was paid, which the return reports. */
  amountPaid: number;
  /** What the rate actually hit; the same as `amountPaid` except under 194Q and 206C(1H). */
  taxedOn: number;
  rate: number;
  tdsAmount: number;
  higherRate: boolean;
  /** Empty when the deduction has not reached a challan yet, which the utility will refuse. */
  challan: { bsrCode: string; serial: string; date: string } | null;
}

export interface TdsReturn {
  formType: TdsFormType;
  fyCode: string;
  quarter: string;
  deductor: { name: string; tan: string | null; pan: string | null };
  challans: {
    bsrCode: string;
    serial: string;
    date: string;
    tdsAmount: number;
    interest: number;
    lateFee: number;
    total: number;
    deductees: number;
  }[];
  lines: TdsReturnLine[];
  totals: { deductees: number; amountPaid: number; tdsDeducted: number; challanTotal: number };
  warnings: string[];
  payloadHash: string;
  filing: unknown;
}

/** The quarter's deductions for a form, with everything the utility asks for. */
export const buildTdsReturn = async (
  formType: TdsFormType,
  fyCode: string,
  quarter: string
): Promise<TdsReturn> => {
  if (!/^Q[1-4]$/.test(quarter)) throw new ApiError(400, "A quarter is Q1 to Q4");
  const company = await prisma.company.findFirstOrThrow({ where: { id: requireTenantId() } });
  const warnings: string[] = [];
  if (!company.tan) warnings.push("The company has no TAN; the utility will refuse the file");

  const rows = await prisma.tdsDeduction.findMany({
    where: {
      fyCode,
      quarter,
      cancelledAt: null,
      section: { isTcs: false },
      // 27Q is the non-resident form; everyone else goes in 26Q.
      deducteeType: formType === "27Q" ? "NON_RESIDENT" : { not: "NON_RESIDENT" },
    },
    include: { section: true, challan: true },
    orderBy: [{ challanId: "asc" }, { deductionDate: "asc" }],
  });

  const lines: TdsReturnLine[] = rows.map((r) => ({
    section: r.section.code,
    deducteeName: r.deducteeName,
    deducteePan: r.deducteePan,
    deducteeType: r.deducteeType,
    docNo: r.docNo,
    deductionDate: r.deductionDate.toISOString().slice(0, 10),
    amountPaid: n2(r.amountPaid),
    taxedOn: n2(r.taxableAmount),
    rate: n2(r.rate),
    tdsAmount: n2(r.tdsAmount),
    higherRate: r.higherRate,
    challan: r.challan
      ? {
          bsrCode: r.challan.bsrCode,
          serial: r.challan.challanSerial,
          date: r.challan.challanDate.toISOString().slice(0, 10),
        }
      : null,
  }));

  const unchallaned = lines.filter((l) => !l.challan).length;
  if (unchallaned > 0) {
    warnings.push(
      `${unchallaned} deduction(s) are not on a challan; the utility rejects a file where they are not`
    );
  }
  const noPan = lines.filter((l) => !l.deducteePan).length;
  if (noPan > 0) warnings.push(`${noPan} deductee(s) have no PAN`);

  const byChallan = new Map<string, TdsReturn["challans"][number]>();
  for (const r of rows) {
    if (!r.challan) continue;
    const key = r.challan.id;
    const cur = byChallan.get(key) ?? {
      bsrCode: r.challan.bsrCode,
      serial: r.challan.challanSerial,
      date: r.challan.challanDate.toISOString().slice(0, 10),
      tdsAmount: n2(r.challan.tdsAmount),
      interest: n2(r.challan.interest),
      lateFee: n2(r.challan.lateFee),
      total: n2(r.challan.totalAmount),
      deductees: 0,
    };
    cur.deductees++;
    byChallan.set(key, cur);
  }

  const totals = {
    deductees: lines.length,
    amountPaid: n2(lines.reduce((s, l) => s + l.amountPaid, 0)),
    tdsDeducted: n2(lines.reduce((s, l) => s + l.tdsAmount, 0)),
    challanTotal: n2([...byChallan.values()].reduce((s, c) => s + c.tdsAmount, 0)),
  };
  // The utility reconciles these two and refuses the file when they differ.
  if (unchallaned === 0 && totals.tdsDeducted !== totals.challanTotal) {
    warnings.push(
      `The challans total ${totals.challanTotal} but the deductions come to ${totals.tdsDeducted}`
    );
  }

  const payload = { formType, fyCode, quarter, lines, challans: [...byChallan.values()] };
  return {
    formType,
    fyCode,
    quarter,
    deductor: {
      name: company.legalName ?? company.companyName,
      tan: company.tan,
      pan: company.pan,
    },
    challans: [...byChallan.values()],
    lines,
    totals,
    warnings,
    payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    filing: null,
  };
};

/**
 * The file the e-TDS utility imports: `^`-delimited, one record per line, numbered in order.
 * Line 1 is the file header, line 2 the batch, then a challan record followed by its deductee
 * records, and a file trailer.
 */
export const toEtdsText = (ret: TdsReturn): string => {
  const out: string[] = [];
  let lineNo = 0;
  const push = (fields: (string | number | null)[]) => {
    lineNo++;
    out.push([lineNo, ...fields].map((f) => (f === null ? "" : String(f))).join("^"));
  };

  push(["FH", "NSDL", "R", ret.formType, ret.deductor.tan ?? "", ret.fyCode, ret.quarter]);
  push([
    "BH",
    "1",
    ret.formType,
    ret.deductor.tan ?? "",
    ret.deductor.pan ?? "",
    ret.deductor.name,
    ret.challans.length,
    n2(ret.totals.tdsDeducted),
  ]);

  let challanNo = 0;
  for (const challan of ret.challans) {
    challanNo++;
    push([
      "CD",
      challanNo,
      challan.bsrCode,
      ddmmyyyy(new Date(challan.date)),
      challan.serial,
      n2(challan.tdsAmount),
      n2(challan.interest),
      n2(challan.lateFee),
      n2(challan.total),
      challan.deductees,
    ]);
    let deducteeNo = 0;
    for (const line of ret.lines.filter(
      (l) => l.challan?.bsrCode === challan.bsrCode && l.challan?.serial === challan.serial
    )) {
      deducteeNo++;
      push([
        "DD",
        challanNo,
        deducteeNo,
        line.deducteePan ?? "PANNOTAVBL",
        line.deducteeName,
        line.deducteeType,
        ddmmyyyy(new Date(line.deductionDate)),
        n2(line.amountPaid),
        n2(line.tdsAmount),
        n2(line.rate),
        line.section,
        // The utility asks for the reason code when tax came off at a higher rate.
        line.higherRate ? "C" : "",
      ]);
    }
  }
  push(["FT", lineNo + 1, ret.totals.deductees, n2(ret.totals.tdsDeducted)]);
  return out.join("\n");
};

/** Registers the quarter on the filing gate, and files it once approved. */
export const tdsFiling = {
  async register(
    formType: TdsFormType,
    fyCode: string,
    quarter: string,
    actor: { userId?: string }
  ) {
    const ret = await buildTdsReturn(formType, fyCode, quarter);
    const row = await filingApprovalService.upsertDraft(
      {
        filingType: formType === "26Q" ? "TDS_26Q" : "TDS_27Q",
        // The gate keys quarterly filings as `2026-Q2`.
        periodKey: `${fyCode.slice(0, 4)}-${quarter}`,
        businessPlaceId: null,
        payloadHash: ret.payloadHash,
        summary: {
          formType,
          fyCode,
          quarter,
          deductees: ret.totals.deductees,
          tdsDeducted: ret.totals.tdsDeducted,
          challans: ret.challans.length,
          warnings: ret.warnings.length,
        },
        notes: ret.warnings.slice(0, 3).join("; ") || null,
      },
      actor
    );
    return { ...ret, filing: row };
  },

  async markFiled(
    formType: TdsFormType,
    fyCode: string,
    quarter: string,
    submissionRef: string | null,
    actor: { userId?: string }
  ) {
    const ret = await buildTdsReturn(formType, fyCode, quarter);
    const gate = await filingApprovalService.assertSubmittable(
      formType === "26Q" ? "TDS_26Q" : "TDS_27Q",
      `${fyCode.slice(0, 4)}-${quarter}`,
      ret.payloadHash,
      null
    );
    const row = await filingApprovalService.markSubmitted(gate.id, submissionRef, actor);
    // Once a return is filed its deductions cannot be quietly changed.
    await prisma.tdsDeduction.updateMany({
      where: { fyCode, quarter, cancelledAt: null, status: "CHALLAN_PAID" },
      data: { status: "RETURN_FILED" },
    });
    return { ...ret, filing: row };
  },
};
