import { Prisma, PrismaClient } from "@prisma/client";
import { ApiError } from "../utils/ApiError";
import { getTenant, tenantStorage, type TenantContext } from "./tenant-context";

/**
 * The one Prisma client. A query extension scopes every operation on a tenant
 * model to the current tenant (from AsyncLocalStorage) and runs it in a
 * transaction that first sets `app.company_id`, which the database uses for
 * the `company_id` column default and, from P0-08, for row-level security.
 *
 * Rules:
 *  - `new PrismaClient()` anywhere else is a lint error.
 *  - Code without a tenant context that touches a tenant model throws; use
 *    `runAsTenant` (jobs) or `withoutTenant` (login, platform admin).
 *  - Batch `$transaction([...])` is not supported; use the interactive form.
 */

const base = new PrismaClient({
  transactionOptions: { maxWait: 10_000, timeout: 30_000 },
});

const GLOBAL_MODELS = new Set([
  "Company",
  "Admin",
  "Permission",
  "UserSession",
  "PasswordResetToken",
  "LoginAttempt",
]);

const modelHasCompanyId = (name: string): boolean => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
  return !!model?.fields.some((f) => f.name === "companyId");
};

/** Models scoped by companyId, derived from the schema so a new model is scoped automatically. */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => !GLOBAL_MODELS.has(m.name) && modelHasCompanyId(m.name))
    .map((m) => m.name)
);

const FILTER_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);
const UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

const withCompany = (data: any, companyId: string) =>
  data && typeof data === "object" && !Array.isArray(data) && data.companyId === undefined
    ? { ...data, companyId }
    : data;

/** Adds the tenant predicate / default to Prisma args for one operation. */
export const scopeArgs = (operation: string, args: any, companyId: string): any => {
  const a = { ...(args ?? {}) };
  if (FILTER_OPS.has(operation)) {
    a.where = a.where ? { AND: [a.where, { companyId }] } : { companyId };
  } else if (UNIQUE_OPS.has(operation)) {
    // Prisma 5+ accepts extra filters next to the unique key (extendedWhereUnique).
    a.where = { ...(a.where ?? {}), companyId };
    if (operation === "upsert") a.create = withCompany(a.create, companyId);
  } else if (operation === "create") {
    a.data = withCompany(a.data, companyId);
  } else if (operation === "createMany" || operation === "createManyAndReturn") {
    a.data = Array.isArray(a.data)
      ? a.data.map((d: any) => withCompany(d, companyId))
      : withCompany(a.data, companyId);
  }
  return a;
};

const extended = base.$extends({
  name: "tenantScope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = getTenant();
        if (!TENANT_MODELS.has(model) || ctx?.bypass) {
          return query(args);
        }
        if (!ctx?.companyId) {
          throw new ApiError(500, `Tenant-scoped ${operation} on ${model} without tenant context`);
        }
        const scoped = scopeArgs(operation, args, ctx.companyId);
        if (ctx.inTx) {
          return query(scoped); // set_config already ran in this transaction
        }
        const [, result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, TRUE)`,
          query(scoped),
        ]);
        return result;
      },
    },
  },
});

async function tenantTransaction(arg: unknown, opts?: unknown): Promise<unknown> {
  if (typeof arg !== "function") {
    throw new Error(
      "Batch $transaction([...]) is not supported; use $transaction(async (tx) => { ... })"
    );
  }
  const ctx = getTenant();
  return extended.$transaction(async (tx) => {
    if (ctx?.companyId && !ctx.bypass) {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, TRUE)`;
    }
    const inner: TenantContext = { ...(ctx ?? { companyId: null }), inTx: true };
    return tenantStorage.run(
      inner,
      async () => await (arg as (tx: unknown) => Promise<unknown>)(tx)
    );
  }, opts as never);
}

/**
 * The application client. Interactive transactions set the tenant once for the
 * whole transaction. Typed as PrismaClient: the extension adds no members, and
 * the extended generic type is too heavy for the services' `PrismaClient |
 * TransactionClient` parameters.
 */
export const prisma = new Proxy(extended, {
  get(target, prop) {
    if (prop === "$transaction") return tenantTransaction;
    return Reflect.get(target, prop);
  },
}) as unknown as PrismaClient;

export type Db = PrismaClient | Prisma.TransactionClient;
