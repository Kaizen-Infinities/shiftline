/**
 * GST masters (P1-08a): HSN/SAC codes with default rates, GST slabs, GSTIN
 * validation and the state table. Seeded per tenant by `ensureGstMasters()`.
 */
import { GST_STATES, GST_STATE_BY_CODE, isValidGstin } from "@shiftline/shared";
import { Prisma, type HsnType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { GST_SLABS, HSN_STARTER } from "./hsn-starter";

export interface HsnInput {
  code: string;
  type?: HsnType;
  description: string;
  gstRate: number;
  cessRate?: number;
  isActive?: boolean;
}

export interface GstRateInput {
  name: string;
  rate: number;
  cessRate?: number;
  isActive?: boolean;
}

/** Entity-type letter of a GSTIN (6th character): C company, P person, F firm, and so on. */
const ENTITY_TYPES: Record<string, string> = {
  C: "Company",
  P: "Individual / proprietor",
  H: "HUF",
  F: "Firm",
  A: "Association of persons",
  T: "Trust",
  B: "Body of individuals",
  L: "Local authority",
  J: "Artificial juridical person",
  G: "Government",
};

class GstService {
  // ─── Seed ───────────────────────────────────────────────────────────────────

  /** Idempotent per tenant: slabs and the starter HSN list; existing rows keep tenant edits. */
  async ensureGstMasters() {
    const companyId = requireTenantId();
    for (const slab of GST_SLABS) {
      await prisma.gstRate.upsert({
        where: { companyId_rate_cessRate: { companyId, rate: slab.rate, cessRate: 0 } },
        update: {},
        create: { name: slab.name, rate: slab.rate, cessRate: 0 },
      });
    }
    const existing = new Set(
      (await prisma.hsnCode.findMany({ select: { code: true } })).map((h) => h.code)
    );
    const missing = HSN_STARTER.filter((h) => !existing.has(h.code));
    if (missing.length) {
      await prisma.hsnCode.createMany({
        data: missing.map((h) => ({
          code: h.code,
          type: h.type,
          description: h.description,
          gstRate: h.gstRate,
          cessRate: h.cessRate ?? 0,
        })),
      });
    }
  }

  // ─── Reference data ─────────────────────────────────────────────────────────

  states() {
    return GST_STATES;
  }

  /** Format, state and check-digit validation plus what can be read off a GSTIN. */
  validateGstin(raw: string) {
    const gstin = raw.trim().toUpperCase();
    const valid = isValidGstin(gstin);
    const stateCode = valid ? gstin.slice(0, 2) : null;
    return {
      gstin,
      valid,
      stateCode,
      stateName: stateCode ? (GST_STATE_BY_CODE.get(stateCode)?.name ?? null) : null,
      pan: valid ? gstin.slice(2, 12) : null,
      entityType: valid ? (ENTITY_TYPES[gstin[5]] ?? "Other") : null,
      registrationCount: valid ? gstin[12] : null,
    };
  }

  // ─── GST slabs ──────────────────────────────────────────────────────────────

  listRates(includeInactive = false) {
    return prisma.gstRate.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ rate: "asc" }, { cessRate: "asc" }],
    });
  }

  async createRate(input: GstRateInput) {
    const companyId = requireTenantId();
    const clash = await prisma.gstRate.findUnique({
      where: {
        companyId_rate_cessRate: { companyId, rate: input.rate, cessRate: input.cessRate ?? 0 },
      },
    });
    if (clash) throw new ApiError(409, "A slab with this rate and cess already exists");
    return prisma.gstRate.create({
      data: {
        name: input.name,
        rate: input.rate,
        cessRate: input.cessRate ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateRate(id: string, input: Partial<GstRateInput>) {
    const row = await prisma.gstRate.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "GST slab not found");
    return prisma.gstRate.update({ where: { id }, data: input });
  }

  async deleteRate(id: string) {
    const row = await prisma.gstRate.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "GST slab not found");
    // Slabs are referenced by value on documents, so a delete is a soft deactivation.
    return prisma.gstRate.update({ where: { id }, data: { isActive: false } });
  }

  // ─── HSN / SAC ──────────────────────────────────────────────────────────────

  async listHsn(params: {
    search?: string;
    type?: HsnType;
    includeInactive?: boolean;
    limit?: number;
  }) {
    const where: Prisma.HsnCodeWhereInput = {
      ...(params.includeInactive ? {} : { isActive: true }),
      ...(params.type ? { type: params.type } : {}),
      ...(params.search
        ? {
            OR: [
              { code: { startsWith: params.search.trim() } },
              { description: { contains: params.search.trim(), mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return prisma.hsnCode.findMany({
      where,
      orderBy: [{ code: "asc" }],
      take: Math.min(params.limit ?? 50, 500),
      include: { _count: { select: { products: true, rawMaterials: true } } },
    });
  }

  async lookupHsn(code: string) {
    const exact = await prisma.hsnCode.findFirst({ where: { code: code.trim() } });
    if (exact) return exact;
    // A longer code inherits the rate of its chapter/heading prefix (8 → 6 → 4 digits).
    for (const len of [6, 4]) {
      if (code.length > len) {
        const parent = await prisma.hsnCode.findFirst({ where: { code: code.slice(0, len) } });
        if (parent) return parent;
      }
    }
    throw new ApiError(404, `No HSN/SAC ${code} in your master`);
  }

  async createHsn(input: HsnInput) {
    const code = input.code.trim();
    if (!/^\d{4}(\d{2})?(\d{2})?$/.test(code)) {
      throw new ApiError(400, "HSN/SAC codes are 4, 6 or 8 digits");
    }
    const companyId = requireTenantId();
    if (await prisma.hsnCode.findUnique({ where: { companyId_code: { companyId, code } } })) {
      throw new ApiError(409, `HSN/SAC ${code} already exists`);
    }
    return prisma.hsnCode.create({
      data: {
        code,
        type: input.type ?? (code.startsWith("99") ? "SAC" : "HSN"),
        description: input.description.trim(),
        gstRate: input.gstRate,
        cessRate: input.cessRate ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateHsn(id: string, input: Partial<HsnInput>) {
    const row = await prisma.hsnCode.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "HSN/SAC not found");
    const { code: _code, ...rest } = input; // the code is the identity; create a new row to change it
    return prisma.hsnCode.update({ where: { id }, data: rest });
  }

  async deleteHsn(id: string) {
    const row = await prisma.hsnCode.findUnique({
      where: { id },
      include: { _count: { select: { products: true, rawMaterials: true } } },
    });
    if (!row) throw new ApiError(404, "HSN/SAC not found");
    if (row._count.products + row._count.rawMaterials > 0) {
      return prisma.hsnCode.update({ where: { id }, data: { isActive: false } });
    }
    return prisma.hsnCode.delete({ where: { id } });
  }

  /** Effective GST rate for an item: its own override, else its HSN default, else the fallback. */
  async rateForItem(
    item: { gstRate: Prisma.Decimal | number | null; hsnCodeId: string | null },
    fallback = 0
  ) {
    if (item.gstRate !== null && item.gstRate !== undefined) return Number(item.gstRate);
    if (item.hsnCodeId) {
      const hsn = await prisma.hsnCode.findUnique({ where: { id: item.hsnCodeId } });
      if (hsn) return Number(hsn.gstRate);
    }
    return fallback;
  }
}

export const gstService = new GstService();
