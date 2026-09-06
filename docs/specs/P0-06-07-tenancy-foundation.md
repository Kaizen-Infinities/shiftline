# P0-06 / P0-07 — Schema remaster and tenant context (F3 parts 1–2)

**Goal.** Every tenant row carries `companyId`; every query is scoped to the caller's
tenant without service code having to remember; the database itself knows the tenant of
the current transaction so defaults (and, in P0-08, row-level security) can rely on it.

**Schema (`apps/api/prisma/schema.prisma`, migration `20260906210525_init`).**

- 86 tenant models gain `companyId String @default(dbgenerated("current_setting('app.company_id')::uuid")) @db.Uuid`
  with an FK to `companies` (`onDelete: Restrict`) and an index. Global models: `Company`,
  `Admin`, `Permission`, `UserSession`, `PasswordResetToken`, `LoginAttempt`. `AuditLog.companyId`
  is nullable (platform events).
- 44 business-key uniques became `@@unique([companyId, key])` (product codes, order and
  voucher numbers, ledger codes, employee identifiers, UoM and category codes, …).
  Compound uniques on machine/shift/date tables gained a `companyId` prefix. Kept global:
  `User.username`, `User.email` (login resolves the tenant from the user), `Shift.shiftCode`
  (referenced by relations), one-to-one FKs.
- New: `DocumentSequence`; the five mobile models (`MobileVisit`, `MobileCollection`,
  `MobileRouteCustomer`, `MobileRouteAssignment`, `MobileSyncRecord`) with tombstones and
  device fields; `AuditLog.requestId/actorType/impersonatedBy`.
- Deferred to P1-00: surrogate uuid keys for the seven code-keyed models (`Location`, `Machine`,
  `Store`, `RawMaterial`, `ProductionOrder`, `WeeklyMachineProgram`, `DailyProductionPlan`).
  Composite foreign keys would need `companyId` alongside optional FK columns, which Prisma
  rejects. Until then those codes are unique across tenants (Gate 1 blocker, tracked).

**Tenant context (`apps/api/src/lib/tenant-context.ts`).** AsyncLocalStorage with
`getTenant`, `requireTenantId`, `runAsTenant` (jobs, seeds), `withoutTenant` (login,
platform paths). Callbacks are awaited inside the scope because Prisma promises are lazy.

**Scoped client (`apps/api/src/lib/prisma.ts`).** One `PrismaClient` extended with a
`$allOperations` hook: for tenant models it injects `companyId` into `where` (reads, updates,
deletes, unique lookups) and into `data` (creates), and runs the operation in a batch
transaction that first executes `set_config('app.company_id', <tenant>, true)`. Interactive
transactions set the tenant once and mark the scope `inTx`. Batch-array transactions are
rejected. Without a tenant context, tenant operations throw a 500. `TENANT_MODELS` is derived
from the DMMF so new models are scoped automatically.

**Auth.** `AccessTokenPayload.companyId`; login, password reset and the middleware's session
and account lookups run `withoutTenant`; the middleware then runs the request inside
`tenantStorage.run({ companyId, userId, isSuperAdmin })`. Platform admins pick a tenant
with `X-Company-Id` (validated). The platform admin no longer has a tenant role.

**Call-site changes.** `prisma.company.findFirst()` → current tenant (`requireTenantId`);
`findUnique` by tenant-scoped code → `findFirst`; upserts by code → compound key;
scheduler runs per active tenant; seed runs inside `runAsTenant`; WhatsApp webhook resolves
the tenant from the verify token / phone number id.

**Done when.** `prisma migrate deploy` builds an empty database; all suites green incl.
`test/integration/tenancy.spec.ts` (two tenants, defaults on nested creates, no-context
failure, id lookups scoped, transactions scoped).
