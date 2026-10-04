# P2-00 — Shop-floor foundation (conventions shared by P2-01 … P2-12)

Read this once at the start of Phase 2, then read only the one package spec you are building. These
conventions are stated here so the twelve package specs stay at half a page and never contradict
each other.

## What already exists on the shop floor

Build on these; do not duplicate them.

- **Planning chain:** `ProductionOrder` → `WeeklyMachineProgram` → `DailyProductionPlan` →
  `HourlyProduction`. `HourlyProduction` is unique per `(companyId, productionDate, machineId,
shiftId, hourIndex)` and already carries `qtyProduced`, `rejectQty`, `scrapQty`, `downtime`,
  `runtimeMinutes`, `operatorId` and three free-text reason columns.
- **`Machine`** with `machineId` (business code, `@@unique([companyId, machineId])`), `cycleTime`
  (ideal seconds per piece), `technologyType`, and `machineStatus` — a single mutable enum column
  (`IDLE, RUNNING, BREAKDOWN, MAINTENANCE, MATERIAL_WAITING, SETUP`) with **no history table and no
  transition endpoint**. P2-02 adds both.
- **`MachineOeeSnapshot`** per machine per date per shift, and `modules/oee/oee.service.ts` which
  computes performance from `Machine.cycleTime`.
- **`ProductionWastage`** with the `WastageType` enum and an approval status.
- **`StoreLocation`** — hierarchical bins with `parentId`, `locationCode`, `locationType` and
  capacity — already modelled. P2-08 uses it; do not build a second location tree.
- **TV dashboard** at `/tv-dashboard` with five rotating scenes in
  `apps/web/src/modules/dashboard/tv/scenes/`. P2-02's andon is a sixth scene, not a new app.
- **`AttendanceRecord`**, manual entry only, keyed `@@unique([employeeId, date])`.

**There is no mould or tooling module.** The backlog says "apply the mould module's pattern to
machines"; that module belongs to the origin codebase and was never ported. Every `mould` hit here
is an enum value, a hard-coded dropdown string, or `mouldReference` — a web-only orphan field in
`apps/web/src/features/product/types.ts` with no column on the Prisma `Product` model. Do not go
looking for it.

## Reason-code masters

Reasons today are free-text `VarChar(100)` columns plus hard-coded arrays in the web components.
Every Phase-2 reason master follows one shape: code unique per tenant
(`@@unique([companyId, code])`), label, an optional parent for grouping, a category enum, `isActive`,
and retirement instead of deletion. Existing free-text columns are **kept** and backfilled to the
matching code where one can be inferred; the new foreign key is added alongside and nullable, so no
historical row is lost. Seed the starter set through
`apps/api/src/modules/platform/provisioning.service.ts`, not a migration, so every new tenant gets
it and an existing tenant can edit it.

## Telemetry write path (P2-01, P2-03 — read this before writing ingest)

`apps/api/src/lib/prisma.ts` wraps **every** query in its own transaction to set `app.company_id`.
A press emitting at seconds cadence cannot have one transaction per sample. The two obvious
shortcuts are both banned:

- CI fails the build on `SET (SESSION )?app\.` anywhere in `apps/api/src`. Session settings are
  written only by `lib/prisma.ts`, with `set_config(..., true)`.
- `prisma.$transaction([...])` array form throws by design.

The supported shape: accumulate samples in memory per machine and flush one batch per interval
inside `runAsTenant(companyId, () => prisma.$transaction(async (tx) => { ... }))`. The interactive
form sets the session settings once and marks the context `inTx`, so the inner `createMany` does not
re-wrap. Read through `tx` inside the transaction — the outer client does not carry tenant settings
there.

Raw sample tables are **not** added to `AUDITED_MODELS` — an audit trigger per sample would be
pathological. State spans, cycles, inspection results and every master **are** audited. Raw samples
get a retention class: add the value to the `RetentionDataClass` Prisma enum (a migration) and a
spec to `RETENTION_CLASSES` in `apps/api/src/modules/retention/retention.policy.ts` with a short
floor and `purgeable: true` — they are operational data, not books.

## Protocol and device adapters

Any machine, meter or biometric device is reached through an adapter interface with a fixture or
simulator implementation, exactly as `apps/api/src/modules/e-invoice/providers/` does it:
`index.ts` exports a `PROVIDERS` tuple and a `providerFor(name)` factory; the fixture is
deterministic and refuses what the real device refuses; the live adapter is written but marked
unpinned until it meets hardware. Device credentials are encrypted with `encryptText`
(`apps/api/src/utils/crypto.ts`) and config services return `hasSecret: boolean`, never the value.

**No Phase-2 package may block on hardware.** Every acceptance test runs against the simulator.

## Realtime

Emit only through `emitToTenant` from `apps/api/src/lib/realtime.ts`, from the controller, named
`<camelCaseEntity>:<created|updated|deleted>`. Shop-floor state changes add
`machineState:changed`, `andon:raised`, `andon:cleared`. Emits with no tenant in scope are dropped,
never broadcast.

## Module and web shape

- Backend: `apps/api/src/modules/<name>/` with `<name>.routes.ts`, `<name>.service.ts` (zod schemas
  exported from here, as `e-invoice` and `eway-bill` do — not a `.validation.ts`), `<name>.types.ts`,
  and `providers/` where there is a device. Mount in `apps/api/src/routes/index.routes.ts`.
  `authMiddleware` on the router, `requirePermission` on every route.
- Web: Tailwind via `apps/web/src/components/ui/TailwindPrimitives.tsx`; an axios service in
  `apps/web/src/services/` plus a `createAsyncThunk` slice in `apps/web/src/features/`. That is the
  dominant pattern — the only injected RTK-Query slice is `features/auth/authApi.ts`. Do not
  introduce a third pattern.

## Features and roles

Two new feature keys in `packages/shared/src/features.ts`: **`shop-floor`** (P2-01 … P2-05, P2-11,
P2-12 modules) and **`quality`** (P2-06 … P2-10). Add `shop-floor` to the `GROWTH` plan; leave
`quality` on `ENTERPRISE` only; `STARTER` gets neither. `ENTERPRISE` picks both up automatically
because its `features` is `FEATURE_KEYS`. Grant keys in `ROLE_DEFS`
(`apps/api/src/modules/platform/provisioning.service.ts`) — shop-floor keys to OWNER and PRODUCTION,
quality keys to OWNER, PRODUCTION and STORES, read-only to AUDITOR.
