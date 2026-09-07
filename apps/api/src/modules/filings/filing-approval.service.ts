import { createHash } from "node:crypto";
import { z } from "zod";
import { FILING_KEYS, filingByKey, isValidPeriodKey } from "@shiftline/shared";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { notify } from "../notifications/notify";

/**
 * Approval gate on statutory filings (P1-04, PC7). A filing package computes a return, registers
 * it here as a draft with a hash of its payload, and sends it for approval; someone else approves
 * or rejects; only an approved gate whose hash still matches lets the submission go out; the
 * submission marks the gate SUBMITTED with the acknowledgement. Any change to the payload after
 * approval voids it. Rows are audited by trigger and never deleted.
 */
export interface Actor {
  userId?: string;
  isSuperAdmin?: boolean;
}

const periodKey = z.string().min(4).max(20);
export const draftSchema = z.object({
  filingType: z.enum(FILING_KEYS as [string, ...string[]]),
  periodKey,
  businessPlaceId: z.coerce.number().int().positive().optional().nullable(),
  /** What the approver sees: totals, counts, anything the filing package wants to show. */
  summary: z.record(z.string(), z.unknown()).default({}),
  /** Hash of the full payload; when absent the summary is hashed. */
  payloadHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  notes: z.string().max(500).optional().nullable(),
});
export type DraftInput = z.infer<typeof draftSchema>;
export const rejectSchema = z.object({
  reason: z.string().trim().min(3, "Say why the filing is rejected").max(500),
});
export const submittedSchema = z.object({
  submissionRef: z.string().trim().max(120).optional().nullable(),
});
export const listSchema = z.object({
  filingType: z.string().max(40).optional(),
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "SUBMITTED"]).optional(),
  periodKey: z.string().max(20).optional(),
});

export const hashPayload = (payload: unknown): string =>
  createHash("sha256").update(stableStringify(payload)).digest("hex");

const stableStringify = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
};

const actorId = (a: Actor) => a.userId?.slice(0, 36) ?? null;
type HistoryEntry = {
  at: string;
  event: string;
  by: string | null;
  note?: string | null;
};
/** History is a JSON array; Prisma cannot append to it in place, so the row's copy is extended. */
const appendHistory = (existing: unknown, entry: HistoryEntry): HistoryEntry[] => [
  ...(Array.isArray(existing) ? (existing as HistoryEntry[]) : []),
  entry,
];
/** Business places are keyed by a bigint; callers may pass a number, a bigint or nothing. */
type BusinessPlaceRef = number | bigint | null | undefined;
const placeId = (v: BusinessPlaceRef): bigint | null =>
  v === null || v === undefined ? null : BigInt(v);

class FilingApprovalService {
  /** The gate row of a filing period, if registered. */
  async find(filingType: string, periodKey: string, businessPlaceId?: BusinessPlaceRef) {
    return prisma.filingApproval.findFirst({
      where: { filingType, periodKey, businessPlaceId: placeId(businessPlaceId) },
    });
  }

  /**
   * Registers or refreshes the draft for a filing period. A changed payload sends a PENDING
   * or APPROVED gate back to DRAFT (the previous approval is voided and noted); a SUBMITTED
   * gate cannot change: the filing package raises an amendment instead.
   */
  async upsertDraft(input: DraftInput, actor: Actor) {
    const def = filingByKey(input.filingType);
    if (!def) throw new ApiError(400, `Unknown filing ${input.filingType}`);
    if (!isValidPeriodKey(input.periodKey, def.cadence)) {
      throw new ApiError(
        400,
        `Period ${input.periodKey} does not fit a ${def.cadence.toLowerCase()} filing`
      );
    }
    const hash = input.payloadHash ?? hashPayload(input.summary);
    const existing = await this.find(input.filingType, input.periodKey, input.businessPlaceId);
    if (!existing) {
      return prisma.filingApproval.create({
        data: {
          filingType: input.filingType,
          periodKey: input.periodKey,
          businessPlaceId: placeId(input.businessPlaceId),
          status: "DRAFT",
          payloadHash: hash,
          summary: input.summary as object,
          notes: input.notes ?? null,
          preparedBy: actorId(actor),
          preparedAt: new Date(),
        },
      });
    }
    if (existing.status === "SUBMITTED") {
      throw new ApiError(
        409,
        `${def.name} for ${input.periodKey} is already submitted; file an amendment instead`,
        "FILING_SUBMITTED"
      );
    }
    const changed = existing.payloadHash !== hash;
    const voided = changed && (existing.status === "APPROVED" || existing.status === "PENDING");
    return prisma.filingApproval.update({
      where: { id: existing.id },
      data: {
        payloadHash: hash,
        summary: input.summary as object,
        notes: input.notes ?? existing.notes,
        preparedBy: actorId(actor) ?? existing.preparedBy,
        preparedAt: new Date(),
        ...(voided && {
          status: "DRAFT",
          approvedBy: null,
          approvedAt: null,
          lockedAt: null,
          sentForApprovalAt: null,
          history: appendHistory(existing.history, {
            at: new Date().toISOString(),
            event: "APPROVAL_VOIDED",
            by: actorId(actor),
            note: `Payload changed while ${existing.status.toLowerCase()}`,
          }),
        }),
        ...(existing.status === "REJECTED" && changed && { status: "DRAFT" }),
      },
    });
  }

  async sendForApproval(id: string, actor: Actor) {
    const row = await this.get(id);
    if (row.status !== "DRAFT" && row.status !== "REJECTED") {
      throw new ApiError(409, `A ${row.status.toLowerCase()} filing cannot be sent for approval`);
    }
    const updated = await prisma.filingApproval.update({
      where: { id },
      data: {
        status: "PENDING",
        sentForApprovalAt: new Date(),
        preparedBy: actorId(actor) ?? row.preparedBy,
        rejectReason: null,
        history: appendHistory(row.history, {
          at: new Date().toISOString(),
          event: "SENT",
          by: actorId(actor),
        }),
      },
    });
    const def = filingByKey(row.filingType);
    await notify({
      category: "filings",
      title: `${def?.name ?? row.filingType} ${row.periodKey} awaits approval`,
      body: "Review the figures and approve or reject before it is filed.",
      link: `/compliance/approvals?focus=${id}`,
      to: { permission: "filings.approve" },
      createdBy: actorId(actor),
    });
    return updated;
  }

  async approve(id: string, actor: Actor) {
    const row = await this.get(id);
    if (row.status !== "PENDING") {
      throw new ApiError(
        409,
        `Only a pending filing can be approved (this one is ${row.status.toLowerCase()})`
      );
    }
    if (row.preparedBy && actorId(actor) === row.preparedBy && !actor.isSuperAdmin) {
      throw new ApiError(
        403,
        "A filing cannot be approved by the person who prepared it",
        "SELF_APPROVAL"
      );
    }
    const now = new Date();
    const updated = await prisma.filingApproval.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: actorId(actor),
        approvedAt: now,
        lockedAt: now,
        history: appendHistory(row.history, {
          at: now.toISOString(),
          event: "APPROVED",
          by: actorId(actor),
        }),
      },
    });
    if (row.preparedBy) {
      const def = filingByKey(row.filingType);
      await notify({
        category: "filings",
        title: `${def?.name ?? row.filingType} ${row.periodKey} approved`,
        body: "It can be filed now. Any change to the figures voids the approval.",
        link: `/compliance/approvals?focus=${id}`,
        to: { userIds: [row.preparedBy] },
        createdBy: actorId(actor),
      });
    }
    return updated;
  }

  async reject(id: string, reason: string, actor: Actor) {
    const row = await this.get(id);
    if (row.status !== "PENDING") {
      throw new ApiError(
        409,
        `Only a pending filing can be rejected (this one is ${row.status.toLowerCase()})`
      );
    }
    const now = new Date();
    const updated = await prisma.filingApproval.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectReason: reason,
        approvedBy: null,
        approvedAt: null,
        lockedAt: null,
        history: appendHistory(row.history, {
          at: now.toISOString(),
          event: "REJECTED",
          by: actorId(actor),
          note: reason,
        }),
      },
    });
    if (row.preparedBy) {
      const def = filingByKey(row.filingType);
      await notify({
        category: "filings",
        level: "WARNING",
        title: `${def?.name ?? row.filingType} ${row.periodKey} rejected`,
        body: reason,
        link: `/compliance/approvals?focus=${id}`,
        to: { userIds: [row.preparedBy] },
        createdBy: actorId(actor),
      });
    }
    return updated;
  }

  /**
   * The gate every filing package calls before pushing anything to a portal: the period must
   * be APPROVED and the payload unchanged since approval.
   */
  async assertSubmittable(
    filingType: string,
    periodKey: string,
    payloadHash: string,
    businessPlaceId?: BusinessPlaceRef
  ) {
    const row = await this.find(filingType, periodKey, businessPlaceId);
    const name = filingByKey(filingType)?.name ?? filingType;
    if (!row || row.status === "DRAFT" || row.status === "REJECTED" || row.status === "PENDING") {
      throw new ApiError(
        409,
        `${name} for ${periodKey} has not been approved; send it for approval first`,
        "FILING_NOT_APPROVED"
      );
    }
    if (row.status === "SUBMITTED") {
      throw new ApiError(409, `${name} for ${periodKey} was already submitted`, "FILING_SUBMITTED");
    }
    if (row.payloadHash !== payloadHash) {
      throw new ApiError(
        409,
        `${name} for ${periodKey} changed after it was approved; prepare and approve it again`,
        "FILING_STALE"
      );
    }
    return row;
  }

  async markSubmitted(id: string, submissionRef: string | null | undefined, actor: Actor) {
    const row = await this.get(id);
    await this.assertSubmittable(
      row.filingType,
      row.periodKey,
      row.payloadHash,
      row.businessPlaceId
    );
    const now = new Date();
    return prisma.filingApproval.update({
      where: { id },
      data: {
        status: "SUBMITTED",
        submittedBy: actorId(actor),
        submittedAt: now,
        submissionRef: submissionRef ?? null,
        history: appendHistory(row.history, {
          at: now.toISOString(),
          event: "SUBMITTED",
          by: actorId(actor),
          note: submissionRef ?? null,
        }),
      },
    });
  }

  async get(id: string) {
    const row = await prisma.filingApproval.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Filing approval not found");
    return row;
  }

  async list(q: z.infer<typeof listSchema>) {
    return prisma.filingApproval.findMany({
      where: {
        ...(q.filingType && { filingType: q.filingType }),
        ...(q.status && { status: q.status }),
        ...(q.periodKey && { periodKey: q.periodKey }),
      },
      orderBy: [{ periodKey: "desc" }, { filingType: "asc" }],
      take: 200,
    });
  }
}

export const filingApprovalService = new FilingApprovalService();
