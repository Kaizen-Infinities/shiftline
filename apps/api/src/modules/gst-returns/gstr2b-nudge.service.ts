import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { notify } from "../notifications/notify";
import { gstinScopes } from "./gst-period";
import { gstr2bService } from "./gstr2b.service";
import { gstr2bSettingsService } from "./gstr2b-settings.service";
import { periodOf } from "./itc.service";

const DAY = 86400000;

interface Candidate {
  recordId: string;
  docNo: string;
  docDate: Date;
  supplierGstin: string;
  reason: "MISMATCH" | "MISSING_IN_2B";
}

/**
 * A daily nudge for whatever nobody chased (P2-18): a MISSING_IN_2B or MISMATCH record from the
 * GSTR-2B reconciliation that has sat for `Gstr2bSettings.nudgeAfterDays` (default 5) with no
 * `SupplierFollowUp` row naming it. The manual "chase a supplier" flow (`supplier-followup
 * .service.ts`) is unchanged; this only flags what that flow never touched.
 */
class Gstr2bNudgeService {
  /** Every MISMATCH and MISSING_IN_2B record of the period, oldest document first. */
  private async candidates(periodKey: string, gstin: string): Promise<Candidate[]> {
    const { records, missingIn2b } = await gstr2bService.reconcile(periodKey, gstin);
    const out: Candidate[] = [];
    for (const r of records) {
      if (r.matchStatus !== "MISMATCH") continue;
      out.push({
        recordId: r.id,
        docNo: r.docNo,
        docDate: r.docDate,
        supplierGstin: r.supplierGstin,
        reason: "MISMATCH",
      });
    }
    for (const b of missingIn2b) {
      if (!b.supplierGstin) continue;
      out.push({
        recordId: `${b.docType}:${b.docId}`,
        docNo: b.docNo,
        docDate: b.docDate,
        supplierGstin: b.supplierGstin,
        reason: "MISSING_IN_2B",
      });
    }
    return out;
  }

  /** Whether any follow-up for this period/GSTIN has ever named this record. */
  private async wasFollowedUp(periodKey: string, gstin: string, recordId: string) {
    const row = await prisma.supplierFollowUp.findFirst({
      where: { periodKey, gstin, recordIds: { array_contains: recordId } },
      select: { id: true },
    });
    return Boolean(row);
  }

  /** One tenant, one GST period: flags every untouched record older than the setting. */
  async nudge(periodKey: string, today = new Date()) {
    const settings = await gstr2bSettingsService.get();
    const scopes = await gstinScopes();
    let checked = 0;
    let flagged = 0;
    for (const scope of scopes) {
      const candidates = await this.candidates(periodKey, scope.gstin);
      for (const c of candidates) {
        checked++;
        const ageDays = Math.floor((today.getTime() - c.docDate.getTime()) / DAY);
        if (ageDays < settings.nudgeAfterDays) continue;
        if (await this.wasFollowedUp(periodKey, scope.gstin, c.recordId)) continue;

        const link = `/compliance/gst?tab=gstr2b&period=${periodKey}&record=${encodeURIComponent(c.recordId)}`;
        // One notification per record per period: the same dedup shape as `ims.service.ts` and
        // `job-work.service.ts`'s sweeps, keyed on the link rather than a database flag.
        const already = await prisma.notification.findFirst({
          where: { category: "gst-returns", link },
          select: { id: true },
        });
        if (already) continue;

        await notify({
          category: "gst-returns",
          title: `${c.docNo} is still unfollowed in the ${periodKey} GSTR-2B reconciliation`,
          body:
            `${c.reason === "MISMATCH" ? "A mismatch against" : "Missing from"} the supplier's ` +
            `2B for ${ageDays} day(s), and nobody has chased ${c.supplierGstin} about it yet.`,
          link,
          to: { permission: "gst-returns.prepare" },
          level: "WARNING",
        });
        flagged++;
      }
    }
    return { checked, flagged };
  }

  /** The daily sweep across every tenant, for the month the 2B reconciliation actually covers. */
  async sweepAllTenants(today = new Date()) {
    const periodKey = periodOf(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
    );
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let flagged = 0;
    for (const c of companies) {
      try {
        const r = await runAsTenant(c.id, () => this.nudge(periodKey, today));
        flagged += r.flagged;
      } catch (err) {
        // A tenant with no GSTIN, or no 2B imported yet for the period, has nothing to nudge.
        logger.debug({ err, companyId: c.id }, "GSTR-2B nudge skipped for tenant");
      }
    }
    return { tenants: companies.length, flagged, periodKey };
  }
}

export const gstr2bNudgeService = new Gstr2bNudgeService();
