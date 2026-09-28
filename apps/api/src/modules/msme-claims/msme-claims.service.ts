import { Prisma } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../lib/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { documentNumberService } from "../documents/document-number.service";
import {
  DEFAULT_BANK_RATE,
  allowedNext,
  asDate,
  canTransition,
  computeClaim,
  daysBetween,
  interestRateFor,
  iso,
  round2,
  tredsFlag,
  type ClaimResult,
  type ClaimStatus,
  type TredsFlag,
} from "./msme-claim.calc";
import type {
  createBody,
  eligibleQuery,
  listQuery,
  settingsBody,
  statusBody,
} from "./msme-claims.validation";

/**
 * MSME delayed-payment claims, receivable side (TN-05). Outstanding per invoice is read the way
 * the receivable ageing reads it (grand total less the receipts recorded on the invoice), but
 * with each receipt's date, because section 16 interest depends on when each part was paid.
 * Every query goes through the tenant-scoped client, so a foreign company's rows are invisible.
 */
type Actor = { userId?: string };

export const BANK_RATE_VERIFY_NOTE =
  "Default RBI bank rate of 6.75% (verify against the latest RBI notification before filing).";

const OPEN_INVOICE_STATUSES = { notIn: ["DRAFT", "CANCELLED"] };

interface ReceiptLike {
  amount?: unknown;
  paymentDate?: unknown;
}

/** Receipts recorded on the invoice (the JSON the ageing report sums), with their dates. */
const receiptsOf = (raw: unknown): { date: string; amount: number }[] => {
  if (!Array.isArray(raw)) return [];
  const out: { date: string; amount: number }[] = [];
  for (const p of raw as ReceiptLike[]) {
    if (!p || typeof p !== "object") continue;
    const amount = Number(p.amount);
    const date = typeof p.paymentDate === "string" ? p.paymentDate.slice(0, 10) : null;
    if (!Number.isFinite(amount) || amount <= 0 || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue;
    }
    out.push({ date, amount });
  }
  return out;
};

const invoiceSelect = {
  id: true,
  customerId: true,
  invoiceNo: true,
  invoiceDate: true,
  dueDate: true,
  grandTotal: true,
  payments: true,
  status: true,
  customer: {
    select: { id: true, firmName: true, customerCode: true, creditDays: true, gstin: true },
  },
} satisfies Prisma.SalesInvoiceSelect;
type InvoiceRow = Prisma.SalesInvoiceGetPayload<{ select: typeof invoiceSelect }>;

/**
 * The agreed term: the invoice's own due date where it has one, else the buyer's credit days;
 * neither means nothing was agreed and section 15's 15 days apply.
 */
const agreedDaysOf = (inv: InvoiceRow): number | null =>
  inv.dueDate
    ? Math.max(daysBetween(inv.invoiceDate, inv.dueDate), 0)
    : (inv.customer?.creditDays ?? null);

const claimOf = (inv: InvoiceRow, bankRate: number, asOf: Date): ClaimResult =>
  computeClaim({
    amount: Number(inv.grandTotal),
    invoiceDate: inv.invoiceDate,
    agreedDays: agreedDaysOf(inv),
    payments: receiptsOf(inv.payments),
    bankRate,
    asOf,
  });

export interface EligibleInvoice {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  customerId: string;
  customerName: string;
  amount: number;
  paid: number;
  principalOutstanding: number;
  limitDays: number;
  dueDate: string;
  daysLate: number;
  interest: number;
  treds: { flag: TredsFlag; reason: string };
  /** The open claim this invoice already sits on, if any. */
  claim: { id: string; claimNo: string; status: ClaimStatus } | null;
}

const d2 = (n: number) => new Prisma.Decimal(round2(n).toFixed(2));

const claimInclude = {
  customer: { select: { id: true, firmName: true, customerCode: true, gstin: true } },
  lines: { orderBy: [{ invoiceDate: "asc" }, { invoiceNo: "asc" }] },
} satisfies Prisma.MsmeRecoveryClaimInclude;
type ClaimRow = Prisma.MsmeRecoveryClaimGetPayload<{ include: typeof claimInclude }>;

const dateOrNull = (d: Date | null) => (d ? iso(d) : null);

const claimDto = (c: ClaimRow) => ({
  id: c.id,
  claimNo: c.claimNo,
  customerId: c.customerId,
  customerName: c.customer?.firmName ?? null,
  customerGstin: c.customer?.gstin ?? null,
  status: c.status as ClaimStatus,
  nextStatuses: allowedNext(c.status as ClaimStatus),
  forum: c.forum,
  asOfDate: iso(c.asOfDate),
  bankRate: Number(c.bankRate),
  annualRate: Number(c.annualRate),
  principalTotal: Number(c.principalTotal),
  interestTotal: Number(c.interestTotal),
  claimTotal: round2(Number(c.principalTotal) + Number(c.interestTotal)),
  filedOn: dateOrNull(c.filedOn),
  referenceNo: c.referenceNo,
  hearingOn: dateOrNull(c.hearingOn),
  settledOn: dateOrNull(c.settledOn),
  settledAmount: c.settledAmount === null ? null : Number(c.settledAmount),
  notes: c.notes,
  invoiceCount: c.lines.length,
  createdAt: c.createdAt.toISOString(),
  lines: c.lines.map((l) => ({
    id: l.id,
    salesInvoiceId: l.salesInvoiceId,
    invoiceNo: l.invoiceNo,
    invoiceDate: iso(l.invoiceDate),
    acceptedOn: iso(l.acceptedOn),
    invoiceAmount: Number(l.invoiceAmount),
    paidAmount: Number(l.paidAmount),
    principalOutstanding: Number(l.principalOutstanding),
    limitDays: l.limitDays,
    dueDate: iso(l.dueDate),
    daysLate: l.daysLate,
    interest: Number(l.interest),
  })),
});
export type ClaimDto = ReturnType<typeof claimDto>;

const lineData = (inv: InvoiceRow, r: ClaimResult) => ({
  invoiceNo: inv.invoiceNo.slice(0, 40),
  invoiceDate: inv.invoiceDate,
  acceptedOn: asDate(r.acceptedOn),
  invoiceAmount: d2(r.amount),
  paidAmount: d2(r.paid),
  principalOutstanding: d2(r.principalOutstanding),
  limitDays: r.limitDays,
  dueDate: asDate(r.dueDate),
  daysLate: r.daysLate,
  interest: d2(r.interest),
});

const today = () => asDate(new Date());

class MsmeClaimsService {
  // ── Settings ──────────────────────────────────────────────────────────────

  async settings() {
    const s = await prisma.msmeClaimSetting.findFirst();
    const bankRate = s ? Number(s.bankRate) : DEFAULT_BANK_RATE;
    return {
      bankRate,
      annualRate: interestRateFor(bankRate),
      bankRateNote: s?.bankRateNote ?? null,
      udyamNumber: s?.udyamNumber ?? null,
      enterpriseCategory: s?.enterpriseCategory ?? null,
      isDefault: !s,
      verifyNote: BANK_RATE_VERIFY_NOTE,
      updatedAt: s ? s.updatedAt.toISOString() : null,
    };
  }

  async updateSettings(body: z.infer<typeof settingsBody>, actor: Actor) {
    const existing = await prisma.msmeClaimSetting.findFirst({ select: { id: true } });
    const data = {
      bankRate: new Prisma.Decimal(body.bankRate.toFixed(2)),
      ...(body.bankRateNote !== undefined ? { bankRateNote: body.bankRateNote || null } : {}),
      ...(body.udyamNumber !== undefined ? { udyamNumber: body.udyamNumber } : {}),
      ...(body.enterpriseCategory !== undefined
        ? { enterpriseCategory: body.enterpriseCategory }
        : {}),
      updatedBy: actor.userId ?? null,
    };
    if (existing) {
      await prisma.msmeClaimSetting.update({ where: { id: existing.id }, data });
    } else {
      await prisma.msmeClaimSetting.create({ data: { companyId: requireTenantId(), ...data } });
    }
    return this.settings();
  }

  private async bankRate(): Promise<number> {
    const s = await prisma.msmeClaimSetting.findFirst({ select: { bankRate: true } });
    return s ? Number(s.bankRate) : DEFAULT_BANK_RATE;
  }

  // ── Eligibility ───────────────────────────────────────────────────────────

  /** Invoices on open (not withdrawn) claims, so the same invoice is never claimed twice. */
  private async openClaimsByInvoice(invoiceIds: string[]) {
    if (!invoiceIds.length) return new Map<string, EligibleInvoice["claim"]>();
    const lines = await prisma.msmeRecoveryClaimLine.findMany({
      where: { salesInvoiceId: { in: invoiceIds }, claim: { status: { not: "WITHDRAWN" } } },
      select: {
        salesInvoiceId: true,
        claim: { select: { id: true, claimNo: true, status: true } },
      },
    });
    return new Map(
      lines.map((l) => [
        l.salesInvoiceId,
        { id: l.claim.id, claimNo: l.claim.claimNo, status: l.claim.status as ClaimStatus },
      ])
    );
  }

  /**
   * Unpaid or part-paid sales invoices past their section 15 date, with interest to `asOf`.
   * Bills of supply and export invoices count too: the Act is about goods and services supplied,
   * not about the tax on them.
   */
  async eligible(q: z.infer<typeof eligibleQuery>) {
    const asOf = q.asOf ? asDate(q.asOf) : today();
    if (q.customerId) {
      const c = await prisma.customer.findFirst({
        where: { id: q.customerId },
        select: { id: true },
      });
      if (!c) throw new ApiError(404, "That buyer does not exist");
    }
    const bankRate = await this.bankRate();
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        cancelledAt: null,
        status: OPEN_INVOICE_STATUSES,
        invoiceDate: { lte: asOf },
        ...(q.customerId ? { customerId: q.customerId } : {}),
      },
      select: invoiceSelect,
      orderBy: [{ invoiceDate: "asc" }, { invoiceNo: "asc" }],
      take: 5000,
    });
    const rows: EligibleInvoice[] = [];
    for (const inv of invoices) {
      const r = claimOf(inv, bankRate, asOf);
      if (r.principalOutstanding <= 0.005 || r.daysLate <= 0) continue;
      rows.push({
        invoiceId: inv.id,
        invoiceNo: inv.invoiceNo,
        invoiceDate: iso(inv.invoiceDate),
        customerId: inv.customerId,
        customerName: inv.customer?.firmName ?? "",
        amount: r.amount,
        paid: r.paid,
        principalOutstanding: r.principalOutstanding,
        limitDays: r.limitDays,
        dueDate: r.dueDate,
        daysLate: r.daysLate,
        interest: r.interest,
        // An issued, uncancelled invoice is treated as accepted; there is no dispute flag yet.
        treds: tredsFlag({
          invoiceDate: inv.invoiceDate,
          asOf,
          accepted: true,
          principalOutstanding: r.principalOutstanding,
        }),
        claim: null,
      });
    }
    const onClaim = await this.openClaimsByInvoice(rows.map((r) => r.invoiceId));
    for (const r of rows) r.claim = onClaim.get(r.invoiceId) ?? null;

    const buyers = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        invoices: number;
        principal: number;
        interest: number;
      }
    >();
    for (const r of rows) {
      const b = buyers.get(r.customerId) ?? {
        customerId: r.customerId,
        customerName: r.customerName,
        invoices: 0,
        principal: 0,
        interest: 0,
      };
      b.invoices += 1;
      b.principal = round2(b.principal + r.principalOutstanding);
      b.interest = round2(b.interest + r.interest);
      buyers.set(r.customerId, b);
    }
    return {
      asOf: iso(asOf),
      bankRate,
      annualRate: interestRateFor(bankRate),
      rows: rows.sort((a, b) => b.daysLate - a.daysLate || a.invoiceNo.localeCompare(b.invoiceNo)),
      buyers: [...buyers.values()].sort((a, b) => b.interest - a.interest),
      totals: {
        invoices: rows.length,
        principal: round2(rows.reduce((s, r) => s + r.principalOutstanding, 0)),
        interest: round2(rows.reduce((s, r) => s + r.interest, 0)),
        tredsCheck: rows.filter((r) => r.treds.flag === "CHECK").length,
      },
    };
  }

  // ── Claims ────────────────────────────────────────────────────────────────

  private async load(id: string): Promise<ClaimRow> {
    const c = await prisma.msmeRecoveryClaim.findFirst({ where: { id }, include: claimInclude });
    if (!c) throw new ApiError(404, "That claim does not exist");
    return c;
  }

  async list(q: z.infer<typeof listQuery>) {
    const rows = await prisma.msmeRecoveryClaim.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
      },
      include: claimInclude,
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });
    return rows.map((c) => {
      const { lines: _lines, ...rest } = claimDto(c);
      return rest;
    });
  }

  async get(id: string) {
    return claimDto(await this.load(id));
  }

  /**
   * A claim from chosen invoices of one buyer. Nothing the client computed is trusted: every
   * line's due date, principal and interest are worked out here from the invoice and its receipts.
   */
  async create(body: z.infer<typeof createBody>, actor: Actor) {
    const asOf = body.asOf ? asDate(body.asOf) : today();
    if (asOf.getTime() > today().getTime()) {
      throw new ApiError(400, "Interest cannot be claimed up to a future date");
    }
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId },
      select: { id: true },
    });
    if (!customer) throw new ApiError(404, "That buyer does not exist");

    const invoices = await prisma.salesInvoice.findMany({
      where: { id: { in: body.invoiceIds } },
      select: { ...invoiceSelect, cancelledAt: true },
    });
    const byId = new Map(invoices.map((i) => [i.id, i]));
    const bankRate = await this.bankRate();
    const computed: { inv: InvoiceRow; r: ClaimResult }[] = [];
    for (const id of body.invoiceIds) {
      const inv = byId.get(id);
      if (!inv) throw new ApiError(404, "One of the invoices does not exist");
      if (inv.customerId !== body.customerId) {
        throw new ApiError(400, `Invoice ${inv.invoiceNo} is not this buyer's`);
      }
      if (inv.cancelledAt || inv.status === "CANCELLED" || inv.status === "DRAFT") {
        throw new ApiError(400, `Invoice ${inv.invoiceNo} is not an issued invoice`);
      }
      if (inv.invoiceDate.getTime() > asOf.getTime()) {
        throw new ApiError(400, `Invoice ${inv.invoiceNo} is dated after the claim date`);
      }
      const r = claimOf(inv, bankRate, asOf);
      if (r.principalOutstanding <= 0.005) {
        throw new ApiError(400, `Invoice ${inv.invoiceNo} has been paid in full`);
      }
      if (r.daysLate <= 0) {
        throw new ApiError(400, `Invoice ${inv.invoiceNo} is not yet past its section 15 date`);
      }
      computed.push({ inv, r });
    }
    const onClaim = await this.openClaimsByInvoice(body.invoiceIds);
    const clash = body.invoiceIds.find((id) => onClaim.has(id));
    if (clash) {
      throw new ApiError(
        409,
        `Invoice ${byId.get(clash)?.invoiceNo} is already on claim ${onClaim.get(clash)?.claimNo}`
      );
    }
    if (body.claimNo) {
      const dup = await prisma.msmeRecoveryClaim.findFirst({
        where: { claimNo: body.claimNo },
        select: { id: true },
      });
      if (dup) throw new ApiError(409, "A claim with that number already exists");
    }

    const principalTotal = round2(computed.reduce((s, c) => s + c.r.principalOutstanding, 0));
    const interestTotal = round2(computed.reduce((s, c) => s + c.r.interest, 0));
    const created = await prisma.$transaction(async (tx) => {
      const claimNo =
        body.claimNo ?? (await documentNumberService.next("MSME_CLAIM", { date: asOf, tx }));
      const claim = await tx.msmeRecoveryClaim.create({
        data: {
          claimNo,
          customerId: body.customerId,
          forum: body.forum ?? "SAMADHAAN",
          asOfDate: asOf,
          bankRate: new Prisma.Decimal(bankRate.toFixed(2)),
          annualRate: new Prisma.Decimal(interestRateFor(bankRate).toFixed(2)),
          principalTotal: d2(principalTotal),
          interestTotal: d2(interestTotal),
          notes: body.notes ?? null,
          createdBy: actor.userId ?? null,
        },
      });
      await tx.msmeRecoveryClaimLine.createMany({
        data: computed.map(({ inv, r }) => ({
          companyId: claim.companyId,
          claimId: claim.id,
          salesInvoiceId: inv.id,
          ...lineData(inv, r),
        })),
      });
      return claim;
    });
    return this.get(created.id);
  }

  /**
   * Interest keeps running until the buyer pays, so a claim is recomputed to a new date before a
   * hearing. Receipts since the last computation reduce the principal. Closed claims stay as filed.
   */
  async recompute(id: string, asOfStr: string) {
    const claim = await this.load(id);
    if (claim.status === "SETTLED" || claim.status === "WITHDRAWN") {
      throw new ApiError(409, "A settled or withdrawn claim cannot be recomputed");
    }
    const asOf = asDate(asOfStr);
    if (asOf.getTime() > today().getTime()) {
      throw new ApiError(400, "Interest cannot be claimed up to a future date");
    }
    const latestInvoice = claim.lines.reduce(
      (m, l) => (l.invoiceDate.getTime() > m ? l.invoiceDate.getTime() : m),
      0
    );
    if (asOf.getTime() < latestInvoice) {
      throw new ApiError(400, "The date is before one of the claim's invoices");
    }
    const invoices = await prisma.salesInvoice.findMany({
      where: { id: { in: claim.lines.map((l) => l.salesInvoiceId) } },
      select: invoiceSelect,
    });
    const byId = new Map(invoices.map((i) => [i.id, i]));
    const bankRate = await this.bankRate();
    await prisma.$transaction(async (tx) => {
      let principal = 0;
      let interest = 0;
      for (const line of claim.lines) {
        const inv = byId.get(line.salesInvoiceId);
        if (!inv) continue;
        const r = claimOf(inv, bankRate, asOf);
        principal += r.principalOutstanding;
        interest += r.interest;
        await tx.msmeRecoveryClaimLine.update({ where: { id: line.id }, data: lineData(inv, r) });
      }
      await tx.msmeRecoveryClaim.update({
        where: { id },
        data: {
          asOfDate: asOf,
          bankRate: new Prisma.Decimal(bankRate.toFixed(2)),
          annualRate: new Prisma.Decimal(interestRateFor(bankRate).toFixed(2)),
          principalTotal: d2(principal),
          interestTotal: d2(interest),
        },
      });
    });
    return this.get(id);
  }

  /** DRAFT → FILED → HEARING → SETTLED, or WITHDRAWN before settling; never backwards. */
  async updateStatus(id: string, body: z.infer<typeof statusBody>) {
    const claim = await this.load(id);
    const from = claim.status as ClaimStatus;
    if (!canTransition(from, body.status)) {
      throw new ApiError(
        409,
        `A claim moves forward only: it cannot go from ${from.toLowerCase()} to ${body.status.toLowerCase()}`
      );
    }
    if (body.filedOn && asDate(body.filedOn).getTime() > today().getTime()) {
      throw new ApiError(400, "The filing date cannot be in the future");
    }
    if (body.settledOn && asDate(body.settledOn).getTime() > today().getTime()) {
      throw new ApiError(400, "The settlement date cannot be in the future");
    }
    await prisma.msmeRecoveryClaim.update({
      where: { id },
      data: {
        status: body.status,
        ...(body.filedOn ? { filedOn: asDate(body.filedOn) } : {}),
        ...(body.referenceNo ? { referenceNo: body.referenceNo } : {}),
        ...(body.hearingOn ? { hearingOn: asDate(body.hearingOn) } : {}),
        ...(body.settledOn ? { settledOn: asDate(body.settledOn) } : {}),
        ...(body.settledAmount !== undefined ? { settledAmount: d2(body.settledAmount) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
    return this.get(id);
  }

  /** Everything the claim statement needs: the claim, the supplier and the buyer's particulars. */
  async statementData(id: string) {
    const claim = await this.get(id);
    const [company, settings, customer] = await Promise.all([
      prisma.company.findFirst({ where: { id: requireTenantId() } }),
      this.settings(),
      prisma.customer.findFirst({
        where: { id: claim.customerId },
        select: {
          firmName: true,
          gstin: true,
          email: true,
          mobile: true,
          addresses: { select: { address: true, is_default: true } },
        },
      }),
    ]);
    const addr = customer?.addresses.find((a) => a.is_default) ?? customer?.addresses[0];
    return {
      claim,
      supplier: {
        name: company?.legalName || company?.companyName || "",
        gstin: company?.gstin ?? null,
        pan: company?.pan ?? null,
        address: [company?.addressLine1, company?.city, company?.state, company?.zipcode]
          .filter(Boolean)
          .join(", "),
        email: company?.email ?? null,
        phone: company?.phone ?? null,
        udyamNumber: settings.udyamNumber,
        enterpriseCategory: settings.enterpriseCategory,
        bankRateNote: settings.bankRateNote,
      },
      buyer: {
        name: customer?.firmName ?? claim.customerName ?? "",
        gstin: customer?.gstin ?? null,
        email: customer?.email ?? null,
        phone: Array.isArray(customer?.mobile)
          ? String((customer?.mobile as unknown[])[0] ?? "")
          : null,
        address: addressText(addr?.address),
      },
    };
  }
}

const addressText = (raw: unknown): string => {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>)
      .filter((v) => typeof v === "string" && v.trim())
      .join(", ");
  }
  return "";
};

export const msmeClaimsService = new MsmeClaimsService();
