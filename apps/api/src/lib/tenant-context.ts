import { AsyncLocalStorage } from "node:async_hooks";
import { ApiError } from "../utils/ApiError";

/**
 * Per-request tenant context, propagated through async calls with
 * AsyncLocalStorage. Set by the auth middleware (from the JWT), by jobs
 * (`runAsTenant`) and by platform-level code (`withoutTenant`).
 */
export interface TenantContext {
  /** Tenant (companies.id). null for platform admins who have not selected a tenant. */
  companyId: string | null;
  userId?: string;
  isSuperAdmin?: boolean;
  /** Platform admin acting as this user (P1-02); recorded on every audit row. */
  impersonatedBy?: string;
  /** Skip tenant filtering: platform admin and system paths only. */
  bypass?: boolean;
  /** Already inside a tenant transaction (set_config done); do not nest. */
  inTx?: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export const getTenant = (): TenantContext | undefined => tenantStorage.getStore();

/** The current tenant id, or a 500 when code runs outside any tenant context. */
export const requireTenantId = (): string => {
  const ctx = getTenant();
  if (!ctx?.companyId) {
    throw new ApiError(500, "No tenant in context for a tenant-scoped operation");
  }
  return ctx.companyId;
};

/** Run `fn` as a specific tenant (jobs, seeds, provisioning). */
// Prisma promises are lazy: the query runs when awaited, so the await must
// happen inside the AsyncLocalStorage scope, not after `run` returns.
export const runAsTenant = <T>(
  companyId: string,
  fn: () => Promise<T>,
  extra: Partial<TenantContext> = {}
): Promise<T> =>
  tenantStorage.run({ companyId, userId: "system", ...extra }, async () => await fn());

/** Run `fn` with tenant filtering disabled (login, bootstrap, platform console). */
export const withoutTenant = <T>(fn: () => Promise<T>): Promise<T> => {
  const current = getTenant();
  return tenantStorage.run(
    {
      ...(current ?? { companyId: null, userId: "system", isSuperAdmin: true }),
      bypass: true,
      inTx: false,
    },
    async () => await fn()
  );
};
