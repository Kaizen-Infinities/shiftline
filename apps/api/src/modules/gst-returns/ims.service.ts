import type { ImsStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId, runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { decryptText } from "../../utils/crypto";
import { notify } from "../notifications/notify";
import { filingApprovalService } from "../filings/filing-approval.service";
import { scopeFor } from "./gst-period";
import { periodOf } from "./itc.service";
import type { ImsPushItem } from "./gstr2b.types";
import { providerFor } from "./providers";

/**
 * The Invoice Management System (P1-13c): the company's decision on every inward record the
 * portal holds against it.
 *
 * The decision has a deadline and a default. A record still PENDING when the portal draws the
 * 2B is treated as accepted, so doing nothing is itself a choice — and one that takes credit
 * the company may not be entitled to. That is why a pending row is stored rather than implied,
 * why `pendingRisk` exists, and why the job below warns before the 14th instead of after it.
 */
export const IMS_DEADLINE_DAY = 14;

/** How the portal names each decision. */
const ACTION_CODE: Record<ImsStatus, "A" | "R" | "P"> = {
  ACCEPTED: "A",
  REJECTED: "R",
  PENDING: "P",
};

class ImsService {
  /** Every record of the period with the decision standing against it. */
  async list(periodKey: string, gstin: string | null | undefined, status?: ImsStatus) {
    const scope = await scopeFor(gstin);
    const rows = await prisma.gstr2bRecord.findMany({
      where: { periodKey, gstin: scope.gstin },
      include: { imsAction: true },
      orderBy: [{ supplierGstin: "asc" }, { docDate: "asc" }],
    });
    const withStatus = rows.map((r) => ({
      ...r,
      // A record nobody has touched is pending, whether or not a row says so.
      imsStatus: r.imsAction?.status ?? ("PENDING" as ImsStatus),
    }));
    return status ? withStatus.filter((r) => r.imsStatus === status) : withStatus;
  }

  /** One decision. A rejection always carries a reason: it is the supplier's to answer. */
  async act(
    recordId: string,
    input: { status: ImsStatus; reason?: string | null },
    actor: { userId?: string }
  ) {
    const record = await prisma.gstr2bRecord.findUnique({
      where: { id: recordId },
      include: { imsAction: true },
    });
    if (!record) throw new ApiError(404, "That 2B record does not exist");
    if (input.status === "REJECTED" && !input.reason?.trim()) {
      throw new ApiError(400, "A rejection needs a reason", "REASON_REQUIRED");
    }
    if (record.imsAction?.pushedAt) {
      throw new ApiError(
        409,
        "That decision has already gone to the portal; change it there and pull the 2B again",
        "IMS_ALREADY_PUSHED"
      );
    }
    const data = {
      status: input.status,
      reason: input.reason?.trim().slice(0, 255) ?? null,
      decidedBy: actor.userId ?? null,
      decidedAt: new Date(),
    };
    return prisma.imsAction.upsert({
      where: { recordId },
      create: { recordId, companyId: requireTenantId(), ...data },
      update: data,
    });
  }

  /**
   * The bulk rules an accountant actually wants: accept everything that agrees with the books,
   * and everything that agrees inside the tolerance. Nothing else is decided in bulk — a
   * record the supplier never filed, or one the company never recorded, is a conversation.
   */
  async applyRule(
    periodKey: string,
    gstin: string | null | undefined,
    rule: "ACCEPT_MATCHED" | "ACCEPT_WITHIN_TOLERANCE",
    actor: { userId?: string }
  ) {
    const scope = await scopeFor(gstin);
    const matchStatuses = rule === "ACCEPT_MATCHED" ? ["MATCHED"] : ["MATCHED", "MISMATCH"];
    const records = await prisma.gstr2bRecord.findMany({
      where: {
        periodKey,
        gstin: scope.gstin,
        matchStatus: { in: matchStatuses as ("MATCHED" | "MISMATCH")[] },
      },
      include: { imsAction: true },
    });
    let decided = 0;
    for (const r of records) {
      if (r.imsAction?.pushedAt) continue;
      // A record the portal itself says carries no credit is never accepted by a rule.
      if (!r.itcAvailable) continue;
      await this.act(
        r.id,
        {
          status: "ACCEPTED",
          reason: rule === "ACCEPT_MATCHED" ? "Agrees with the books" : "Within tolerance",
        },
        actor
      );
      decided++;
    }
    return { rule, decided };
  }

  /**
   * Records still undecided, and what accepting them by default would cost. This is the number
   * that matters before the 14th: it is credit the company will be treated as having claimed.
   */
  async pendingRisk(periodKey: string, gstin: string | null | undefined) {
    const rows = await this.list(periodKey, gstin, "PENDING");
    const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
    return {
      periodKey,
      pending: rows.length,
      credit: {
        igst: n2(rows.reduce((s, r) => s + Number(r.igst), 0)),
        cgst: n2(rows.reduce((s, r) => s + Number(r.cgst), 0)),
        sgst: n2(rows.reduce((s, r) => s + Number(r.sgst), 0)),
        cess: n2(rows.reduce((s, r) => s + Number(r.cess), 0)),
      },
      records: rows,
    };
  }

  /**
   * Sends the decisions to the portal. Only what is decided and not yet pushed goes; the push
   * is registered on the filing gate as `IMS`, so it needs an approval like any other filing.
   */
  async push(
    periodKey: string,
    gstin: string | null | undefined,
    actor: { userId?: string },
    opts: { skipGate?: boolean } = {}
  ) {
    const scope = await scopeFor(gstin);
    const records = await prisma.gstr2bRecord.findMany({
      where: { periodKey, gstin: scope.gstin },
      include: { imsAction: true },
    });
    const toPush = records.filter((r) => r.imsAction && !r.imsAction.pushedAt);
    if (toPush.length === 0) {
      throw new ApiError(409, "There is nothing decided left to push", "IMS_NOTHING_TO_PUSH");
    }
    if (!opts.skipGate) {
      await filingApprovalService.assertSubmittable(
        "IMS",
        periodKey,
        await this.payloadHash(periodKey, scope.gstin),
        scope.filingPlaceId
      );
    }

    const config = await prisma.eInvoiceConfig.findFirst();
    const provider = providerFor(config?.provider ?? "FIXTURE");
    const items: ImsPushItem[] = toPush.map((r) => ({
      supplierGstin: r.supplierGstin,
      docType: r.docType,
      docNo: r.docNo,
      docDate: r.docDate,
      action: ACTION_CODE[r.imsAction!.status],
    }));
    const result = await provider.pushImsActions(items, {
      baseUrl: config?.baseUrl ?? null,
      clientId: config?.clientId ? decryptText(config.clientId) : null,
      clientSecret: config?.clientSecret ? decryptText(config.clientSecret) : null,
      username: config?.username ?? null,
      password: config?.password ? decryptText(config.password) : null,
      gstin: scope.gstin,
    });

    const pushedAt = new Date();
    await prisma.imsAction.updateMany({
      where: { id: { in: toPush.map((r) => r.imsAction!.id) } },
      data: {
        pushedAt,
        pushedBy: actor.userId ?? null,
        pushRef: result.reference,
        pushError: null,
      },
    });
    logger.info(
      { periodKey, gstin: scope.gstin, pushed: items.length, reference: result.reference },
      "IMS actions pushed"
    );
    return { ...result, pushed: items.length, pushedAt };
  }

  /** Registers the period's decisions for approval, with a hash of what will be sent. */
  async register(periodKey: string, gstin: string | null | undefined, actor: { userId?: string }) {
    const scope = await scopeFor(gstin);
    const risk = await this.pendingRisk(periodKey, gstin);
    const rows = await this.list(periodKey, gstin);
    return filingApprovalService.upsertDraft(
      {
        filingType: "IMS",
        periodKey,
        businessPlaceId: scope.filingPlaceId === null ? null : Number(scope.filingPlaceId),
        payloadHash: await this.payloadHash(periodKey, scope.gstin),
        summary: {
          gstin: scope.gstin,
          records: rows.length,
          accepted: rows.filter((r) => r.imsStatus === "ACCEPTED").length,
          rejected: rows.filter((r) => r.imsStatus === "REJECTED").length,
          pending: risk.pending,
          creditAcceptedByDefault: risk.credit,
        },
        notes: risk.pending
          ? `${risk.pending} record(s) still pending; the portal accepts those by default`
          : null,
      },
      actor
    );
  }

  /** What the push will say, hashed, so a decision changed after approval voids it. */
  private async payloadHash(periodKey: string, gstin: string) {
    const { createHash } = await import("node:crypto");
    const rows = await prisma.gstr2bRecord.findMany({
      where: { periodKey, gstin },
      include: { imsAction: true },
      orderBy: [{ supplierGstin: "asc" }, { docNo: "asc" }],
    });
    const payload = rows.map((r) => ({
      s: r.supplierGstin,
      t: r.docType,
      n: r.docNo,
      a: r.imsAction?.status ?? "PENDING",
    }));
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  /**
   * Warns whoever prepares the returns that records are still undecided and the deadline is
   * close. The job runs daily, so the warning has to de-duplicate itself: `notify` sends
   * whatever it is given, so this checks for a notification already sent for the same period
   * and urgency before adding another. One nudge at a week out and one at two days is useful;
   * a daily repeat is noise people learn to ignore.
   */
  async warnIfPending(periodKey: string, gstin: string | null | undefined, daysLeft: number) {
    const risk = await this.pendingRisk(periodKey, gstin);
    if (risk.pending === 0) return { warned: false, pending: 0 };
    const urgency = daysLeft <= 2 ? "urgent" : "early";
    const link = `/compliance/ims?period=${periodKey}&notice=${urgency}`;
    const already = await prisma.notification.findFirst({
      where: { category: "filings", link },
      select: { id: true },
    });
    if (already) return { warned: false, pending: risk.pending, reason: "already warned" };
    const total = risk.credit.igst + risk.credit.cgst + risk.credit.sgst + risk.credit.cess;
    await notify({
      category: "filings",
      title: `${risk.pending} IMS record(s) undecided for ${periodKey}`,
      body:
        `The portal accepts a pending record by default, taking ₹${total.toFixed(2)} of credit ` +
        `with it. ${daysLeft} day(s) left to act.`,
      link,
      to: { permission: "gst-returns.prepare" },
      level: daysLeft <= 2 ? "WARNING" : "INFO",
    });
    return { warned: true, pending: risk.pending };
  }

  /**
   * The daily sweep across every tenant. IMS actions are due by the 14th for the previous
   * month's records, so the month being warned about is the one just gone.
   */
  async sweepAllTenants(today = new Date()) {
    const day = today.getUTCDate();
    const daysLeft = IMS_DEADLINE_DAY - day;
    // Only the run-up matters: before the 7th there is nothing urgent to say, and after the
    // 14th the portal has already applied its default.
    if (daysLeft <= 0 || daysLeft > 7) return { tenants: 0, warned: 0, skipped: "outside window" };
    const periodKey = periodOf(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
    );
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let warned = 0;
    for (const c of companies) {
      const r = await runAsTenant(c.id, async () => {
        try {
          return await this.warnIfPending(periodKey, null, daysLeft);
        } catch (err) {
          // A tenant with no GSTIN has no IMS to answer for; it must not stop the sweep.
          logger.debug({ err, companyId: c.id }, "IMS warning skipped for tenant");
          return { warned: false, pending: 0 };
        }
      });
      if (r.warned) warned++;
    }
    return { tenants: companies.length, warned, periodKey, daysLeft };
  }
}

export const imsService = new ImsService();
