import { prisma } from "../config/prisma";
import { requireTenantId } from "../lib/tenant-context";

/** The current tenant id from the request context. Never trust a companyId from the client. */
export const getCurrentCompanyId = async (): Promise<string> => requireTenantId();

/** The current tenant's Company row. */
export const getCurrentCompany = async () =>
  prisma.company.findUniqueOrThrow({ where: { id: requireTenantId() } });
