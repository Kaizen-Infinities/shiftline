import { z } from "zod";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { normaliseMobile } from "../sms/sms.calc";
import { followUpProvider } from "./followup.providers";
import { gstr2bService } from "./gstr2b.service";
import { gstr2bSettingsService } from "./gstr2b-settings.service";
import { scopeFor } from "./gst-period";

/**
 * Chasing a supplier over their GSTR-2B (P2-10): the reconciliation names, per supplier, which
 * documents it never filed (`MISSING_IN_2B`) or filed differently (`MISMATCH`); this turns a
 * chosen handful of those into one message and sends it.
 */
export const followUpBody = z.object({
  supplierGstin: z.string().trim().toUpperCase().length(15).optional(),
  supplierId: z.union([z.number(), z.string()]).optional(),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  recordIds: z.array(z.string().min(1)).min(1, "Name at least one record to chase"),
  gstin: z.string().trim().toUpperCase().length(15).optional(),
});
export type FollowUpInput = z.infer<typeof followUpBody>;

const money = (v: number) => `₹${v.toFixed(2)}`;

interface FollowUpLine {
  docNo: string;
  docDate: string;
  taxable: number;
  differs: string | null;
}

interface SupplierGroup {
  supplierGstin: string;
  supplierName: string | null;
  recordIds: string[];
  lines: FollowUpLine[];
}

class SupplierFollowUpService {
  /**
   * Every record id resolved to one line of the message, grouped by the supplier it belongs to.
   * A selection spanning several suppliers used to be refused outright (`MIXED_SUPPLIER`); it is
   * now split into one group per supplier so `send`/`preview` can raise one message each (P2-18).
   */
  private async groupBySupplier(
    periodKey: string,
    gstin: string,
    recordIds: string[]
  ): Promise<SupplierGroup[]> {
    const byGstin = new Map<string, SupplierGroup>();

    for (const recordId of recordIds) {
      let supplierGstin: string;
      let supplierName: string | null;
      let line: FollowUpLine;

      if (recordId.includes(":")) {
        // A MISSING_IN_2B book document: `DOCTYPE:docId`.
        const [docType, docId] = recordId.split(":", 2);
        const doc = await gstr2bService.resolveBookDocument(docType, docId);
        if (!doc || !doc.supplierGstin) {
          throw new ApiError(404, "One of those records could not be found", "NO_RECORD");
        }
        supplierGstin = doc.supplierGstin;
        supplierName = null;
        line = {
          docNo: doc.docNo,
          docDate: doc.docDate.toISOString().slice(0, 10),
          taxable: doc.taxable,
          differs: "not filed against your GSTIN in the 2B for this period",
        };
      } else {
        const rec = await prisma.gstr2bRecord.findUnique({ where: { id: recordId } });
        if (!rec || rec.periodKey !== periodKey || rec.gstin !== gstin) {
          throw new ApiError(404, "One of those records could not be found", "NO_RECORD");
        }
        supplierGstin = rec.supplierGstin;
        supplierName = rec.supplierName;
        const mismatch = Array.isArray(rec.mismatchFields)
          ? (rec.mismatchFields as { field: string; inBooks: unknown; inPortal: unknown }[])
              .map((f) => `${f.field}: we have ${f.inBooks}, you filed ${f.inPortal}`)
              .join("; ")
          : null;
        line = {
          docNo: rec.docNo,
          docDate: rec.docDate.toISOString().slice(0, 10),
          taxable: Number(rec.taxable),
          differs: mismatch,
        };
      }

      const group = byGstin.get(supplierGstin) ?? {
        supplierGstin,
        supplierName,
        recordIds: [],
        lines: [],
      };
      group.supplierName = group.supplierName ?? supplierName;
      group.recordIds.push(recordId);
      group.lines.push(line);
      byGstin.set(supplierGstin, group);
    }
    if (byGstin.size === 0)
      throw new ApiError(400, "No supplier could be worked out", "NO_SUPPLIER");
    return [...byGstin.values()];
  }

  private compose(periodKey: string, lines: FollowUpLine[]): string {
    const rows = lines
      .map(
        (l) =>
          `- ${l.docNo} dated ${l.docDate}, taxable ${money(l.taxable)}` +
          (l.differs ? ` — ${l.differs}` : "")
      )
      .join("\n");
    return (
      `This is regarding your GST filing for ${periodKey}. The following invoice(s) do not ` +
      `match our GSTR-2B and we are unable to claim input tax credit on them until corrected:\n\n` +
      `${rows}\n\nPlease file or correct these in your GSTR-1 at the earliest.`
    );
  }

  /** The supplier a group's recipient comes from: the caller's hint when there is exactly one
   * group and it matches, the supplier on the group's own GSTIN otherwise. */
  private async supplierFor(group: SupplierGroup, input: FollowUpInput, single: boolean) {
    if (single && input.supplierId) {
      const s = await prisma.supplier.findUnique({ where: { id: Number(input.supplierId) } });
      if (s) return s;
    }
    if (single && input.supplierGstin && input.supplierGstin === group.supplierGstin) {
      const s = await prisma.supplier.findFirst({ where: { gstin: input.supplierGstin } });
      if (s) return s;
    }
    return prisma.supplier.findFirst({ where: { gstin: group.supplierGstin } });
  }

  /** Composes the message for every supplier the selection touches, without sending or writing
   * anything. */
  async preview(periodKey: string, input: FollowUpInput) {
    const scope = await scopeFor(input.gstin);
    const groups = await this.groupBySupplier(periodKey, scope.gstin, input.recordIds);
    const previews = groups.map((g) => ({
      supplierGstin: g.supplierGstin,
      supplierName: g.supplierName,
      message: this.compose(periodKey, g.lines),
      lines: g.lines,
    }));
    return groups.length === 1 ? previews[0] : previews;
  }

  /**
   * Composes, sends and records one message per supplier the selection touches — a selection
   * spanning several suppliers raises one `SupplierFollowUp` row each rather than being refused
   * (P2-18). Recipients are validated for every group before anything is sent, so a follow-up
   * with one supplier missing a contact detail fails without messaging the others.
   */
  async send(periodKey: string, input: FollowUpInput, actor: { userId?: string }) {
    const scope = await scopeFor(input.gstin);
    const groups = await this.groupBySupplier(periodKey, scope.gstin, input.recordIds);
    const single = groups.length === 1;

    const prepared = await Promise.all(
      groups.map(async (group) => {
        const supplier = await this.supplierFor(group, input, single);
        const rawRecipient =
          input.channel === "WHATSAPP" ? (supplier?.whatsapp ?? null) : (supplier?.email ?? null);
        const recipient =
          input.channel === "WHATSAPP"
            ? normaliseMobile(rawRecipient)
            : rawRecipient?.trim() || null;
        if (!recipient) {
          throw new ApiError(
            400,
            input.channel === "WHATSAPP"
              ? `${group.supplierGstin} has no valid WhatsApp number on file`
              : `${group.supplierGstin} has no email address on file`,
            "NO_CONTACT"
          );
        }
        return {
          group,
          recipient,
          supplierName: group.supplierName ?? supplier?.legalName ?? null,
          message: this.compose(periodKey, group.lines),
        };
      })
    );

    const settings = await gstr2bSettingsService.get();
    const provider = followUpProvider(settings.followUpProvider);

    const results: Awaited<ReturnType<typeof prisma.supplierFollowUp.create>>[] = [];
    let failed = false;
    for (const p of prepared) {
      try {
        if (input.channel === "WHATSAPP") await provider.sendWhatsapp(p.recipient, p.message);
        else await provider.sendEmail(p.recipient, `GSTR-2B follow-up: ${periodKey}`, p.message);

        results.push(
          await prisma.supplierFollowUp.create({
            data: {
              periodKey,
              gstin: scope.gstin,
              supplierGstin: p.group.supplierGstin,
              supplierName: p.supplierName,
              channel: input.channel,
              recordIds: p.group.recordIds,
              recipient: p.recipient,
              message: p.message,
              status: "SENT",
              sentBy: actor.userId?.slice(0, 36) ?? null,
            },
          })
        );
      } catch (error) {
        failed = true;
        const detail = error instanceof Error ? error.message : "The channel refused the message";
        results.push(
          await prisma.supplierFollowUp.create({
            data: {
              periodKey,
              gstin: scope.gstin,
              supplierGstin: p.group.supplierGstin,
              supplierName: p.supplierName,
              channel: input.channel,
              recordIds: p.group.recordIds,
              recipient: p.recipient,
              message: p.message,
              status: "FAILED",
              error: detail.slice(0, 255),
              sentBy: actor.userId?.slice(0, 36) ?? null,
            },
          })
        );
      }
    }
    if (failed) throw new ApiError(502, "The follow-up could not be sent", "FOLLOWUP_FAILED");
    // A single-supplier selection (the common case, and every caller before this package) keeps
    // getting back one row rather than an array of one.
    return single ? results[0] : results;
  }
}

export const supplierFollowUpService = new SupplierFollowUpService();
