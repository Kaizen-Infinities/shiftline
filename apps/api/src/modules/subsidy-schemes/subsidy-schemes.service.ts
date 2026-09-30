import { Prisma } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { documentNumberService } from "../documents/document-number.service";
import { toCsv } from "../imports/imports.csv";
import {
  EXPIRING_WITHIN_DAYS,
  PENDING_DISBURSEMENT_DAYS,
  SUGGESTED_DEFAULTS,
  VERIFY_NOTE,
  addMonthKey,
  asDate,
  canMoveClaim,
  canMoveScheme,
  capitalEntitlement,
  claimNext,
  claimTotals,
  daysBetween,
  interestSubvention,
  iso,
  ltptEntitlementFor,
  ltptSchedule,
  pendingTooLong,
  periodsOverlap,
  round2,
  schemeNext,
  schemeTakesClaims,
  type CapitalInput,
  type ClaimLike,
  type ClaimStatus,
  type InterestInput,
  type LtptInput,
  type SchemeKind,
  type SchemeStatus,
} from "./subsidy.calc";
import {
  DETAILS_BY_KIND,
  DETAILS_REQUIRED,
  type claimStatusBody,
  type createClaimBody,
  type createSchemeBody,
  type listQuery,
  type schemeStatusBody,
  type updateClaimBody,
  type updateSchemeBody,
} from "./subsidy-schemes.validation";

/**
 * Subsidies and scheme claims (TN-10). Standalone until the P2-14 licence register exists; a
 * scheme is shaped to become a licence of type MSME_SCHEME there. Every query goes through the
 * tenant-scoped client, so another company's schemes and claims are invisible.
 */
type Actor = { userId?: string };

const KIND_LABEL: Record<SchemeKind, string> = {
  CAPITAL_SUBSIDY: "Capital subsidy",
  POWER_SUBSIDY_LTPT: "LTPT power subsidy",
  INTEREST_SUBVENTION: "Interest subvention",
  NEEDS: "NEEDS",
  PLI: "PLI",
  STATE_OTHER: "Other state scheme",
  CENTRAL_OTHER: "Other central scheme",
};

/** Kinds whose claims cover a stretch of time that must not be claimed twice. */
const PERIODIC: ReadonlySet<SchemeKind> = new Set(["POWER_SUBSIDY_LTPT", "INTEREST_SUBVENTION"]);

const today = () => asDate(new Date());
const d2 = (n: number) => new Prisma.Decimal(round2(n).toFixed(2));
const num = (d: Prisma.Decimal | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d);
const dateOrNull = (d: Date | null | undefined) => (d ? iso(d) : null);
const dateIn = (s: string | null | undefined) => (s ? asDate(s) : s === null ? null : undefined);
const notFuture = (s: string | undefined, what: string) => {
  if (s && asDate(s).getTime() > today().getTime()) {
    throw new ApiError(400, `${what} cannot be in the future`);
  }
};

/** Kind-specific details, validated for the kind; the first problem is the message. */
const parseDetails = (kind: SchemeKind, raw: unknown): Prisma.InputJsonValue | null => {
  if (raw === undefined || raw === null) {
    if (DETAILS_REQUIRED.has(kind)) {
      throw new ApiError(400, `A ${KIND_LABEL[kind].toLowerCase()} needs its figures`);
    }
    return null;
  }
  const r = DETAILS_BY_KIND[kind].safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new ApiError(400, issue?.message ?? "Those figures do not fit this kind of scheme");
  }
  const v = r.data as Record<string, unknown> | null;
  if (v === null || Object.keys(v).length === 0) return null;
  if (kind === "POWER_SUBSIDY_LTPT") {
    const l = v as unknown as LtptInput;
    const first = l.startMonth;
    const last = addMonthKey(first, l.months - 1);
    for (const key of Object.keys(l.tariffByMonth ?? {})) {
      if (key < first || key > last) {
        throw new ApiError(400, `The tariff for ${key} is outside the subsidy months`);
      }
    }
  }
  return v as Prisma.InputJsonValue;
};

const schemeInclude = {
  claims: { orderBy: [{ periodFrom: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.SubsidySchemeInclude;
type SchemeRow = Prisma.SubsidySchemeGetPayload<{ include: typeof schemeInclude }>;
type ClaimRow = SchemeRow["claims"][number];

const claimLike = (c: ClaimRow): ClaimLike => ({
  id: c.id,
  claimNo: c.claimNo,
  periodFrom: c.periodFrom,
  periodTo: c.periodTo,
  amountClaimed: Number(c.amountClaimed),
  status: c.status as ClaimStatus,
  filedOn: c.filedOn,
  disbursedAmount: num(c.disbursedAmount),
});

const claimDto = (c: ClaimRow, asOf: Date) => ({
  id: c.id,
  schemeId: c.schemeId,
  claimNo: c.claimNo,
  periodFrom: iso(c.periodFrom),
  periodTo: iso(c.periodTo),
  amountClaimed: Number(c.amountClaimed),
  status: c.status as ClaimStatus,
  nextStatuses: claimNext(c.status as ClaimStatus),
  filedOn: dateOrNull(c.filedOn),
  referenceNo: c.referenceNo,
  approvedOn: dateOrNull(c.approvedOn),
  approvedAmount: num(c.approvedAmount),
  disbursedAmount: num(c.disbursedAmount),
  disbursedOn: dateOrNull(c.disbursedOn),
  bankRef: c.bankRef,
  rejectionReason: c.rejectionReason,
  notes: c.notes,
  daysPending:
    (c.status === "FILED" || c.status === "APPROVED") && c.filedOn
      ? daysBetween(c.filedOn, asOf)
      : null,
  createdAt: c.createdAt.toISOString(),
});

/** The kind's own arithmetic: capital entitlement, LTPT month grid or subvention to date. */
const calcFor = (s: SchemeRow, asOf: Date) => {
  const kind = s.kind as SchemeKind;
  const details = s.details as Record<string, unknown> | null;
  if (!details) return null;
  const claims = s.claims.map(claimLike);
  if (kind === "CAPITAL_SUBSIDY" || kind === "NEEDS") {
    return { type: "CAPITAL" as const, ...capitalEntitlement(details as unknown as CapitalInput) };
  }
  if (kind === "POWER_SUBSIDY_LTPT") {
    return {
      type: "LTPT" as const,
      ...ltptSchedule(details as unknown as LtptInput, claims, asOf),
    };
  }
  if (kind === "INTEREST_SUBVENTION") {
    const i = details as unknown as InterestInput;
    // Indian financial year: 1 April to 31 March.
    const y = asOf.getUTCMonth() >= 3 ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
    const fyStart = asDate(`${y}-04-01`);
    return {
      type: "INTEREST" as const,
      fyFrom: iso(fyStart),
      fyToDate: interestSubvention(i, fyStart, asOf),
      fullYearAtSanction: round2((i.sanctionedLoan * i.subventionPct) / 100),
    };
  }
  return null;
};

/** What the scheme should be worth: the sanction, else what its figures work out to. */
const expectedOf = (s: SchemeRow, calc: ReturnType<typeof calcFor>): number | null => {
  if (s.sanctionedAmount !== null) return Number(s.sanctionedAmount);
  if (calc?.type === "CAPITAL") return calc.entitlement;
  if (calc?.type === "LTPT") return calc.totals.entitlement;
  return null;
};

const schemeDto = (s: SchemeRow, asOf: Date, withClaims: boolean) => {
  const calc = calcFor(s, asOf);
  const claims = s.claims.map(claimLike);
  const base = {
    id: s.id,
    schemeCode: s.schemeCode,
    kind: s.kind as SchemeKind,
    kindLabel: KIND_LABEL[s.kind as SchemeKind],
    name: s.name,
    authority: s.authority,
    sanctionOrderNo: s.sanctionOrderNo,
    sanctionDate: dateOrNull(s.sanctionDate),
    sanctionedAmount: num(s.sanctionedAmount),
    eligibilityNotes: s.eligibilityNotes,
    validFrom: dateOrNull(s.validFrom),
    validTo: dateOrNull(s.validTo),
    status: s.status as SchemeStatus,
    nextStatuses: schemeNext(s.status as SchemeStatus),
    takesClaims: schemeTakesClaims(s.status as SchemeStatus),
    details: s.details,
    expected: expectedOf(s, calc),
    totals: claimTotals(num(s.sanctionedAmount), claims),
    claimCount: s.claims.length,
    ltptDueMonths: calc?.type === "LTPT" ? calc.totals.dueMonths : 0,
    ltptMissedMonths: calc?.type === "LTPT" ? calc.totals.missedMonths : 0,
    verifyNote: VERIFY_NOTE,
    updatedAt: s.updatedAt.toISOString(),
  };
  if (!withClaims) return base;
  return { ...base, calc, claims: s.claims.map((c) => claimDto(c, asOf)) };
};

export interface Reminder {
  type: "LTPT_DUE" | "LTPT_MISSED" | "PENDING_DISBURSEMENT" | "EXPIRING";
  severity: "warning" | "danger" | "info";
  schemeId: string;
  schemeCode: string;
  schemeName: string;
  message: string;
  amount: number | null;
  months?: string[];
  claimId?: string;
  claimNo?: string;
  days?: number;
}

const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

class SubsidySchemesService {
  private async load(id: string): Promise<SchemeRow> {
    const s = await prisma.subsidyScheme.findFirst({ where: { id }, include: schemeInclude });
    if (!s) throw new ApiError(404, "That scheme does not exist");
    return s;
  }

  private async assertCodeFree(code: string, exceptId?: string) {
    const dup = await prisma.subsidyScheme.findFirst({
      where: { schemeCode: code, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new ApiError(409, "A scheme with that code already exists");
  }

  // ── Schemes ──────────────────────────────────────────────────────────────

  async list(q: z.infer<typeof listQuery>, asOf = today()) {
    const rows = await prisma.subsidyScheme.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) },
      include: schemeInclude,
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });
    return rows.map((s) => schemeDto(s, asOf, false));
  }

  async get(id: string, asOf = today()) {
    return schemeDto(await this.load(id), asOf, true);
  }

  private assertSanctionParticulars(
    status: SchemeStatus,
    orderNo: string | null | undefined,
    date: string | Date | null | undefined
  ) {
    if ((status === "SANCTIONED" || status === "ACTIVE") && (!orderNo || !date)) {
      throw new ApiError(400, "A sanctioned scheme needs its sanction order number and date");
    }
  }

  async create(body: z.infer<typeof createSchemeBody>, actor: Actor) {
    const kind = body.kind;
    const details = parseDetails(kind, body.details);
    const status = body.status ?? "APPLIED";
    this.assertSanctionParticulars(status, body.sanctionOrderNo, body.sanctionDate);
    notFuture(body.sanctionDate ?? undefined, "The sanction date");
    await this.assertCodeFree(body.schemeCode);
    const created = await prisma.subsidyScheme.create({
      data: {
        schemeCode: body.schemeCode,
        kind,
        name: body.name,
        authority: body.authority || null,
        sanctionOrderNo: body.sanctionOrderNo || null,
        sanctionDate: dateIn(body.sanctionDate) ?? null,
        sanctionedAmount:
          body.sanctionedAmount !== undefined && body.sanctionedAmount !== null
            ? d2(body.sanctionedAmount)
            : null,
        eligibilityNotes: body.eligibilityNotes || null,
        validFrom: dateIn(body.validFrom) ?? null,
        validTo: dateIn(body.validTo) ?? null,
        status,
        details: details ?? Prisma.DbNull,
        createdBy: actor.userId ?? null,
      } as Prisma.SubsidySchemeUncheckedCreateInput,
    });
    return this.get(created.id);
  }

  async update(id: string, body: z.infer<typeof updateSchemeBody>) {
    const s = await this.load(id);
    if (s.status === "CLOSED" || s.status === "REJECTED") {
      throw new ApiError(409, "A closed or rejected scheme cannot be edited");
    }
    const kind = (body.kind ?? s.kind) as SchemeKind;
    if (body.kind && body.kind !== s.kind && s.claims.length > 0) {
      throw new ApiError(409, "The kind of scheme cannot change once claims exist");
    }
    let details: Prisma.InputJsonValue | null | undefined;
    if (body.details !== undefined) details = parseDetails(kind, body.details);
    else if (body.kind && body.kind !== s.kind) details = parseDetails(kind, s.details);
    if (body.schemeCode && body.schemeCode !== s.schemeCode) {
      await this.assertCodeFree(body.schemeCode, id);
    }
    const validFrom = body.validFrom !== undefined ? body.validFrom : dateOrNull(s.validFrom);
    const validTo = body.validTo !== undefined ? body.validTo : dateOrNull(s.validTo);
    if (validFrom && validTo && validTo < validFrom) {
      throw new ApiError(400, "The scheme cannot end before it starts");
    }
    this.assertSanctionParticulars(
      s.status as SchemeStatus,
      body.sanctionOrderNo !== undefined ? body.sanctionOrderNo : s.sanctionOrderNo,
      body.sanctionDate !== undefined ? body.sanctionDate : s.sanctionDate
    );
    notFuture(body.sanctionDate ?? undefined, "The sanction date");
    await prisma.subsidyScheme.update({
      where: { id },
      data: {
        ...(body.schemeCode ? { schemeCode: body.schemeCode } : {}),
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.authority !== undefined ? { authority: body.authority || null } : {}),
        ...(body.sanctionOrderNo !== undefined
          ? { sanctionOrderNo: body.sanctionOrderNo || null }
          : {}),
        ...(body.sanctionDate !== undefined ? { sanctionDate: dateIn(body.sanctionDate) } : {}),
        ...(body.sanctionedAmount !== undefined
          ? {
              sanctionedAmount: body.sanctionedAmount === null ? null : d2(body.sanctionedAmount),
            }
          : {}),
        ...(body.eligibilityNotes !== undefined
          ? { eligibilityNotes: body.eligibilityNotes || null }
          : {}),
        ...(body.validFrom !== undefined ? { validFrom: dateIn(body.validFrom) } : {}),
        ...(body.validTo !== undefined ? { validTo: dateIn(body.validTo) } : {}),
        ...(details !== undefined ? { details: details ?? Prisma.DbNull } : {}),
      },
    });
    return this.get(id);
  }

  /** APPLIED → SANCTIONED → ACTIVE → CLOSED, or APPLIED → REJECTED; never backwards. */
  async updateStatus(id: string, body: z.infer<typeof schemeStatusBody>) {
    const s = await this.load(id);
    const from = s.status as SchemeStatus;
    if (!canMoveScheme(from, body.status)) {
      throw new ApiError(
        409,
        `A scheme moves forward only: it cannot go from ${from.toLowerCase()} to ${body.status.toLowerCase()}`
      );
    }
    notFuture(body.sanctionDate, "The sanction date");
    this.assertSanctionParticulars(
      body.status,
      body.sanctionOrderNo ?? s.sanctionOrderNo,
      body.sanctionDate ?? s.sanctionDate
    );
    await prisma.subsidyScheme.update({
      where: { id },
      data: {
        status: body.status,
        ...(body.sanctionOrderNo ? { sanctionOrderNo: body.sanctionOrderNo } : {}),
        ...(body.sanctionDate ? { sanctionDate: asDate(body.sanctionDate) } : {}),
        ...(body.sanctionedAmount !== undefined
          ? { sanctionedAmount: d2(body.sanctionedAmount) }
          : {}),
      },
    });
    return this.get(id);
  }

  /** Only a scheme with no claims can go; one with claims is closed instead. */
  async remove(id: string) {
    const s = await this.load(id);
    if (s.claims.length > 0) {
      throw new ApiError(409, "This scheme has claims; close it instead of deleting it");
    }
    await prisma.subsidyScheme.delete({ where: { id } });
    return { id };
  }

  /** What a claim for [from, to] should come to, from the scheme's own figures. */
  async entitlement(id: string, fromStr: string, toStr: string) {
    const s = await this.load(id);
    return this.suggest(s, fromStr, toStr);
  }

  private suggest(s: SchemeRow, fromStr: string, toStr: string, exceptClaimId?: string) {
    const kind = s.kind as SchemeKind;
    const details = s.details as Record<string, unknown> | null;
    const others = s.claims.filter((c) => c.id !== exceptClaimId).map(claimLike);
    const t = claimTotals(num(s.sanctionedAmount), others);
    let amount: number | null = null;
    let basis = "";
    let months: string[] | undefined;
    if (details && kind === "POWER_SUBSIDY_LTPT") {
      const r = ltptEntitlementFor(details as unknown as LtptInput, fromStr, toStr);
      amount = r.amount;
      months = r.months;
      basis = `${r.months.length} month${r.months.length === 1 ? "" : "s"} at ${(details as unknown as LtptInput).ratePct}% of the base tariff`;
    } else if (details && kind === "INTEREST_SUBVENTION") {
      const r = interestSubvention(details as unknown as InterestInput, fromStr, toStr);
      amount = r.amount;
      basis = `${r.days} days on an average principal of ${r.averagePrincipal.toFixed(2)}${r.capped ? ", capped" : ""}`;
    } else if (details && (kind === "CAPITAL_SUBSIDY" || kind === "NEEDS")) {
      const r = capitalEntitlement(details as unknown as CapitalInput);
      amount = round2(Math.max(r.entitlement - t.claimed - t.drafted, 0));
      basis = `Entitlement ${r.entitlement.toFixed(2)} less what is already claimed`;
    } else if (t.unclaimed !== null) {
      amount = t.unclaimed;
      basis = "Sanctioned amount less what is already claimed";
    }
    return { from: fromStr, to: toStr, amount, basis, months, verifyNote: VERIFY_NOTE };
  }

  // ── Claims ───────────────────────────────────────────────────────────────

  /** The checks every draft passes on create and on edit. */
  private assertClaimFits(
    s: SchemeRow,
    c: { periodFrom: string; periodTo: string; amountClaimed: number },
    exceptClaimId?: string
  ) {
    if (c.periodTo < c.periodFrom) {
      throw new ApiError(400, "The claim period cannot end before it starts");
    }
    if (asDate(c.periodFrom).getTime() > today().getTime()) {
      throw new ApiError(400, "A claim cannot start in the future");
    }
    const vf = dateOrNull(s.validFrom);
    const vt = dateOrNull(s.validTo);
    if ((vf && c.periodFrom < vf) || (vt && c.periodTo > vt)) {
      throw new ApiError(400, "The claim period is outside the scheme's validity");
    }
    const kind = s.kind as SchemeKind;
    if (kind === "POWER_SUBSIDY_LTPT" && s.details) {
      const r = ltptEntitlementFor(s.details as unknown as LtptInput, c.periodFrom, c.periodTo);
      if (r.months.length === 0) {
        throw new ApiError(400, "The claim period covers none of the subsidy months");
      }
    }
    const others = s.claims.filter((x) => x.id !== exceptClaimId && x.status !== "REJECTED");
    if (PERIODIC.has(kind)) {
      const clash = others.find((x) =>
        periodsOverlap(
          { from: x.periodFrom, to: x.periodTo },
          { from: c.periodFrom, to: c.periodTo }
        )
      );
      if (clash) {
        throw new ApiError(409, `Claim ${clash.claimNo} already covers part of that period`);
      }
    }
    if (s.sanctionedAmount !== null) {
      const already = others.reduce((a, x) => a + Number(x.amountClaimed), 0);
      if (round2(already + c.amountClaimed) > Number(s.sanctionedAmount)) {
        throw new ApiError(400, "The claims would add up to more than the sanctioned amount");
      }
    }
  }

  async createClaim(schemeId: string, body: z.infer<typeof createClaimBody>, actor: Actor) {
    const s = await this.load(schemeId);
    if (!schemeTakesClaims(s.status as SchemeStatus)) {
      throw new ApiError(409, "Claims can be raised only on a sanctioned or active scheme");
    }
    this.assertClaimFits(s, body);
    if (body.claimNo) {
      const dup = await prisma.subsidyClaim.findFirst({
        where: { claimNo: body.claimNo },
        select: { id: true },
      });
      if (dup) throw new ApiError(409, "A claim with that number already exists");
    }
    await prisma.$transaction(async (tx) => {
      const claimNo =
        body.claimNo ??
        (await documentNumberService.next("SUBSIDY_CLAIM", { date: asDate(body.periodTo), tx }));
      await tx.subsidyClaim.create({
        data: {
          schemeId,
          claimNo,
          periodFrom: asDate(body.periodFrom),
          periodTo: asDate(body.periodTo),
          amountClaimed: d2(body.amountClaimed),
          notes: body.notes || null,
          createdBy: actor.userId ?? null,
        } as Prisma.SubsidyClaimUncheckedCreateInput,
      });
    });
    return this.get(schemeId);
  }

  private async loadClaim(schemeId: string, claimId: string) {
    const s = await this.load(schemeId);
    const c = s.claims.find((x) => x.id === claimId);
    if (!c) throw new ApiError(404, "That claim does not exist");
    return { s, c };
  }

  /** Only a draft can be corrected; after filing, the authority's copy is the record. */
  async updateClaim(schemeId: string, claimId: string, body: z.infer<typeof updateClaimBody>) {
    const { s, c } = await this.loadClaim(schemeId, claimId);
    if (c.status !== "DRAFT") throw new ApiError(409, "Only a draft claim can be edited");
    const next = {
      periodFrom: body.periodFrom ?? iso(c.periodFrom),
      periodTo: body.periodTo ?? iso(c.periodTo),
      amountClaimed: body.amountClaimed ?? Number(c.amountClaimed),
    };
    this.assertClaimFits(s, next, claimId);
    await prisma.subsidyClaim.update({
      where: { id: claimId },
      data: {
        periodFrom: asDate(next.periodFrom),
        periodTo: asDate(next.periodTo),
        amountClaimed: d2(next.amountClaimed),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      },
    });
    return this.get(schemeId);
  }

  /** DRAFT → FILED → APPROVED → DISBURSED, or REJECTED after filing; never backwards. */
  async updateClaimStatus(
    schemeId: string,
    claimId: string,
    body: z.infer<typeof claimStatusBody>
  ) {
    const { s, c } = await this.loadClaim(schemeId, claimId);
    const from = c.status as ClaimStatus;
    if (!canMoveClaim(from, body.status)) {
      throw new ApiError(
        409,
        `A claim moves forward only: it cannot go from ${from.toLowerCase()} to ${body.status.toLowerCase()}`
      );
    }
    if (body.status === "FILED" && !schemeTakesClaims(s.status as SchemeStatus)) {
      throw new ApiError(409, "Claims can be filed only on a sanctioned or active scheme");
    }
    notFuture(body.filedOn, "The filing date");
    notFuture(body.approvedOn, "The approval date");
    notFuture(body.disbursedOn, "The date the money arrived");
    const claimed = Number(c.amountClaimed);
    if (body.approvedAmount !== undefined && body.approvedAmount > claimed) {
      throw new ApiError(400, "The approved amount is more than was claimed");
    }
    if (body.status === "DISBURSED") {
      if ((body.disbursedAmount as number) > claimed) {
        throw new ApiError(400, "The amount received is more than was claimed");
      }
      if (c.filedOn && body.disbursedOn && asDate(body.disbursedOn) < c.filedOn) {
        throw new ApiError(400, "The money cannot arrive before the claim was filed");
      }
    }
    if (body.status === "APPROVED" && body.approvedOn && c.filedOn) {
      if (asDate(body.approvedOn) < c.filedOn) {
        throw new ApiError(400, "A claim cannot be approved before it was filed");
      }
    }
    const data: Prisma.SubsidyClaimUpdateInput = { status: body.status };
    if (body.status === "FILED") {
      data.filedOn = asDate(body.filedOn as string);
      if (body.referenceNo) data.referenceNo = body.referenceNo;
    }
    if (body.status === "APPROVED" || body.status === "DISBURSED") {
      if (body.approvedOn) data.approvedOn = asDate(body.approvedOn);
      if (body.approvedAmount !== undefined) data.approvedAmount = d2(body.approvedAmount);
      if (body.referenceNo) data.referenceNo = body.referenceNo;
    }
    if (body.status === "DISBURSED") {
      data.disbursedAmount = d2(body.disbursedAmount as number);
      data.disbursedOn = asDate(body.disbursedOn as string);
      if (body.bankRef) data.bankRef = body.bankRef;
    }
    if (body.status === "REJECTED") data.rejectionReason = body.rejectionReason ?? null;
    await prisma.subsidyClaim.update({ where: { id: claimId }, data });
    return this.get(schemeId);
  }

  // ── Summary, reminders, export ───────────────────────────────────────────

  private async all() {
    return prisma.subsidyScheme.findMany({
      include: schemeInclude,
      orderBy: [{ schemeCode: "asc" }],
    });
  }

  private remindersOf(rows: SchemeRow[], asOf: Date): Reminder[] {
    const out: Reminder[] = [];
    for (const s of rows) {
      const head = { schemeId: s.id, schemeCode: s.schemeCode, schemeName: s.name };
      const live = s.status === "SANCTIONED" || s.status === "ACTIVE";
      const calc = live ? calcFor(s, asOf) : null;
      if (calc?.type === "LTPT") {
        for (const state of ["MISSED", "DUE"] as const) {
          const months = calc.months.filter((m) => m.state === state);
          if (!months.length) continue;
          const amount = round2(months.reduce((a, m) => a + m.entitlement, 0));
          const list = months.map((m) => monthLabel(m.month));
          out.push({
            ...head,
            type: state === "DUE" ? "LTPT_DUE" : "LTPT_MISSED",
            severity: state === "DUE" ? "warning" : "danger",
            message:
              state === "DUE"
                ? `${months.length} month${months.length === 1 ? "" : "s"} of power subsidy not yet claimed: ${list.join(", ")}`
                : `${months.length} month${months.length === 1 ? "" : "s"} of power subsidy skipped or past the claim window: ${list.join(", ")}`,
            amount,
            months: months.map((m) => m.month),
          });
        }
      }
      for (const c of pendingTooLong(s.claims.map(claimLike), asOf)) {
        out.push({
          ...head,
          type: "PENDING_DISBURSEMENT",
          severity: "warning",
          message: `Claim ${c.claimNo} filed ${c.daysPending} days ago and not yet paid (over ${PENDING_DISBURSEMENT_DAYS} days)`,
          amount: c.amountClaimed,
          claimId: c.id,
          claimNo: c.claimNo,
          days: c.daysPending,
        });
      }
      if (live && s.validTo) {
        const left = daysBetween(asOf, s.validTo);
        if (left >= 0 && left <= EXPIRING_WITHIN_DAYS) {
          out.push({
            ...head,
            type: "EXPIRING",
            severity: "info",
            message: `Scheme validity ends on ${iso(s.validTo)} (${left} day${left === 1 ? "" : "s"} left); file what is due before then`,
            amount: null,
            days: left,
          });
        }
      }
    }
    const rank = { danger: 0, warning: 1, info: 2 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  async reminders(asOf = today()) {
    const items = this.remindersOf(await this.all(), asOf);
    return { asOf: iso(asOf), items };
  }

  async summary(asOf = today()) {
    const rows = await this.all();
    const sanctionedStatuses = new Set(["SANCTIONED", "ACTIVE", "CLOSED"]);
    let sanctioned = 0;
    const agg = { claimed: 0, drafted: 0, disbursed: 0, pending: 0, rejected: 0, shortfall: 0 };
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const s of rows) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
      if (sanctionedStatuses.has(s.status) && s.sanctionedAmount !== null) {
        sanctioned += Number(s.sanctionedAmount);
      }
      const t = claimTotals(num(s.sanctionedAmount), s.claims.map(claimLike));
      for (const k of Object.keys(agg) as (keyof typeof agg)[]) agg[k] += t[k];
    }
    const reminders = this.remindersOf(rows, asOf);
    return {
      asOf: iso(asOf),
      schemes: rows.length,
      sanctioned: round2(sanctioned),
      claimed: round2(agg.claimed),
      drafted: round2(agg.drafted),
      received: round2(agg.disbursed),
      pending: round2(agg.pending),
      rejected: round2(agg.rejected),
      shortfall: round2(agg.shortfall),
      byStatus,
      byKind,
      reminderCount: reminders.length,
      defaults: SUGGESTED_DEFAULTS,
      verifyNote: VERIFY_NOTE,
    };
  }

  async exportCsv(asOf = today()) {
    const rows = await this.all();
    const header = [
      "Scheme code",
      "Name",
      "Kind",
      "Authority",
      "Status",
      "Sanction order",
      "Sanction date",
      "Sanctioned",
      "Valid from",
      "Valid to",
      "Claimed",
      "Received",
      "Pending",
      "Unclaimed",
      "Claims",
    ];
    const body = rows.map((s) => {
      const d = schemeDto(s, asOf, false);
      const f = (n: number | null) => (n === null ? "" : n.toFixed(2));
      return [
        d.schemeCode,
        d.name,
        d.kindLabel,
        d.authority ?? "",
        d.status,
        d.sanctionOrderNo ?? "",
        d.sanctionDate ?? "",
        f(d.sanctionedAmount),
        d.validFrom ?? "",
        d.validTo ?? "",
        f(d.totals.claimed),
        f(d.totals.disbursed),
        f(d.totals.pending),
        f(d.totals.unclaimed),
        String(d.claimCount),
      ];
    });
    return toCsv([header, ...body]);
  }
}

export const subsidySchemesService = new SubsidySchemesService();
