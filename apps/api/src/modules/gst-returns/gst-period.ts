import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";

/**
 * Return periods and the GSTINs a company files for (P1-13). A business place with its own
 * GSTIN files its own returns; documents raised from places without one roll into the
 * company's GSTIN. Period keys: `2026-08` (month), `2026-Q2`, `2026-27` (financial year).
 */
export interface GstinScope {
  gstin: string;
  /** Business places whose documents belong to this GSTIN; null means "no place / any place without its own GSTIN". */
  businessPlaceIds: (bigint | null)[];
  /** The place the filing approval is keyed on (null for the company GSTIN). */
  filingPlaceId: bigint | null;
  name: string;
  stateCode: string;
}

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const FY_RE = /^(\d{4})-(\d{2})$/;

export interface PeriodRange {
  key: string;
  from: Date;
  /** Exclusive. */
  to: Date;
  /** "MMYYYY" as the portal writes it (for a month) or the FY code. */
  fp: string;
}

export const monthRange = (key: string): PeriodRange => {
  const m = key.match(MONTH_RE);
  if (!m) throw new ApiError(400, `Period ${key} must look like 2026-08`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return {
    key,
    from: new Date(Date.UTC(y, mo - 1, 1)),
    to: new Date(Date.UTC(y, mo, 1)),
    fp: `${m[2]}${m[1]}`,
  };
};

/** Indian financial year `2026-27`: April 2026 to March 2027. */
export const fyRange = (key: string): PeriodRange => {
  const m = key.match(FY_RE);
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) {
    throw new ApiError(400, `Financial year ${key} must look like 2026-27`);
  }
  const y = Number(m[1]);
  return { key, from: new Date(Date.UTC(y, 3, 1)), to: new Date(Date.UTC(y + 1, 3, 1)), fp: key };
};

export const gstinScopes = async (): Promise<GstinScope[]> => {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: requireTenantId() } });
  const places = await prisma.businessPlace.findMany({ where: { isActive: true } });
  const own = places.filter((p) => p.gstin);
  const scopes: GstinScope[] = [];
  if (company.gstin) {
    const rest = places.filter((p) => !p.gstin).map((p) => p.id);
    scopes.push({
      gstin: company.gstin,
      businessPlaceIds: [null, ...rest],
      filingPlaceId: null,
      name: company.legalName ?? company.companyName,
      stateCode: company.gstin.slice(0, 2),
    });
  }
  for (const p of own) {
    if (p.gstin === company.gstin) {
      const c = scopes.find((s) => s.gstin === p.gstin);
      if (c) c.businessPlaceIds.push(p.id);
      continue;
    }
    scopes.push({
      gstin: p.gstin as string,
      businessPlaceIds: [p.id],
      filingPlaceId: p.id,
      name: p.name,
      stateCode: (p.gstin as string).slice(0, 2),
    });
  }
  if (scopes.length === 0)
    throw new ApiError(409, "The company has no GSTIN; GST returns need one", "NO_GSTIN");
  return scopes;
};

export const scopeFor = async (gstin?: string | null): Promise<GstinScope> => {
  const scopes = await gstinScopes();
  if (!gstin) return scopes[0];
  const s = scopes.find((x) => x.gstin === gstin.toUpperCase());
  if (!s) throw new ApiError(404, `GSTIN ${gstin} is not one of this company's registrations`);
  return s;
};

/** Prisma filter for "documents of this GSTIN". */
export const placeFilter = (scope: GstinScope) => {
  const ids = scope.businessPlaceIds.filter((x): x is bigint => x !== null);
  const includesNull = scope.businessPlaceIds.includes(null);
  if (includesNull && ids.length === 0) return { businessPlaceId: null };
  if (!includesNull) return { businessPlaceId: { in: ids } };
  return { OR: [{ businessPlaceId: null }, { businessPlaceId: { in: ids } }] };
};
