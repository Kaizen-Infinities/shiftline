import { Prisma, PrismaClient } from "@prisma/client";
import { ApiError } from "../utils/ApiError";
import { getRequestId } from "./request-context";
import { getTenant, requireTenantId, tenantStorage, type TenantContext } from "./tenant-context";

/**
 * The one Prisma client. A query extension scopes every operation on a tenant
 * model to the current tenant (from AsyncLocalStorage) and runs it in a
 * transaction that first sets `app.company_id`, which the database uses for
 * the `company_id` column default and, from P0-08, for row-level security.
 *
 * Row-level security (migration 20260906220000_enable_rls) enforces the same
 * boundary in the database: tenant rows are visible only when app.company_id
 * matches, or when app.bypass_rls is on (platform paths via withoutTenant).
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

/**
 * Models whose business code is unique per tenant, not globally (P1-00f). Their
 * primary key is a uuid; the code plus companyId is a `@@unique`, so
 * `where: { storeId }` alone is no longer a unique selector. The extension
 * rewrites such selectors to the composite key at runtime and `byCode()` does the
 * same for the type checker.
 */
export const CODE_KEYS = {
  Store: "storeId",
  Machine: "machineId",
  RawMaterial: "rawMaterialId",
  ProductionOrder: "productionOrderId",
  WeeklyMachineProgram: "weeklyProgramId",
  DailyProductionPlan: "dailyPlanId",
  Location: "locationId",
  Shift: "shiftCode",
} as const;

type CodeKeyWhere = {
  storeId: Prisma.StoreWhereUniqueInput;
  machineId: Prisma.MachineWhereUniqueInput;
  rawMaterialId: Prisma.RawMaterialWhereUniqueInput;
  productionOrderId: Prisma.ProductionOrderWhereUniqueInput;
  weeklyProgramId: Prisma.WeeklyMachineProgramWhereUniqueInput;
  dailyPlanId: Prisma.DailyProductionPlanWhereUniqueInput;
  locationId: Prisma.LocationWhereUniqueInput;
  shiftCode: Prisma.ShiftWhereUniqueInput;
};

/**
 * Unique selector for a code-keyed model in the current tenant:
 * `prisma.store.findUnique({ where: byCode("storeId", "ST-RM") })`.
 */
export function byCode<K extends keyof CodeKeyWhere>(field: K, value: string): CodeKeyWhere[K] {
  return {
    [`companyId_${field}`]: { companyId: requireTenantId(), [field]: value },
  } as unknown as CodeKeyWhere[K];
}

/** `{ storeId: "X" }` → `{ companyId_storeId: { companyId, storeId: "X" } }` for unique operations. */
const compositeCodeWhere = (model: string, where: any, companyId: string): any => {
  const code = (CODE_KEYS as Record<string, string>)[model];
  if (!code || !where || typeof where !== "object") return where;
  const value = where[code];
  if (typeof value !== "string" || where.id !== undefined || where[`companyId_${code}`])
    return where;
  const { [code]: _drop, ...rest } = where;
  return { ...rest, [`companyId_${code}`]: { companyId, [code]: value } };
};

const withCompany = (data: any, companyId: string) =>
  data && typeof data === "object" && !Array.isArray(data) && data.companyId === undefined
    ? { ...data, companyId }
    : data;

/** Adds the tenant predicate / default to Prisma args for one operation. */
export const scopeArgs = (operation: string, args: any, companyId: string, model = ""): any => {
  const a = { ...(args ?? {}) };
  if (FILTER_OPS.has(operation)) {
    a.where = a.where ? { AND: [a.where, { companyId }] } : { companyId };
  } else if (UNIQUE_OPS.has(operation)) {
    // Prisma 5+ accepts extra filters next to the unique key (extendedWhereUnique).
    a.where = { ...compositeCodeWhere(model, a.where ?? {}, companyId), companyId };
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

/**
 * One statement that sets every transaction-local variable the row-level
 * security policies and the audit triggers read: tenant, bypass flag, actor
 * (user or platform admin), request id and impersonator. `TRUE` scopes each
 * value to the current transaction, so nothing leaks between pooled connections.
 */
function sessionSettings(ctx: TenantContext | undefined, mode: "tenant" | "bypass"): Prisma.Sql {
  const requestId = getRequestId() ?? "";
  const userId = ctx?.userId && ctx.userId !== "system" ? ctx.userId : "";
  const isAdmin = userId.startsWith("admin_");
  const adminId = isAdmin ? userId.slice("admin_".length) : "";
  const actor = !userId ? "system" : isAdmin ? "admin" : "user";
  const companyId = mode === "tenant" ? (ctx?.companyId ?? "") : "";
  const bypass = mode === "bypass" ? "on" : "off";
  return Prisma.sql`SELECT
    set_config('app.company_id', ${companyId}, TRUE),
    set_config('app.bypass_rls', ${bypass}, TRUE),
    set_config('app.user_id', ${isAdmin ? "" : userId}, TRUE),
    set_config('app.admin_id', ${adminId}, TRUE),
    set_config('app.actor_type', ${actor}, TRUE),
    set_config('app.request_id', ${requestId}, TRUE),
    set_config('app.impersonated_by', ${ctx?.impersonatedBy ?? ""}, TRUE)`;
}

const extended = base.$extends({
  name: "tenantScope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = getTenant();
        if (!TENANT_MODELS.has(model)) {
          // Global tables carry no tenant, but their audit rows still need the actor.
          if (ctx?.inTx || !ctx?.userId || ctx.userId === "system") return query(args);
          const [, result] = await base.$transaction([
            base.$executeRaw(sessionSettings(ctx, ctx.bypass ? "bypass" : "tenant")),
            query(args),
          ]);
          return result;
        }
        if (ctx?.bypass) {
          if (ctx.inTx) return query(args);
          // Platform / system path: row-level security is lifted for this transaction only.
          const [, result] = await base.$transaction([
            base.$executeRaw(sessionSettings(ctx, "bypass")),
            query(args),
          ]);
          return result;
        }
        if (!ctx?.companyId) {
          throw new ApiError(500, `Tenant-scoped ${operation} on ${model} without tenant context`);
        }
        const scoped = scopeArgs(operation, args, ctx.companyId, model);
        if (ctx.inTx) {
          return query(scoped); // set_config already ran in this transaction
        }
        const [, result] = await base.$transaction([
          base.$executeRaw(sessionSettings(ctx, "tenant")),
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
    if (ctx?.bypass) {
      await tx.$executeRaw(sessionSettings(ctx, "bypass"));
    } else if (ctx?.companyId) {
      await tx.$executeRaw(sessionSettings(ctx, "tenant"));
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
