import { z } from "zod";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { emitToTenant } from "../../lib/realtime";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { eInvoiceConfigService } from "../e-invoice/e-invoice.config.service";
import { notify } from "../notifications/notify";
import { buildEwb } from "./eway-bill.payload";
import {
  EwayBillProviderError,
  EWB_CANCEL_REASONS,
  validUptoFor,
  type EwbByIrnRequest,
  type EwbDocType,
  type EwbTransport,
} from "./eway-bill.types";
import { ewbProviderFor } from "./providers";

/**
 * E-way bill lifecycle (P1-12): generate from a document (through the IRN when it has one),
 * Part B vehicle updates, extension near expiry, cancellation within 24 hours, consolidation
 * into a trip sheet, and the hourly sweep that expires bills and warns before they lapse.
 */
const vehicleNo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$/,
    "Vehicle number like TN01AB1234"
  );
const ddmmyyyy = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/);
export const transportSchema = z.object({
  distanceKm: z.coerce.number().int().min(0).max(4000).default(0),
  transMode: z.enum(["1", "2", "3", "4"]).default("1"),
  transporterId: z.string().trim().max(15).optional().nullable(),
  transporterName: z.string().trim().max(120).optional().nullable(),
  transDocNo: z.string().trim().max(30).optional().nullable(),
  transDocDate: ddmmyyyy.optional().nullable(),
  vehicleNo: vehicleNo.optional().nullable(),
  vehicleType: z.enum(["R", "O"]).default("R"),
});
export const generateSchema = transportSchema.extend({
  docType: z.enum(["INV", "CHL", "JWC"]),
  docRef: z.string().min(1).max(40),
});
export const partBSchema = z.object({
  vehicleNo: vehicleNo.optional().nullable(),
  fromPlace: z.string().trim().min(1).max(50),
  fromState: z.coerce.number().int().min(1).max(99),
  reasonCode: z.enum(["1", "2", "3", "4"]),
  reasonRem: z.string().trim().min(3).max(100),
  transDocNo: z.string().trim().max(30).optional().nullable(),
  transDocDate: ddmmyyyy.optional().nullable(),
  transMode: z.enum(["1", "2", "3", "4"]).default("1"),
  vehicleType: z.enum(["R", "O"]).optional(),
});
export const extendSchema = z.object({
  vehicleNo: vehicleNo.optional().nullable(),
  fromPlace: z.string().trim().min(1).max(50),
  fromState: z.coerce.number().int().min(1).max(99),
  fromPincode: z.coerce.number().int().min(100000).max(999999),
  remainingDistance: z.coerce.number().int().min(1).max(4000),
  transDocNo: z.string().trim().max(30).optional().nullable(),
  transDocDate: ddmmyyyy.optional().nullable(),
  transMode: z.enum(["1", "2", "3", "4"]).default("1"),
  extnRsnCode: z.enum(["1", "2", "4", "5", "99"]),
  extnRemarks: z.string().trim().min(3).max(100),
  consignmentStatus: z.enum(["M", "T"]).default("M"),
  transitType: z.enum(["R", "W", "O"]).optional(),
  addressLine1: z.string().trim().max(100).optional().nullable(),
});
export const cancelSchema = z.object({
  reason: z.enum(["1", "2", "3", "4"]),
  remarks: z.string().trim().min(3).max(100),
});
export const consolidateSchema = z.object({
  fromPlace: z.string().trim().min(1).max(50),
  fromState: z.coerce.number().int().min(1).max(99),
  vehicleNo,
  transMode: z.enum(["1", "2", "3", "4"]).default("1"),
  transDocNo: z.string().trim().max(30).optional().nullable(),
  transDocDate: ddmmyyyy.optional().nullable(),
  ewbIds: z.array(z.string().uuid()).min(1).max(50),
});
export const listSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "CANCELLED", "EXPIRED", "FAILED"]).optional(),
  docType: z.enum(["INV", "CHL", "JWC"]).optional(),
  expiringWithinHours: z.coerce.number().int().min(1).max(72).optional(),
});

export const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The portal accepts an extension from 8 hours before to 8 hours after expiry. */
export const EXTEND_WINDOW_MS = 8 * 60 * 60 * 1000;
export const EXPIRY_WARNING_MS = 12 * 60 * 60 * 1000;

type Actor = { userId?: string };
const actorId = (a: Actor) => a.userId?.slice(0, 36) ?? null;
type Update = {
  at: string;
  kind: string;
  by: string | null;
  [k: string]: string | number | boolean | null | undefined;
};
const appendUpdate = (existing: unknown, u: Update): Update[] => [
  ...(Array.isArray(existing) ? (existing as Update[]) : []),
  u,
];
const providerMessage = (err: unknown) =>
  err instanceof EwayBillProviderError
    ? `${err.code}: ${err.message}`
    : err instanceof Error
      ? err.message
      : "Unknown error";

class EwayBillService {
  async forDocument(docType: EwbDocType, docRef: string) {
    return prisma.ewayBill.findMany({
      where: { docType, docRef },
      orderBy: { createdAt: "desc" },
    });
  }

  /** The live bill of a document, if any. */
  async activeFor(docType: EwbDocType, docRef: string) {
    return prisma.ewayBill.findFirst({ where: { docType, docRef, status: "ACTIVE" } });
  }

  /**
   * Raises an e-way bill for a document. With a live IRN the portal derives Part A from it;
   * otherwise the full request goes to the e-way bill API. One live bill per document.
   */
  async generate(input: z.infer<typeof generateSchema>, actor: Actor) {
    const { docType, docRef, ...transport } = input;
    const t: EwbTransport = {
      distanceKm: transport.distanceKm,
      transMode: transport.transMode,
      transporterId: transport.transporterId ?? null,
      transporterName: transport.transporterName ?? null,
      transDocNo: transport.transDocNo ?? null,
      transDocDate: transport.transDocDate ?? null,
      vehicleNo: transport.vehicleNo ?? null,
      vehicleType: transport.vehicleType,
    };
    if (t.transMode === "1" && !t.vehicleNo && !t.transporterId) {
      throw new ApiError(
        400,
        "Road transport needs a vehicle number, or a transporter id when the transporter fills Part B"
      );
    }
    const existing = await this.activeFor(docType, docRef);
    if (existing) {
      throw new ApiError(
        409,
        `${existing.docNo} already has e-way bill ${existing.ewbNo}`,
        "EWB_ACTIVE"
      );
    }
    const built = await buildEwb(docType, docRef, t);
    const { provider, creds, enabled } = await eInvoiceConfigService.credentials(built.fromGstin);
    if (!enabled)
      throw new ApiError(
        409,
        "E-invoicing and e-way bills are switched off for this company",
        "EINVOICE_DISABLED"
      );
    const req = built.request;
    const row = await prisma.ewayBill.create({
      data: {
        docType,
        docRef: built.docRef,
        docNo: built.docNo,
        docDate: built.docDate,
        eInvoiceId: built.eInvoiceId,
        irn: built.irn,
        status: "PENDING",
        fromGstin: req.fromGstin,
        fromPincode: String(req.fromPincode),
        fromStateCode: String(req.fromStateCode).padStart(2, "0"),
        toGstin: built.toGstin,
        toPincode: String(req.toPincode),
        toStateCode: String(req.toStateCode).padStart(2, "0"),
        distanceKm: t.distanceKm,
        transMode: t.transMode,
        transporterId: t.transporterId,
        transporterName: t.transporterName,
        transDocNo: t.transDocNo,
        transDocDate: t.transDocDate ? parseDdmmyyyy(t.transDocDate) : null,
        vehicleNo: t.vehicleNo,
        vehicleType: t.vehicleType,
        totalValue: built.totalValue,
        request: (built.irn ? { byIrn: irnRequest(built.irn, t), full: req } : req) as object,
        requestedBy: actorId(actor),
      },
    });
    try {
      const p = ewbProviderFor(provider);
      const result = built.irn
        ? await p.generateByIrn(irnRequest(built.irn, t), creds)
        : await p.generate(req, creds);
      const updated = await prisma.ewayBill.update({
        where: { id: row.id },
        data: {
          status: "ACTIVE",
          ewbNo: result.ewbNo,
          ewbDate: result.ewbDate,
          validUpto: result.validUpto,
          response: result.raw as object,
          error: result.alert ?? null,
          attempts: { increment: 1 },
        },
      });
      emitToTenant("eway-bill:updated", {
        id: updated.id,
        docType,
        docRef,
        status: updated.status,
      });
      return updated;
    } catch (err) {
      const failed = await prisma.ewayBill.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          error: providerMessage(err).slice(0, 1000),
          attempts: { increment: 1 },
        },
      });
      logger.warn({ ewayBillId: row.id, err }, "e-way bill generation failed");
      emitToTenant("eway-bill:updated", { id: failed.id, docType, docRef, status: failed.status });
      return failed;
    }
  }

  private async live(id: string) {
    const row = await prisma.ewayBill.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "E-way bill not found");
    if (row.status !== "ACTIVE" || !row.ewbNo) {
      throw new ApiError(
        409,
        `E-way bill ${row.ewbNo ?? row.docNo} is ${row.status.toLowerCase()}`,
        "EWB_NOT_ACTIVE"
      );
    }
    return row as typeof row & { ewbNo: string };
  }

  /** Part B: the vehicle (or a new vehicle) for a bill. Sets validity when Part B was empty. */
  async updatePartB(id: string, input: z.infer<typeof partBSchema>, actor: Actor) {
    const row = await this.live(id);
    if (input.transMode === "1" && !input.vehicleNo)
      throw new ApiError(400, "Road transport needs a vehicle number");
    const { provider, creds } = await eInvoiceConfigService.credentials(row.fromGstin);
    let result;
    try {
      result = await ewbProviderFor(provider).updatePartB(
        {
          ewbNo: row.ewbNo,
          vehicleNo: input.vehicleNo ?? undefined,
          fromPlace: input.fromPlace,
          fromState: input.fromState,
          reasonCode: input.reasonCode,
          reasonRem: input.reasonRem,
          transDocNo: input.transDocNo ?? undefined,
          transDocDate: input.transDocDate ?? undefined,
          transMode: input.transMode,
          vehicleType: input.vehicleType ?? row.vehicleType,
        },
        creds
      );
    } catch (err) {
      throw new ApiError(502, providerMessage(err), "EWB_PART_B_FAILED");
    }
    const validUpto =
      result.validUpto ??
      row.validUpto ??
      validUptoFor(new Date(), row.distanceKm, (input.vehicleType ?? row.vehicleType) as "R" | "O");
    const updated = await prisma.ewayBill.update({
      where: { id },
      data: {
        vehicleNo: input.vehicleNo ?? row.vehicleNo,
        vehicleType: input.vehicleType ?? row.vehicleType,
        transMode: input.transMode,
        transDocNo: input.transDocNo ?? row.transDocNo,
        transDocDate: input.transDocDate ? parseDdmmyyyy(input.transDocDate) : row.transDocDate,
        validUpto,
        updates: appendUpdate(row.updates, {
          at: new Date().toISOString(),
          kind: "PART_B",
          by: actorId(actor),
          vehicleNo: input.vehicleNo ?? null,
          fromPlace: input.fromPlace,
          reason: input.reasonCode,
          remarks: input.reasonRem,
        }),
      },
    });
    emitToTenant("eway-bill:updated", {
      id,
      docType: row.docType,
      docRef: row.docRef,
      status: updated.status,
    });
    return updated;
  }

  /** Extension: only within 8 hours either side of expiry, with the remaining distance. */
  async extend(id: string, input: z.infer<typeof extendSchema>, actor: Actor) {
    const row = await this.live(id);
    if (!row.validUpto) throw new ApiError(409, "Fill Part B before extending", "EWB_NO_PART_B");
    const delta = row.validUpto.getTime() - Date.now();
    if (Math.abs(delta) > EXTEND_WINDOW_MS) {
      throw new ApiError(
        409,
        `The portal accepts an extension from 8 hours before to 8 hours after expiry (${row.validUpto.toISOString()})`,
        "EWB_EXTEND_WINDOW"
      );
    }
    const { provider, creds } = await eInvoiceConfigService.credentials(row.fromGstin);
    let result;
    try {
      result = await ewbProviderFor(provider).extend(
        {
          ewbNo: row.ewbNo,
          vehicleNo: input.vehicleNo ?? row.vehicleNo ?? undefined,
          fromPlace: input.fromPlace,
          fromState: input.fromState,
          fromPincode: input.fromPincode,
          remainingDistance: input.remainingDistance,
          transDocNo: input.transDocNo ?? undefined,
          transDocDate: input.transDocDate ?? undefined,
          transMode: input.transMode,
          extnRsnCode: input.extnRsnCode,
          extnRemarks: input.extnRemarks,
          consignmentStatus: input.consignmentStatus,
          transitType: input.transitType,
          addressLine1: input.addressLine1 ?? undefined,
        },
        creds
      );
    } catch (err) {
      throw new ApiError(502, providerMessage(err), "EWB_EXTEND_FAILED");
    }
    const updated = await prisma.ewayBill.update({
      where: { id },
      data: {
        validUpto: result.validUpto,
        status: "ACTIVE",
        extensions: { increment: 1 },
        vehicleNo: input.vehicleNo ?? row.vehicleNo,
        updates: appendUpdate(row.updates, {
          at: new Date().toISOString(),
          kind: "EXTENDED",
          by: actorId(actor),
          validUpto: result.validUpto.toISOString(),
          remainingDistance: input.remainingDistance,
          reason: input.extnRsnCode,
          remarks: input.extnRemarks,
        }),
      },
    });
    emitToTenant("eway-bill:updated", {
      id,
      docType: row.docType,
      docRef: row.docRef,
      status: updated.status,
    });
    return updated;
  }

  async cancel(id: string, reason: keyof typeof EWB_CANCEL_REASONS, remarks: string, actor: Actor) {
    const row = await this.live(id);
    if (row.ewbDate && Date.now() - row.ewbDate.getTime() > CANCEL_WINDOW_MS) {
      throw new ApiError(
        409,
        `The portal accepts cancellation within 24 hours of generation; ${row.ewbNo} is past that`,
        "CANCEL_WINDOW_CLOSED"
      );
    }
    if (row.consolidatedNo) {
      throw new ApiError(
        409,
        `${row.ewbNo} is on trip sheet ${row.consolidatedNo}; regenerate the trip sheet without it first`,
        "EWB_CONSOLIDATED"
      );
    }
    const { provider, creds } = await eInvoiceConfigService.credentials(row.fromGstin);
    try {
      await ewbProviderFor(provider).cancel(
        { ewbNo: row.ewbNo, cancelRsnCode: reason, cancelRmrk: remarks },
        creds
      );
    } catch (err) {
      throw new ApiError(502, providerMessage(err), "EWB_CANCEL_FAILED");
    }
    const updated = await prisma.ewayBill.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: actorId(actor),
        cancelReason: reason,
        cancelRemarks: `${EWB_CANCEL_REASONS[reason]}: ${remarks}`.slice(0, 100),
      },
    });
    emitToTenant("eway-bill:updated", {
      id,
      docType: row.docType,
      docRef: row.docRef,
      status: updated.status,
    });
    return updated;
  }

  /** A trip sheet for several live bills on one vehicle. */
  async consolidate(input: z.infer<typeof consolidateSchema>, actor: Actor) {
    const found = await prisma.ewayBill.findMany({ where: { id: { in: input.ewbIds } } });
    if (found.length !== input.ewbIds.length)
      throw new ApiError(404, "One or more e-way bills were not found");
    // In the order the caller listed them: the trip sheet and its numbers keep that order.
    const rows = input.ewbIds.map((id) => found.find((r) => r.id === id)!);
    const dead = rows.filter((r) => r.status !== "ACTIVE" || !r.ewbNo);
    if (dead.length) {
      throw new ApiError(
        409,
        `Not live: ${dead.map((r) => r.ewbNo ?? r.docNo).join(", ")}`,
        "EWB_NOT_ACTIVE"
      );
    }
    const gstins = new Set(rows.map((r) => r.fromGstin));
    if (gstins.size !== 1)
      throw new ApiError(409, "All bills on a trip sheet must be raised from the same GSTIN");
    const fromGstin = rows[0].fromGstin;
    const { provider, creds } = await eInvoiceConfigService.credentials(fromGstin);
    const request = {
      fromPlace: input.fromPlace,
      fromState: input.fromState,
      vehicleNo: input.vehicleNo,
      transMode: input.transMode,
      transDocNo: input.transDocNo ?? undefined,
      transDocDate: input.transDocDate ?? undefined,
      tripSheetEwbBills: rows.map((r) => ({ ewbNo: r.ewbNo as string })),
    };
    let result;
    try {
      result = await ewbProviderFor(provider).consolidate(request, creds);
    } catch (err) {
      throw new ApiError(502, providerMessage(err), "EWB_CONSOLIDATE_FAILED");
    }
    const sheet = await prisma.consolidatedEwayBill.create({
      data: {
        cewbNo: result.cEwbNo,
        cewbDate: result.cEwbDate,
        vehicleNo: input.vehicleNo,
        fromPlace: input.fromPlace,
        fromStateCode: String(input.fromState).padStart(2, "0"),
        transMode: input.transMode,
        transDocNo: input.transDocNo ?? null,
        ewbNos: rows.map((r) => r.ewbNo),
        request: request as object,
        response: result.raw as object,
        createdBy: actorId(actor),
      },
    });
    await prisma.ewayBill.updateMany({
      where: { id: { in: input.ewbIds } },
      data: { consolidatedNo: result.cEwbNo, vehicleNo: input.vehicleNo },
    });
    return sheet;
  }

  async get(id: string) {
    const row = await prisma.ewayBill.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "E-way bill not found");
    return row;
  }

  async list(q: z.infer<typeof listSchema>) {
    const soon = q.expiringWithinHours
      ? new Date(Date.now() + q.expiringWithinHours * 3600 * 1000)
      : null;
    return prisma.ewayBill.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(q.docType && { docType: q.docType }),
        ...(soon && { status: "ACTIVE", validUpto: { lte: soon } }),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });
  }

  async listConsolidated() {
    return prisma.consolidatedEwayBill.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  }

  /**
   * Hourly sweep for one tenant: ACTIVE bills past validity become EXPIRED; bills expiring
   * within 12 hours raise one warning each to the people who can extend them.
   */
  async sweepExpiry(now = new Date()) {
    const expired = await prisma.ewayBill.updateMany({
      where: { status: "ACTIVE", validUpto: { lt: now } },
      data: { status: "EXPIRED" },
    });
    const soon = await prisma.ewayBill.findMany({
      where: {
        status: "ACTIVE",
        validUpto: { gte: now, lte: new Date(now.getTime() + EXPIRY_WARNING_MS) },
      },
      select: {
        id: true,
        ewbNo: true,
        docNo: true,
        validUpto: true,
        updates: true,
        docType: true,
        docRef: true,
      },
    });
    let warned = 0;
    for (const b of soon) {
      const already =
        Array.isArray(b.updates) && (b.updates as Update[]).some((u) => u.kind === "EXPIRY_WARNED");
      if (already) continue;
      await notify({
        category: "eway-bill",
        level: "WARNING",
        title: `E-way bill ${b.ewbNo} expires soon`,
        body: `${b.docNo} is valid until ${b.validUpto?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Extend it within 8 hours of expiry if the goods are still moving.`,
        link: "/compliance/eway-bills?expiring=1",
        to: { permission: "eway-bill.update" },
      });
      await prisma.ewayBill.update({
        where: { id: b.id },
        data: {
          updates: appendUpdate(b.updates, {
            at: now.toISOString(),
            kind: "EXPIRY_WARNED",
            by: null,
          }),
        },
      });
      warned++;
    }
    return { expired: expired.count, warned };
  }

  /** Every active tenant, one after another (light query; no fan-out needed). */
  async sweepAllTenants() {
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let expired = 0;
    let warned = 0;
    for (const c of companies) {
      const r = await runAsTenant(c.id, () => this.sweepExpiry());
      expired += r.expired;
      warned += r.warned;
    }
    return { tenants: companies.length, expired, warned };
  }
}

const parseDdmmyyyy = (v: string): Date => {
  const [dd, mm, yyyy] = v.split("/").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd));
};

const irnRequest = (irn: string, t: EwbTransport): EwbByIrnRequest => ({
  Irn: irn,
  Distance: t.distanceKm,
  TransMode: t.transMode,
  TransId: t.transporterId ?? undefined,
  TransName: t.transporterName ?? undefined,
  TransDocDt: t.transDocDate ?? undefined,
  TransDocNo: t.transDocNo ?? undefined,
  VehNo: t.vehicleNo ?? undefined,
  VehType: t.vehicleType,
});

export const ewayBillService = new EwayBillService();
