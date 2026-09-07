import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../config/prisma";
import { isJobsStarted, QUEUES, sendTenantJob } from "../../lib/jobs";
import { logger } from "../../lib/logger";
import { emitToTenant } from "../../lib/realtime";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { notify } from "../notifications/notify";
import { eInvoiceConfigService, THIRTY_DAY_WINDOW_CRORE } from "./e-invoice.config.service";
import { buildPayload } from "./e-invoice.payload";
import {
  CANCEL_REASONS,
  EInvoiceProviderError,
  type CancelReasonCode,
  type EInvoiceDocType,
} from "./e-invoice.types";
import { providerFor } from "./providers";

/**
 * The IRN lifecycle for a document (P1-11): applicability, the request row, generation on the
 * worker (or inline when no worker runs), cancellation within the portal's 24-hour window, and
 * the guard that keeps an invoice with a live IRN from being cancelled in the books first.
 */
type Db = Prisma.TransactionClient | typeof prisma;

export const DOC_TYPES = ["INV", "CRN", "DBN"] as const;
export const docTypeSchema = z.enum(DOC_TYPES);
export const generateSchema = z.object({
  docType: docTypeSchema,
  docId: z.string().uuid(),
});
export const cancelSchema = z.object({
  reason: z.enum(["1", "2", "3", "4"]),
  remarks: z.string().trim().min(3).max(100),
});
export const listSchema = z.object({
  status: z.enum(["PENDING", "GENERATED", "FAILED", "CANCELLED"]).optional(),
  docType: docTypeSchema.optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const IRN_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY_MS);

export interface Applicability {
  applies: boolean;
  reason: string | null;
  /** The last day an IRN can be raised for a document of this date, when the window applies. */
  deadline: string | null;
}

class EInvoiceService {
  /** Whether a document of this date and buyer needs an IRN under the tenant's settings. */
  async applicability(docDate: Date, buyerGstin: string | null): Promise<Applicability> {
    const cfg = await eInvoiceConfigService.get();
    if (!cfg.enabled)
      return { applies: false, reason: "E-invoicing is switched off", deadline: null };
    if (!buyerGstin) return { applies: false, reason: "B2C document", deadline: null };
    if (cfg.applicableFrom && docDate.toISOString().slice(0, 10) < cfg.applicableFrom) {
      return { applies: false, reason: `Dated before ${cfg.applicableFrom}`, deadline: null };
    }
    const deadline = cfg.thirtyDayWindow
      ? new Date(docDate.getTime() + IRN_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10)
      : null;
    return { applies: true, reason: null, deadline };
  }

  async forDocument(docType: EInvoiceDocType, docId: string, db: Db = prisma) {
    return db.eInvoice.findFirst({ where: { docType, docId } });
  }

  /**
   * Registers the request and runs it: on the worker when one is running, inline otherwise.
   * A GENERATED row is returned as is; a FAILED or PENDING row is retried with a fresh payload.
   */
  async request(docType: EInvoiceDocType, docId: string, actor: { userId?: string }) {
    const built = await buildPayload(docType, docId);
    const existing = await this.forDocument(docType, docId);
    if (existing?.status === "GENERATED") return { row: existing, queued: false };
    if (existing?.status === "CANCELLED") {
      throw new ApiError(
        409,
        `${built.docNo} already had its IRN cancelled; a new document number is needed`,
        "IRN_CANCELLED"
      );
    }
    const { enabled, aatoCrore, applicableFrom } = await eInvoiceConfigService.credentials(
      built.sellerGstin
    );
    if (!enabled)
      throw new ApiError(409, "E-invoicing is switched off for this company", "EINVOICE_DISABLED");
    if (applicableFrom && built.docDate < applicableFrom) {
      throw new ApiError(
        409,
        `${built.docNo} is dated before e-invoicing applies to this company`,
        "BEFORE_APPLICABLE"
      );
    }
    if (
      aatoCrore >= THIRTY_DAY_WINDOW_CRORE &&
      daysBetween(built.docDate, new Date()) > IRN_WINDOW_DAYS
    ) {
      throw new ApiError(
        409,
        `${built.docNo} is older than ${IRN_WINDOW_DAYS} days; the portal no longer accepts it for a business above ₹${THIRTY_DAY_WINDOW_CRORE} crore`,
        "IRN_WINDOW_CLOSED"
      );
    }
    const data = {
      docType,
      docId,
      docNo: built.docNo,
      docDate: built.docDate,
      sellerGstin: built.sellerGstin,
      buyerGstin: built.buyerGstin,
      status: "PENDING" as const,
      request: built.request as object,
      error: null,
      requestedBy: actor.userId?.slice(0, 36) ?? null,
    };
    const row = existing
      ? await prisma.eInvoice.update({ where: { id: existing.id }, data })
      : await prisma.eInvoice.create({ data });
    const companyId = requireTenantId();
    if (isJobsStarted()) {
      await sendTenantJob(
        QUEUES.E_INVOICE,
        { companyId, eInvoiceId: row.id },
        {
          singletonKey: `${companyId}:${row.id}`,
          retryLimit: 4,
          retryDelay: 20,
          retryBackoff: true,
        }
      );
      return { row, queued: true };
    }
    return { row: await this.generate(row.id), queued: false };
  }

  /** Runs the portal call for a PENDING row. Idempotent: a GENERATED row is left alone. */
  async generate(eInvoiceId: string) {
    const row = await prisma.eInvoice.findUnique({ where: { id: eInvoiceId } });
    if (!row) throw new ApiError(404, "E-invoice request not found");
    if (row.status === "GENERATED" || row.status === "CANCELLED") return row;
    const { provider, creds } = await eInvoiceConfigService.credentials(row.sellerGstin);
    try {
      const result = await providerFor(provider).generate(row.request as never, creds);
      const updated = await prisma.eInvoice.update({
        where: { id: row.id },
        data: {
          status: "GENERATED",
          irn: result.irn,
          ackNo: result.ackNo,
          ackDate: result.ackDate,
          signedInvoice: result.signedInvoice,
          signedQr: result.signedQr,
          ewbNo: result.ewbNo ?? null,
          ewbDate: result.ewbDate ?? null,
          ewbValidTill: result.ewbValidTill ?? null,
          response: result.raw as object,
          error: null,
          attempts: { increment: 1 },
        },
      });
      emitToTenant("e-invoice:updated", {
        id: updated.id,
        docType: updated.docType,
        docId: updated.docId,
        status: updated.status,
      });
      return updated;
    } catch (err) {
      const pe = err instanceof EInvoiceProviderError ? err : null;
      const message = pe
        ? `${pe.code}: ${pe.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
      const failed = await prisma.eInvoice.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          error: message.slice(0, 1000),
          response: pe ? ({ code: pe.code, message: pe.message } as object) : undefined,
          attempts: { increment: 1 },
        },
      });
      logger.warn(
        { eInvoiceId: row.id, code: pe?.code, retryable: pe?.retryable },
        "irn generation failed"
      );
      emitToTenant("e-invoice:updated", {
        id: failed.id,
        docType: failed.docType,
        docId: failed.docId,
        status: failed.status,
      });
      if (!pe || !pe.retryable) {
        await notify({
          category: "e-invoice",
          level: "WARNING",
          title: `IRN failed for ${row.docNo}`,
          body: message.slice(0, 300),
          link: row.docType === "INV" ? `/sales-invoices/${row.docId}` : "/compliance/e-invoices",
          to: { userIds: [row.requestedBy] },
        });
        return failed;
      }
      throw err; // pg-boss retries the transient ones
    }
  }

  /** Cancels a live IRN on the portal (within 24 hours) and marks the row. */
  async cancel(id: string, reason: CancelReasonCode, remarks: string, actor: { userId?: string }) {
    const row = await prisma.eInvoice.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "E-invoice not found");
    if (row.status !== "GENERATED" || !row.irn || !row.ackDate) {
      throw new ApiError(409, "Only a generated IRN can be cancelled", "IRN_NOT_LIVE");
    }
    if (Date.now() - row.ackDate.getTime() > CANCEL_WINDOW_MS) {
      throw new ApiError(
        409,
        `The portal accepts cancellation within 24 hours of the IRN; ${row.docNo} is past that. Raise a credit note instead.`,
        "CANCEL_WINDOW_CLOSED"
      );
    }
    const { provider, creds } = await eInvoiceConfigService.credentials(row.sellerGstin);
    try {
      await providerFor(provider).cancel(row.irn, reason, remarks, creds);
    } catch (err) {
      const pe = err instanceof EInvoiceProviderError ? err : null;
      throw new ApiError(
        502,
        pe ? `${pe.code}: ${pe.message}` : "The portal refused the cancellation",
        "IRN_CANCEL_FAILED"
      );
    }
    const updated = await prisma.eInvoice.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: actor.userId?.slice(0, 36) ?? null,
        cancelReason: reason,
        cancelRemarks: `${CANCEL_REASONS[reason]}: ${remarks}`.slice(0, 100),
      },
    });
    emitToTenant("e-invoice:updated", {
      id: updated.id,
      docType: updated.docType,
      docId: updated.docId,
      status: updated.status,
    });
    return updated;
  }

  /**
   * Called before a document is cancelled in the books: a live IRN must be cancelled on the
   * portal first (or, past 24 hours, the document stands and a note reverses it).
   */
  async assertDocumentCancellable(docType: EInvoiceDocType, docId: string, db: Db = prisma) {
    const row = await this.forDocument(docType, docId, db);
    if (row?.status === "GENERATED") {
      throw new ApiError(
        409,
        `${row.docNo} has a live IRN (${row.irn?.slice(0, 12)}…); cancel the e-invoice first`,
        "IRN_LIVE"
      );
    }
  }

  async get(id: string) {
    const row = await prisma.eInvoice.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "E-invoice not found");
    return row;
  }

  async list(q: z.infer<typeof listSchema>) {
    return prisma.eInvoice.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(q.docType && { docType: q.docType }),
        ...((q.from || q.to) && {
          docDate: {
            ...(q.from && { gte: new Date(`${q.from}T00:00:00Z`) }),
            ...(q.to && { lte: new Date(`${q.to}T00:00:00Z`) }),
          },
        }),
      },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        docType: true,
        docId: true,
        docNo: true,
        docDate: true,
        sellerGstin: true,
        buyerGstin: true,
        status: true,
        irn: true,
        ackNo: true,
        ackDate: true,
        ewbNo: true,
        error: true,
        attempts: true,
        cancelledAt: true,
        cancelRemarks: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}

export const eInvoiceService = new EInvoiceService();
