import { z } from "zod";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { followUpProvider } from "./followup.providers";
import { gstr2bService } from "./gstr2b.service";
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

class SupplierFollowUpService {
  /** Every record id resolved to one line of the message, and the supplier it belongs to. */
  private async lines(
    periodKey: string,
    gstin: string,
    recordIds: string[]
  ): Promise<{ lines: FollowUpLine[]; supplierGstin: string; supplierName: string | null }> {
    let supplierGstin: string | null = null;
    let supplierName: string | null = null;
    const lines: FollowUpLine[] = [];

    for (const recordId of recordIds) {
      if (recordId.includes(":")) {
        // A MISSING_IN_2B book document: `DOCTYPE:docId`.
        const [docType, docId] = recordId.split(":", 2);
        const doc = await gstr2bService.resolveBookDocument(docType, docId);
        if (!doc || !doc.supplierGstin) {
          throw new ApiError(404, "One of those records could not be found", "NO_RECORD");
        }
        supplierGstin = supplierGstin ?? doc.supplierGstin;
        if (doc.supplierGstin !== supplierGstin) {
          throw new ApiError(
            400,
            "All the records must belong to the same supplier",
            "MIXED_SUPPLIER"
          );
        }
        lines.push({
          docNo: doc.docNo,
          docDate: doc.docDate.toISOString().slice(0, 10),
          taxable: doc.taxable,
          differs: "not filed against your GSTIN in the 2B for this period",
        });
      } else {
        const rec = await prisma.gstr2bRecord.findUnique({ where: { id: recordId } });
        if (!rec || rec.periodKey !== periodKey || rec.gstin !== gstin) {
          throw new ApiError(404, "One of those records could not be found", "NO_RECORD");
        }
        supplierGstin = supplierGstin ?? rec.supplierGstin;
        if (rec.supplierGstin !== supplierGstin) {
          throw new ApiError(
            400,
            "All the records must belong to the same supplier",
            "MIXED_SUPPLIER"
          );
        }
        supplierName = supplierName ?? rec.supplierName;
        const mismatch = Array.isArray(rec.mismatchFields)
          ? (rec.mismatchFields as { field: string; inBooks: unknown; inPortal: unknown }[])
              .map((f) => `${f.field}: we have ${f.inBooks}, you filed ${f.inPortal}`)
              .join("; ")
          : null;
        lines.push({
          docNo: rec.docNo,
          docDate: rec.docDate.toISOString().slice(0, 10),
          taxable: Number(rec.taxable),
          differs: mismatch,
        });
      }
    }
    if (!supplierGstin) throw new ApiError(400, "No supplier could be worked out", "NO_SUPPLIER");
    return { lines, supplierGstin, supplierName };
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

  /** Composes the message without sending anything, and without writing a row. */
  async preview(periodKey: string, input: FollowUpInput) {
    const scope = await scopeFor(input.gstin);
    const { lines, supplierGstin, supplierName } = await this.lines(
      periodKey,
      scope.gstin,
      input.recordIds
    );
    return { supplierGstin, supplierName, message: this.compose(periodKey, lines), lines };
  }

  /** Composes, sends, and records the outcome whichever way it goes. */
  async send(periodKey: string, input: FollowUpInput, actor: { userId?: string }) {
    const scope = await scopeFor(input.gstin);
    const supplier = input.supplierId
      ? await prisma.supplier.findUnique({ where: { id: Number(input.supplierId) } })
      : input.supplierGstin
        ? await prisma.supplier.findFirst({ where: { gstin: input.supplierGstin } })
        : null;

    const { lines, supplierGstin, supplierName } = await this.lines(
      periodKey,
      scope.gstin,
      input.recordIds
    );
    const message = this.compose(periodKey, lines);

    const recipient =
      input.channel === "WHATSAPP"
        ? supplier?.whatsapp?.trim() || null
        : supplier?.email?.trim() || null;
    if (!recipient) {
      throw new ApiError(
        400,
        input.channel === "WHATSAPP"
          ? "This supplier has no WhatsApp number on file"
          : "This supplier has no email address on file",
        "NO_CONTACT"
      );
    }

    const provider = followUpProvider();
    try {
      if (input.channel === "WHATSAPP") await provider.sendWhatsapp(recipient, message);
      else await provider.sendEmail(recipient, `GSTR-2B follow-up: ${periodKey}`, message);

      return prisma.supplierFollowUp.create({
        data: {
          periodKey,
          gstin: scope.gstin,
          supplierGstin,
          supplierName: supplierName ?? supplier?.legalName ?? null,
          channel: input.channel,
          recordIds: input.recordIds,
          recipient,
          message,
          status: "SENT",
          sentBy: actor.userId?.slice(0, 36) ?? null,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The channel refused the message";
      await prisma.supplierFollowUp.create({
        data: {
          periodKey,
          gstin: scope.gstin,
          supplierGstin,
          supplierName: supplierName ?? supplier?.legalName ?? null,
          channel: input.channel,
          recordIds: input.recordIds,
          recipient,
          message,
          status: "FAILED",
          error: detail.slice(0, 255),
          sentBy: actor.userId?.slice(0, 36) ?? null,
        },
      });
      throw new ApiError(502, "The follow-up could not be sent", "FOLLOWUP_FAILED");
    }
  }
}

export const supplierFollowUpService = new SupplierFollowUpService();
