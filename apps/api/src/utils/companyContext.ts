import { prisma } from "../config/prisma";
import { ApiError } from "./ApiError";

/**
 * Resolves the current company server-side. Never trust a companyId from the
 * client. Until P0-07 introduces the tenant context (companyId in the JWT and
 * AsyncLocalStorage), the platform runs a single company, so this is the one
 * Company row. P0-07 replaces the body with requireTenantId().
 */
export const getCurrentCompanyId = async (): Promise<string> => {
  const company = await prisma.company.findFirst({ select: { id: true } });
  if (!company) throw new ApiError(500, "No company is configured yet");
  return company.id;
};
