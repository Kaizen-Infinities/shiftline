/**
 * Where a document is issued from and who it goes to, for GST (P1-08b).
 * Resolves the issuing business place (payload → head office → company), the
 * company's registration profile, and the HSN defaults of the items on a line.
 */
import type { Prisma, SupplyType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { supplyTypeFor } from "./gst.calc";

type Db = Prisma.TransactionClient | typeof prisma;

export interface IssuingPlace {
  id: bigint | null;
  /** GST state code the supply is made from. */
  stateCode: string | null;
  gstin: string | null;
}

export interface CompanyGstProfile {
  registrationType: string;
  stateCode: string | null;
  gstin: string | null;
}

export const companyGstProfile = async (db: Db = prisma): Promise<CompanyGstProfile> => {
  const company = await db.company.findUnique({
    where: { id: requireTenantId() },
    select: { gstRegistrationType: true, stateCode: true, gstin: true },
  });
  if (!company) throw new ApiError(404, "Company not found");
  return {
    registrationType: company.gstRegistrationType,
    stateCode: company.stateCode ?? (company.gstin ? company.gstin.slice(0, 2) : null),
    gstin: company.gstin ?? null,
  };
};

const toBigInt = (v: unknown): bigint | null => {
  if (v === null || v === undefined || v === "") return null;
  try {
    return BigInt(String(v));
  } catch {
    throw new ApiError(400, "businessPlaceId must be a whole number");
  }
};

/**
 * The place a document is raised from. An explicit id must exist and be active;
 * otherwise the head office, else the first active place, else the company itself.
 */
export const resolveIssuingPlace = async (
  businessPlaceId: unknown,
  profile: CompanyGstProfile,
  db: Db = prisma
): Promise<IssuingPlace> => {
  const wanted = toBigInt(businessPlaceId);
  let place = wanted
    ? await db.businessPlace.findFirst({ where: { id: wanted, isActive: true } })
    : null;
  if (wanted && !place) throw new ApiError(404, "Business place not found");
  if (!place) {
    place =
      (await db.businessPlace.findFirst({ where: { isHeadOffice: true, isActive: true } })) ??
      (await db.businessPlace.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } }));
  }
  if (!place) return { id: null, stateCode: profile.stateCode, gstin: profile.gstin };
  const stateCode = place.gstPlaceCode || (place.gstin ? place.gstin.slice(0, 2) : null);
  return {
    id: place.id,
    stateCode: stateCode || profile.stateCode,
    gstin: place.gstin || (place.isHeadOffice ? profile.gstin : null),
  };
};

export interface ItemTaxDefaults {
  hsnCode: string | null;
  gstRate: number | null;
  cessRate: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const defaultsOf = (item: {
  gstRate: Prisma.Decimal | number | null;
  hsnCode: { code: string; gstRate: Prisma.Decimal; cessRate: Prisma.Decimal } | null;
}): ItemTaxDefaults => ({
  hsnCode: item.hsnCode?.code ?? null,
  gstRate:
    item.gstRate !== null && item.gstRate !== undefined
      ? Number(item.gstRate)
      : item.hsnCode
        ? Number(item.hsnCode.gstRate)
        : null,
  cessRate: item.hsnCode ? Number(item.hsnCode.cessRate) : 0,
});

/** HSN and rate defaults for finished products, keyed by product id. */
export const productTaxDefaults = async (
  productIds: (bigint | number | string)[],
  db: Db = prisma
): Promise<Map<string, ItemTaxDefaults>> => {
  const ids = [...new Set(productIds.map((id) => BigInt(id)))];
  if (!ids.length) return new Map();
  const rows = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      gstRate: true,
      hsnCode: { select: { code: true, gstRate: true, cessRate: true } },
    },
  });
  return new Map(rows.map((r) => [r.id.toString(), defaultsOf(r)]));
};

/**
 * HSN and rate for a sales product (kit), keyed by sales product id. A sales product carries no
 * HSN or rate of its own: it is assembled from component products, so its tax is the components'
 * tax, and only when they agree. Components that disagree, or a kit with none, resolve to nothing
 * and the sale is refused at confirmation rather than taxed at a guessed rate.
 */
export const salesProductTaxDefaults = async (
  salesProductIds: (bigint | number | string)[],
  db: Db = prisma
): Promise<Map<string, ItemTaxDefaults>> => {
  const ids = [...new Set(salesProductIds.map((id) => BigInt(id)))];
  if (!ids.length) return new Map();
  const rows = await db.salesProduct.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      components: {
        select: {
          componentProduct: {
            select: {
              gstRate: true,
              hsnCode: { select: { code: true, gstRate: true, cessRate: true } },
            },
          },
        },
      },
    },
  });
  const unresolved: ItemTaxDefaults = { hsnCode: null, gstRate: null, cessRate: 0 };
  return new Map(
    rows.map((row) => {
      const parts = row.components.map((c) => defaultsOf(c.componentProduct));
      const first = parts[0];
      const agree = (pick: (d: ItemTaxDefaults) => unknown) =>
        parts.length > 0 && parts.every((d) => pick(d) === pick(first));
      if (!first) return [row.id.toString(), unresolved];
      const hsnCode = agree((d) => d.hsnCode) ? first.hsnCode : null;
      const gstRate = agree((d) => d.gstRate) ? first.gstRate : null;
      const cessRate = agree((d) => d.cessRate) ? first.cessRate : 0;
      return [row.id.toString(), { hsnCode, gstRate, cessRate }];
    })
  );
};

/** HSN and rate defaults for raw materials, keyed by material code. */
export const rawMaterialTaxDefaults = async (
  codes: string[],
  db: Db = prisma
): Promise<Map<string, ItemTaxDefaults>> => {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.rawMaterial.findMany({
    where: { rawMaterialId: { in: unique } },
    select: {
      rawMaterialId: true,
      gstRate: true,
      hsnCode: { select: { code: true, gstRate: true, cessRate: true } },
    },
  });
  return new Map(rows.map((r) => [r.rawMaterialId, defaultsOf(r)]));
};

/** Cess on a taxable value, rounded to the paisa. */
export const cessOn = (taxable: number, cessRate: number) => round2((taxable * cessRate) / 100);

/** The state code embedded in a GSTIN, or null. */
export const stateOfGstin = (gstin: string | null | undefined): string | null =>
  gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;

/** GST facts for an inward supply (P1-08b): the supplier's state against the receiving place. */
export interface PurchaseGstContext {
  place: IssuingPlace;
  supplyType: SupplyType;
  /** For an inward supply the place of supply is where we receive the goods. */
  placeOfSupply: string | null;
  reverseCharge: boolean;
  /** False for a composition or unregistered supplier, unless we pay the tax under reverse charge. */
  chargeable: boolean;
}

export const purchaseGstContext = async (
  db: Db,
  data: { businessPlaceId?: unknown; reverseCharge?: boolean | null },
  supplier: { stateCode: string | null; gstRegType: string | null; gstin: string | null }
): Promise<PurchaseGstContext> => {
  const profile = await companyGstProfile(db);
  const place = await resolveIssuingPlace(data.businessPlaceId, profile, db);
  const reverseCharge = Boolean(data.reverseCharge);
  const registration = supplier.gstRegType ?? (supplier.gstin ? "REGULAR" : "UNREGISTERED");
  // A supplier with no state code and no GSTIN is treated as local, as on the sales side.
  const supplierState = supplier.stateCode || stateOfGstin(supplier.gstin) || place.stateCode;
  const supplyType = supplyTypeFor({
    fromStateCode: supplierState,
    toStateCode: place.stateCode,
    partyRegistration: registration === "SEZ" ? "SEZ" : null,
  });
  const chargeable =
    reverseCharge ||
    registration === "REGULAR" ||
    registration === "SEZ" ||
    registration === "OVERSEAS";
  return { place, supplyType, placeOfSupply: place.stateCode, reverseCharge, chargeable };
};
