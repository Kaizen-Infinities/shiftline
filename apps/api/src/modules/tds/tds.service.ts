import type { DeducteeType, Prisma, TdsEventKind } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { periodService } from "../accounts/period.service";
import { TDS_SECTION_SEEDS, fyAndQuarter, isValidPan, panHolderType } from "./tds.sections";

/**
 * Tax deducted and collected at source (P1-15).
 *
 * Two things make this more than arithmetic. The first is the threshold: most sections only bite
 * once the year's payments to a payee cross a figure, and 194Q and 206C(1H) then apply only to
 * the part *above* it — deducting on the whole amount is the common error and it is the payee's
 * money. The second is the PAN: without one the rate is 20% under section 206AA, and a payee who
 * has not filed their returns is deducted at the higher rate under 206AB.
 *
 * A deduction is money withheld on someone else's behalf, so it is never deleted; it is
 * cancelled when the document behind it is.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

export interface DeductionInput {
  sectionCode: string;
  supplierId?: number | null;
  deducteeName?: string;
  deducteePan?: string | null;
  deducteeType?: DeducteeType;
  kind?: TdsEventKind;
  docType: string;
  docId: string;
  docNo: string;
  deductionDate: string | Date;
  /** The amount before tax that the rate applies to. */
  amount: number;
  /** Override the computed rate; the reason is recorded with it. */
  rateOverride?: number | null;
  rateReason?: string | null;
}

export interface RateDecision {
  rate: number;
  reason: string;
  /** What the rate applies to: the whole amount, or only the part above a threshold. */
  base: number;
  /** True when the threshold has not been crossed and nothing is deducted. */
  belowThreshold: boolean;
}

class TdsService {
  /** The tenant's sections, seeding the standard list the first time they are asked for. */
  async sections(includeInactive = false) {
    const existing = await prisma.tdsSection.findMany({ orderBy: { code: "asc" } });
    if (existing.length === 0) {
      await prisma.tdsSection.createMany({
        data: TDS_SECTION_SEEDS.map((s) => ({
          companyId: requireTenantId(),
          code: s.code,
          actCode: s.actCode,
          name: s.name,
          isTcs: s.isTcs ?? false,
          rateCompany: s.rateCompany,
          rateIndividual: s.rateIndividual,
          rateNoPan: s.rateNoPan ?? 20,
          thresholdSingle: s.thresholdSingle ?? 0,
          thresholdAnnual: s.thresholdAnnual ?? 0,
          ledgerCode: s.ledgerCode,
        })),
        skipDuplicates: true,
      });
      return prisma.tdsSection.findMany({ orderBy: { code: "asc" } });
    }
    return includeInactive ? existing : existing.filter((s) => s.isActive);
  }

  async upsertSection(input: {
    id?: string;
    code: string;
    actCode?: string | null;
    name: string;
    isTcs?: boolean;
    rateCompany: number;
    rateIndividual: number;
    rateNoPan?: number;
    thresholdSingle?: number;
    thresholdAnnual?: number;
    ledgerCode?: string | null;
    isActive?: boolean;
  }) {
    const code = input.code.trim().toUpperCase();
    const data = {
      actCode: input.actCode ?? null,
      name: input.name.trim().slice(0, 160),
      isTcs: input.isTcs ?? false,
      rateCompany: input.rateCompany,
      rateIndividual: input.rateIndividual,
      rateNoPan: input.rateNoPan ?? 20,
      thresholdSingle: input.thresholdSingle ?? 0,
      thresholdAnnual: input.thresholdAnnual ?? 0,
      ledgerCode: input.ledgerCode ?? null,
      isActive: input.isActive ?? true,
    };
    return prisma.tdsSection.upsert({
      where: { companyId_code: { companyId: requireTenantId(), code } },
      create: { code, ...data },
      update: data,
    });
  }

  /**
   * What rate applies, and to how much.
   *
   * The order matters. No PAN beats everything (206AA), then the non-filer rate (206AB), then
   * the payee's own type. The threshold is checked against what has already been paid to this
   * payee under this section in the same financial year, and for the sections that say so only
   * the excess is taxed.
   */
  async rateFor(input: {
    sectionCode: string;
    supplierId?: number | null;
    deducteePan?: string | null;
    deducteeType?: DeducteeType;
    higherRate?: boolean;
    amount: number;
    on: Date;
  }): Promise<RateDecision> {
    await this.sections();
    const section = await prisma.tdsSection.findUnique({
      where: {
        companyId_code: { companyId: requireTenantId(), code: input.sectionCode.toUpperCase() },
      },
    });
    if (!section) throw new ApiError(404, `Section ${input.sectionCode} is not in the master`);
    if (!section.isActive)
      throw new ApiError(409, `Section ${section.code} is retired`, "SECTION_RETIRED");

    const amount = n2(input.amount);
    const { fyCode } = fyAndQuarter(input.on);

    // What has already gone to this payee under this section this year.
    const prior = input.supplierId
      ? await prisma.tdsDeduction.aggregate({
          where: {
            sectionId: section.id,
            supplierId: input.supplierId,
            fyCode,
            cancelledAt: null,
          },
          _sum: { amountPaid: true },
        })
      : { _sum: { amountPaid: null } };
    const already = n2(Number(prior._sum.amountPaid ?? 0));
    const yearToDate = n2(already + amount);

    const single = n2(section.thresholdSingle);
    const annual = n2(section.thresholdAnnual);
    const crossesSingle = single > 0 && amount >= single;
    const crossesAnnual = annual > 0 && yearToDate > annual;
    const hasThreshold = single > 0 || annual > 0;
    if (hasThreshold && !crossesSingle && !crossesAnnual) {
      return {
        rate: 0,
        reason: `Below the section ${section.code} threshold (${already} paid so far this year)`,
        base: 0,
        belowThreshold: true,
      };
    }

    // 194Q and 206C(1H) tax only what is above the annual threshold, not the whole payment.
    const onlyExcess = section.code === "194Q" || section.code === "206C(1H)";
    const base =
      onlyExcess && annual > 0 ? n2(Math.max(0, Math.min(amount, yearToDate - annual))) : amount;

    if (!isValidPan(input.deducteePan)) {
      return {
        rate: n2(section.rateNoPan),
        reason: "No valid PAN on file: section 206AA",
        base,
        belowThreshold: false,
      };
    }
    if (input.higherRate) {
      // 206AB: twice the rate, or 5%, whichever is higher.
      const ordinary =
        input.deducteeType === "INDIVIDUAL_HUF"
          ? Number(section.rateIndividual)
          : Number(section.rateCompany);
      return {
        rate: n2(Math.max(ordinary * 2, 5)),
        reason: "Payee has not filed their returns: section 206AB",
        base,
        belowThreshold: false,
      };
    }
    const individual = input.deducteeType === "INDIVIDUAL_HUF";
    return {
      rate: n2(individual ? section.rateIndividual : section.rateCompany),
      reason: `Section ${section.code}, ${individual ? "individual or HUF" : "company or firm"} rate`,
      base,
      belowThreshold: false,
    };
  }

  /** Records a deduction against a document. One per document per section. */
  async deduct(input: DeductionInput, actor: { userId?: string }) {
    const on = new Date(input.deductionDate);
    if (Number.isNaN(on.getTime())) throw new ApiError(400, "Invalid deduction date");
    await periodService.assertPostingAllowed(on);

    const supplier = input.supplierId
      ? await prisma.supplier.findUnique({ where: { id: input.supplierId } })
      : null;
    if (input.supplierId && !supplier) throw new ApiError(404, "That supplier does not exist");

    const pan = (input.deducteePan ?? supplier?.pan ?? null)?.trim().toUpperCase() ?? null;
    const deducteeType =
      input.deducteeType ??
      supplier?.deducteeType ??
      (pan ? (panHolderType(pan) as DeducteeType | null) : null) ??
      "COMPANY";
    const higherRate = supplier?.higherRate206AB ?? false;

    const decision =
      input.rateOverride != null
        ? {
            rate: n2(input.rateOverride),
            reason: input.rateReason ?? "Rate set by hand",
            base: n2(input.amount),
            belowThreshold: false,
          }
        : await this.rateFor({
            sectionCode: input.sectionCode,
            supplierId: input.supplierId,
            deducteePan: pan,
            deducteeType,
            higherRate,
            amount: input.amount,
            on,
          });

    const section = await prisma.tdsSection.findUniqueOrThrow({
      where: {
        companyId_code: { companyId: requireTenantId(), code: input.sectionCode.toUpperCase() },
      },
    });
    const { fyCode, quarter } = fyAndQuarter(on);
    const tdsAmount = n2((decision.base * decision.rate) / 100);

    const existing = await prisma.tdsDeduction.findUnique({
      where: {
        companyId_docType_docId_sectionId: {
          companyId: requireTenantId(),
          docType: input.docType,
          docId: input.docId,
          sectionId: section.id,
        },
      },
    });
    if (existing && existing.status !== "PENDING") {
      throw new ApiError(
        409,
        "That deduction is already on a challan or in a filed return",
        "DEDUCTION_LOCKED"
      );
    }

    const data = {
      sectionId: section.id,
      supplierId: input.supplierId ?? null,
      deducteeName: (input.deducteeName ?? supplier?.legalName ?? "Unknown").slice(0, 160),
      deducteePan: pan,
      deducteeType,
      higherRate,
      kind: input.kind ?? "ON_BILL",
      docType: input.docType,
      docId: input.docId,
      docNo: input.docNo.slice(0, 40),
      deductionDate: on,
      amountPaid: n2(input.amount),
      // What the rate was applied to, which is not always the whole payment.
      taxableAmount: decision.base,
      rate: decision.rate,
      tdsAmount,
      fyCode,
      quarter,
      rateReason: decision.reason.slice(0, 160),
      createdBy: actor.userId ?? null,
    };
    const row = existing
      ? await prisma.tdsDeduction.update({ where: { id: existing.id }, data })
      : await prisma.tdsDeduction.create({ data });
    return { ...row, decision };
  }

  async list(params: {
    fyCode?: string;
    quarter?: string;
    status?: string;
    sectionCode?: string;
    supplierId?: number;
    unchallanedOnly?: boolean;
  }) {
    return prisma.tdsDeduction.findMany({
      where: {
        ...(params.fyCode ? { fyCode: params.fyCode } : {}),
        ...(params.quarter ? { quarter: params.quarter } : {}),
        ...(params.status ? { status: params.status as "PENDING" } : {}),
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.sectionCode ? { section: { code: params.sectionCode.toUpperCase() } } : {}),
        ...(params.unchallanedOnly ? { challanId: null, cancelledAt: null } : {}),
      },
      include: { section: true, challan: true },
      orderBy: [{ deductionDate: "desc" }, { docNo: "asc" }],
      take: 1000,
    });
  }

  /**
   * Records a challan and attaches the deductions it pays for. The challan has to equal what it
   * covers — a return where the two disagree is rejected by the utility, and finding out then
   * means a correction statement.
   */
  async payChallan(
    input: {
      bsrCode: string;
      challanSerial: string;
      challanDate: string | Date;
      periodKey: string;
      deductionIds: string[];
      surcharge?: number;
      educationCess?: number;
      interest?: number;
      lateFee?: number;
      paymentCode?: string;
      remarks?: string | null;
    },
    actor: { userId?: string }
  ) {
    if (!/^\d{7}$/.test(input.bsrCode)) {
      throw new ApiError(400, "A BSR code is seven digits", "BAD_BSR");
    }
    if (!input.deductionIds?.length) {
      throw new ApiError(400, "A challan has to pay for something", "NO_DEDUCTIONS");
    }
    const date = new Date(input.challanDate);
    const deductions = await prisma.tdsDeduction.findMany({
      where: { id: { in: input.deductionIds }, cancelledAt: null },
      include: { section: true },
    });
    if (deductions.length !== input.deductionIds.length) {
      throw new ApiError(404, "Some of those deductions do not exist or were cancelled");
    }
    const alreadyPaid = deductions.find((d) => d.challanId);
    if (alreadyPaid) {
      throw new ApiError(409, `${alreadyPaid.docNo} is already on a challan`, "ALREADY_CHALLANED");
    }
    // A challan is either a deduction challan or a collection one; the forms differ.
    const kinds = new Set(deductions.map((d) => d.section.isTcs));
    if (kinds.size > 1) {
      throw new ApiError(
        400,
        "A challan cannot mix deductions with collections at source",
        "MIXED_CHALLAN"
      );
    }
    const quarters = new Set(deductions.map((d) => `${d.fyCode}|${d.quarter}`));
    if (quarters.size > 1) {
      throw new ApiError(
        400,
        "A challan cannot span two quarters; the return is filed per quarter",
        "MIXED_QUARTER"
      );
    }

    const tdsAmount = n2(deductions.reduce((s, d) => s + Number(d.tdsAmount), 0));
    const totalAmount = n2(
      tdsAmount +
        (input.surcharge ?? 0) +
        (input.educationCess ?? 0) +
        (input.interest ?? 0) +
        (input.lateFee ?? 0)
    );
    const [fyCode, quarter] = [...quarters][0].split("|");

    return prisma.$transaction(async (tx) => {
      const challan = await tx.tdsChallan.create({
        data: {
          bsrCode: input.bsrCode,
          challanSerial: input.challanSerial.trim().slice(0, 10),
          challanDate: date,
          periodKey: input.periodKey,
          fyCode,
          quarter,
          tdsAmount,
          surcharge: input.surcharge ?? 0,
          educationCess: input.educationCess ?? 0,
          interest: input.interest ?? 0,
          lateFee: input.lateFee ?? 0,
          totalAmount,
          paymentCode: input.paymentCode ?? "200",
          isTcs: [...kinds][0],
          remarks: input.remarks ?? null,
          createdBy: actor.userId ?? null,
        },
      });
      await tx.tdsDeduction.updateMany({
        where: { id: { in: input.deductionIds } },
        data: { challanId: challan.id, status: "CHALLAN_PAID" },
      });
      logger.info(
        { challanId: challan.id, tdsAmount, count: deductions.length },
        "TDS challan recorded"
      );
      return tx.tdsChallan.findUniqueOrThrow({
        where: { id: challan.id },
        include: { deductions: { include: { section: true } } },
      });
    });
  }

  async challans(params: { fyCode?: string; quarter?: string } = {}) {
    return prisma.tdsChallan.findMany({
      where: {
        ...(params.fyCode ? { fyCode: params.fyCode } : {}),
        ...(params.quarter ? { quarter: params.quarter } : {}),
      },
      include: { deductions: { include: { section: true } } },
      orderBy: { challanDate: "desc" },
      take: 500,
    });
  }

  /** Cancels a deduction when the document behind it goes. Never deletes: a return may cite it. */
  async cancel(id: string, reason: string, actor: { userId?: string }) {
    const row = await prisma.tdsDeduction.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "That deduction does not exist");
    if (row.status === "RETURN_FILED") {
      throw new ApiError(
        409,
        "That deduction is in a filed return; correct it through a revised return",
        "RETURN_FILED"
      );
    }
    if (!reason?.trim())
      throw new ApiError(400, "A cancellation needs a reason", "REASON_REQUIRED");
    return prisma.tdsDeduction.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        cancelReason: reason.trim().slice(0, 255),
        status: "CANCELLED",
        challanId: null,
      },
    });
  }

  /**
   * What a payee has had deducted in a quarter, which is what Form 16A certifies. The
   * certificate is only honest once the challan is paid, so an unchallaned deduction is
   * reported as such rather than quietly included.
   */
  async form16A(supplierId: number, fyCode: string, quarter?: string) {
    const rows = await prisma.tdsDeduction.findMany({
      where: { supplierId, fyCode, ...(quarter ? { quarter } : {}), cancelledAt: null },
      include: { section: true, challan: true },
      orderBy: { deductionDate: "asc" },
    });
    if (rows.length === 0) throw new ApiError(404, "Nothing was deducted for that payee");
    const company = await prisma.company.findFirstOrThrow({ where: { id: requireTenantId() } });
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    const certified = rows.filter((r) => r.challanId);
    return {
      deductor: {
        name: company.legalName ?? company.companyName,
        tan: company.tan,
        pan: company.pan,
      },
      deductee: { name: supplier.legalName, pan: supplier.pan },
      fyCode,
      quarter: quarter ?? "ALL",
      lines: rows.map((r) => ({
        section: r.section.code,
        docNo: r.docNo,
        date: r.deductionDate.toISOString().slice(0, 10),
        amountPaid: n2(r.amountPaid),
        taxedOn: n2(r.taxableAmount),
        rate: n2(r.rate),
        tdsAmount: n2(r.tdsAmount),
        challan: r.challan
          ? {
              bsrCode: r.challan.bsrCode,
              serial: r.challan.challanSerial,
              date: r.challan.challanDate.toISOString().slice(0, 10),
            }
          : null,
      })),
      totals: {
        amountPaid: n2(rows.reduce((s, r) => s + Number(r.amountPaid), 0)),
        tdsDeducted: n2(rows.reduce((s, r) => s + Number(r.tdsAmount), 0)),
        tdsDeposited: n2(certified.reduce((s, r) => s + Number(r.tdsAmount), 0)),
      },
      /** A certificate cannot honestly cover tax that has not reached the government yet. */
      unchallaned: rows.length - certified.length,
    };
  }
}

export const tdsService = new TdsService();
export type TdsDb = Prisma.TransactionClient | typeof prisma;
