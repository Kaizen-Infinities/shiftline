# Commission: Phase 2 — shop floor, quality and change control

You are taking over an in-progress remaster. Read this whole brief before touching code.

## Where this sits

Phase 1 is finished — `docs/handoff/2026-09-12-phase-1-complete.md` is its map. Everything this
phase builds on top of exists: valuation and the cost sheet (`modules/costing`), statutory payroll
and the Labour Code entitlements (`modules/payroll`), the filing gate, GST returns, TDS, fixed
assets and bank reconciliation.

Phase 2-T (`docs/handoff/2026-09-13-commission-phase-2-transition.md`) runs between the two and
closes the gaps the completion note carried over: the pg-boss jobs that were never written, the
Labour Code wage rules not yet wired into the payroll run, the inspector's registers, the frontend
remake slices 2–7, and — most important to this phase — **characterisation tests for the eight
untested modules Phase 2 is about to modify.**

Confirm Phase 2-T is closed before package 1. If the owner directs otherwise, say plainly in your
first hand-off note what was missing and what you assumed. The one thing not to skip either way is
that characterisation suite; see step 5 of the loop.

## What this phase is

The Shiftline Master Plan's Phase 2 covers compliance/money and the shop floor. Reconciling it
against this codebase showed the compliance/money half is Phase 1 work, now Phase 2-T. **This phase
is the shop-floor half plus the two Part Three close-soon items that have no code at all:
engineering change control and CAPA.** Thirteen packages, roughly 22 dev-weeks.

Nothing on the shop floor exists yet beyond planning and manual entry: 160 Prisma models and none
for telemetry, energy, maintenance, inspection, lot genealogy, andon, ECN or CAPA. Phase 1 added
forty-four models and eleven modules and touched none of this.

## The repository

- GitHub: `Kaizen-Infinities/shiftline`. Work only on branch
  `<BRANCH — the owner fills this in before commissioning>`. Never push to another branch and never
  open a pull request unless the owner asks for one.
- Monorepo with npm workspaces: `apps/api` (Express 5, Prisma 6, PostgreSQL 16, pg-boss, pino, zod),
  `apps/web` (React 19, Vite, Redux Toolkit, Tailwind), `packages/shared` (permission registry,
  feature tiers, API paths, filings registry), `e2e` (Playwright). Docker compose locally; CI is
  `.github/workflows/ci.yml`. There is no hosting.

## Start of every session (non-negotiable)

1. Read `CLAUDE.md` in full. It is the rulebook and every rule in it was written after a real bug.
2. Read **this brief**, `docs/specs/P2-00-shop-floor-foundation.md`, the spec for the one package
   you are about to build, and the newest hand-off note in `docs/handoff/`. **That is all.** Do not
   read other packages' specs and do not grep the repository to orient yourself — P2-00 and each
   spec name every file you need.
3. `npm install`, `npm run build -w @shiftline/shared`, `npm run typecheck` green before you change
   anything.

`P2-00` is the shared conventions note: what already exists on the shop floor, the reason-code master
shape, the telemetry write path, the adapter pattern, realtime naming, module and web shape, and the
two new feature keys. Every package spec assumes it and none repeats it.

## What remains, in build order

Order is dependency-driven: telemetry first because andon, energy, cycle variance and maintenance all
read from it; quality before traceability because lot genealogy carries inspection results; CAPA last
because its sources are inspection and maintenance. Build one at a time, each its own commit and push.

1. **P2-01** — Machine telemetry ingestion and protocol adapters.
   `docs/specs/P2-01-machine-telemetry.md`
2. **P2-02** — Machine state timeline, downtime reasons, live andon.
   `docs/specs/P2-02-machine-state-andon.md`
3. **P2-03** — Energy metering and kWh attribution. `docs/specs/P2-03-energy-metering.md`
4. **P2-04** — Cycle-time variance and regrind ratio. `docs/specs/P2-04-cycle-variance-regrind.md`
5. **P2-05** — Preventive maintenance and breakdown tickets. `docs/specs/P2-05-maintenance.md`
6. **P2-06** — Quality foundation: characteristics, plans, rejection master.
   `docs/specs/P2-06-quality-foundation.md`
7. **P2-07** — Inspections, SPC, certificate of analysis.
   `docs/specs/P2-07-inspections-spc-coa.md`
8. **P2-08** — Lot traceability and recall. `docs/specs/P2-08-lot-traceability.md`
9. **P2-09** — Engineering change control. `docs/specs/P2-09-engineering-change-control.md`
10. **P2-10** — CAPA and non-conformance. `docs/specs/P2-10-capa.md`
11. **P2-11** — Biometric attendance ingestion. `docs/specs/P2-11-biometric-attendance.md`
12. **P2-12** — Piece-rate and incentive pay. `docs/specs/P2-12-piece-rate-incentive.md`

## Out of scope for this phase

Say so rather than building it: operations scheduling and dispatch (MES1), shop-floor document
control (MES2), the operator skill matrix (MES3), multi-warehouse and bin-location inventory,
cycle counting and barcode picking (WM1–WM3) — all Master Plan Phase 3; the five vertical packs;
AI-vision defect detection and scientific-molding parameters (the plastics depth catalogue);
ESG/Scope 1–2–3 disclosure (P2-03 is only its raw input).

## Three things this phase must get right

**1. No package may block on hardware.** There is no gateway, no meter and no biometric reader. Every
device is reached through an adapter interface with a deterministic simulator or fixture — the exact
posture `apps/api/src/modules/e-invoice/providers/` already takes with the GSP. Real OPC UA,
EUROMAP 63, Modbus and ADMS adapters are written and marked **unpinned**; every acceptance test runs
against the simulator. Record the unpinned adapters in each hand-off note the way the e-invoice note
does.

**2. Telemetry batches its writes and never leaves the tenant-scoped path.** A press emits at seconds
cadence and `lib/prisma.ts` wraps every query in its own transaction to set `app.company_id`. Both
shortcuts are banned: CI fails the build on `SET (SESSION )?app\.` anywhere in `apps/api/src`, and
`prisma.$transaction([...])` array form throws by design. Accumulate in memory per machine and flush
one batch per interval inside
`runAsTenant(companyId, () => prisma.$transaction(async (tx) => { ... }))`, reading through `tx`.
Raw sample tables (`MachineSignal`, `EnergyReading`, `AttendancePunch`) are **not** audited — a
trigger per sample would be pathological — and each gets a `RetentionDataClass` enum value plus a
`RETENTION_CLASSES` spec in `apps/api/src/modules/retention/retention.policy.ts`. Everything else is
audited. P2-00 has the full rule; each spec's acceptance asserts it.

**3. There is no mould or tooling module.** The backlog says "apply the mould module's pattern to
machines". That module belongs to the origin codebase and was never ported here. Every `mould` hit is
an enum value, a hard-coded dropdown string, or `mouldReference` — a web-only orphan field in
`apps/web/src/features/product/types.ts` with no database column (P2-09 resolves it). Do not go
looking for it and do not invent one.

## The loop for every package (follow it exactly)

1. Read P2-00 and the spec. Each spec names every file to touch and one anchor file to copy. If
   something a spec names does not exist, say so in the hand-off note — do not improvise a
   replacement.
2. **Schema first.** Add models to `apps/api/prisma/schema.prisma`; every tenant model has
   `companyId` with the `current_setting('app.company_id')` default and a `Company` relation.
   Generate the migration with `prisma migrate diff` (commands below), append the RLS block and,
   for masters and anything books-adjacent, the audit trigger, exactly as
   `apps/api/prisma/migrations/20260907170000_eway_bills/migration.sql` does. Add audited models to
   `apps/api/src/lib/audited-models.ts` — **and deliberately not the raw sample tables**. Add every
   new tenant model without seed rows to `MODELS_WITHOUT_SEED_ROWS` in
   `apps/api/test/integration/leak.spec.ts`; the leak suite's "new tenant models without seed
   coverage" assertion fails the build otherwise.
3. **Registries.** Permission modules in `packages/shared/src/permissions.ts`; the module into
   feature `shop-floor` or `quality` in `packages/shared/src/features.ts` (P2-00 says which, and
   both keys are created by the first package that needs them); paths in
   `packages/shared/src/api-paths.ts`; keys onto the right roles in `ROLE_DEFS` in
   `apps/api/src/modules/platform/provisioning.service.ts` (OWNER, ACCOUNTS, STORES, PRODUCTION,
   SALES_EXEC, AUDITOR). Rebuild shared.
4. **Backend module** under `apps/api/src/modules/<name>/` with `authMiddleware` and
   `requirePermission` on every route; mount in `apps/api/src/routes/index.routes.ts`. Export zod
   schemas from `<name>.service.ts` as `e-invoice` and `eway-bill` do, not a `.validation.ts`.
   Devices only behind an adapter interface with a simulator; secrets encrypted with `encryptText`
   from `apps/api/src/utils/crypto.ts` and never returned. Background work only on pg-boss
   (`lib/jobs.ts`, `src/jobs/`), one job per tenant under `runAsTenant`, idempotent.
5. **Integration tests** in `apps/api/test/integration/<name>.spec.ts`: happy path, every validation
   rejection, permission refusal, and a cross-tenant case. Use `authed("demo.owner")`,
   `authed("demo.production")`, `authed("demo.stores")` from `test/helpers/app.ts` and the factories
   in `test/factories/index.ts` (`asDemoTenant`, `createProduct`, `createRawMaterial`,
   `createCustomer`, `createSupplier`).

   **The modules this phase touches have no tests at all.** There is no `oee.spec.ts`,
   `grn-invoice.spec.ts`, `hourly-production.spec.ts`, `inventory.spec.ts`, `machine.spec.ts`,
   `production-order.spec.ts`, `goods-dispatch.spec.ts` or `payroll.spec.ts` — the 58 existing
   integration suites cover tenancy, accounts and compliance only. Phase 2-T package 4 writes them;
   if it has not run, write them yourself before you change anything. When a package changes an
   existing module (P2-04 the OEE service, P2-07 the GRN receipt path, P2-08 stock movement, P2-11
   the `AttendanceRecord.date` column), **characterise the current behaviour first, prove it green,
   and only then change the code.** That is the entire safety net on this side of the codebase.

6. **Web** under `apps/web/src/modules/...` in Tailwind using
   `apps/web/src/components/ui/TailwindPrimitives.tsx`; an axios service in
   `apps/web/src/services/` and a `createAsyncThunk` slice in `apps/web/src/features/` — the
   dominant pattern, and the only injected RTK-Query slice is `features/auth/authApi.ts`, so do not
   introduce a third. Route in `apps/web/src/routes/AppRoutes.tsx` behind
   `ProtectedRoute permission=...`, sidebar entry in
   `apps/web/src/components/common/sidebar/sidebar.data.ts`, a line in `e2e/smoke.spec.ts`, and the
   screen into the route inventory in `docs/specs/P1-UI-remake.md`.
7. **Hand-off note** `docs/handoff/<date>-<id>-<name>.md` with Shipped, Half-done / known gaps,
   Next, Blocked on you, and one changelog sentence. Name every unpinned adapter.
8. Verify (below), commit, push, confirm CI is green, fix anything red before the next package.

## Where things actually live (do not search for these)

- `runAsTenant`, `withoutTenant`, `requireTenantId`, `getTenant` —
  `apps/api/src/lib/tenant-context.ts` (**not** `lib/prisma.ts`).
- `prisma`, `byCode`, `CODE_KEYS`, `TENANT_MODELS`, type `Db` — `apps/api/src/lib/prisma.ts`.
- `emitToTenant`, `emitToUser`, `emitToPlatform` — `apps/api/src/lib/realtime.ts`. Events are
  `<camelCaseEntity>:<created|updated|deleted>`, emitted from the controller.
- `QUEUES`, `sendTenantJob`, `TenantJobData`, `isJobsStarted` — `apps/api/src/lib/jobs.ts`; handlers
  in `apps/api/src/jobs/`; schedules in `src/jobs/index.ts` with `tz: "Asia/Kolkata"`.
- `RETENTION_CLASSES` — `apps/api/src/modules/retention/retention.policy.ts`;
  `RetentionDataClass` is a Prisma enum, so a new class needs a migration.
- `logger`, `log(module)` — `apps/api/src/lib/logger.ts`. `encryptText`/`decryptText` —
  `apps/api/src/utils/crypto.ts`. `ApiResponse`, `asyncHandler` — `apps/api/src/utils/`.
- `notify` — `apps/api/src/modules/notifications/notify.ts`.
- `safeCreateVoucher`, `cancellationService`, `periodService.assertPostingAllowed()` —
  `apps/api/src/modules/accounts/`.
- TV scenes — `apps/web/src/modules/dashboard/tv/scenes/`, primitives in `tv/components/TvPrimitives.tsx`, rotation in `tv/TvDashboard.tsx`.

## Commands that must be green before every push

From the repository root unless noted.

```
npm run build -w @shiftline/shared
npm run typecheck
npm run typecheck -w @shiftline/web
npm run lint                      # warnings are tolerated, errors are not
npx prettier --check "packages/**/*.{ts,js,json}" "apps/api/test/**/*.ts" "apps/api/prisma/seed.ts" "*.{js,mjs,mts,json,yml}" ".github/**/*.yml"
npm run e2e:typecheck
cd apps/api && npx vitest run --no-file-parallelism     # the whole API suite, sequentially
```

Migrations, from `apps/api`:

```
MIG=postgresql://shiftline_migrator:shiftline_migrator@localhost:5432/shiftline_mig
SHADOW=postgresql://shiftline_migrator:shiftline_migrator@localhost:5432/shiftline_shadow
DATABASE_URL=$MIG npx prisma migrate diff --from-migrations prisma/migrations --shadow-database-url $SHADOW --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
# append the RLS and audit block, then
DATABASE_URL=$MIG npx prisma migrate deploy
DATABASE_URL=$MIG npx prisma migrate diff --from-migrations prisma/migrations --shadow-database-url $SHADOW --to-schema-datamodel prisma/schema.prisma --exit-code   # must print nothing
npx prisma generate
```

Route and leak snapshots update with `npx vitest run routes leak -u` after adding routes. Playwright
runs from the root against `shiftline_e2e`; after schema or permission changes run
`prisma migrate deploy` and `npm run db:seed` against it first. Never run `prisma migrate reset`.

## Hard rules (a violation is a failed package)

- Never `prisma db push`, never `new PrismaClient()`, never `console.*` in the API, never
  `setInterval` or `node-cron`, never `getIO()` or `io.emit`.
- Never write `SET app.*` or `SET SESSION app.*` in `apps/api/src` — CI greps for it.
- `prisma.$transaction([...])` array form throws by design. Use the interactive form and read
  through `tx` inside it.
- Never hard-delete documents or masters; cancel or retire with a reason. CI greps for hard deletes
  on the books models.
- Two routes in this phase are unauthenticated by protocol necessity — P2-11's ADMS push endpoint and
  nothing else. It authenticates by device serial and shared secret, is rate-limited, and returns no
  error detail. Any other route without `authMiddleware` is a bug.
- No endpoint returns a raw error message; no secret in code or in a response body; env variables
  validated in `apps/api/src/config/env.ts` and documented in `apps/api/.env.example` and
  `docker/api.env`.
- Business codes are `@@unique([companyId, code])`: look rows up with `byCode(...)`.
- Money is `Decimal`; dates are `Timestamptz`; ids are uuid.
- "Sun Sea" must not appear in code or UI. Company names come from the tenant record.
- Commit messages: a subject line, a body explaining what and why, and a `Co-Authored-By:` trailer
  for your own attribution. No model identifiers in code, comments, PR text or docs.
- Push with `git push -u origin <branch>`; retry network errors with backoff; never force-push.

## Known gaps to keep in mind

- `Machine.machineStatus` is a single mutable column with no history; P2-02 adds the timeline and
  everything after it should read spans, not that column.
- `Machine.operatorId`, `DailyProductionPlan.selectedOperatorIds` and `ProductShiftRecord.operatorIds`
  are loose strings and CSV. P2-12 reads them with an explicit split rule; do not silently normalise
  them as a side effect of another package.
- `RawMaterialTransaction` has no batch column — P2-08 adds it with a backfill to a synthetic lot.
- `modules/oee/oee.service.ts` defaults performance to 100% when `cycleTime` is unset; P2-04 fixes
  that only for machines with real cycles.
- The insights cache is per API process.
- **No integration test covers any shop-floor, purchase, inventory or payroll module.** See step 5
  of the loop — characterise before you change.
- `AttendanceRecord.date` is still a `String`, not a date; P1-16 did not change it. P2-11 migrates
  it, with a backfill, because device punches carry real timestamps.
- The cost sheet in `modules/costing/costing.service.ts` has material, labour and overhead and **no
  energy line**; P2-03 adds one without moving `totalCost` for a tenant that has no meters.
- `SalaryType` is still `monthly | weekly | daily | hourly`; P2-12 adds `piece`.

## Blocked on the repository owner

Ask once, then keep building what does not need it: the branch for this phase; a plant and a press to
pin the OPC UA, EUROMAP 63 and Modbus adapters against, and the gateway budget (₹15–40K per machine
for machines without OPC UA); a Modbus energy meter; a ZKTeco or eSSL device and its ADMS
configuration for P2-11; confirmation of which quality standard the first customers are audited to
(ISO 9001 or IATF 16949), which decides how much of P2-06's criticality model is load-bearing; branch
protection and the named human approver.

## Reporting

After each package, report in this order: what shipped with file paths, what the tests cover, the CI
result, what is half-done, what you need from the owner. Name every adapter that has not met
hardware. If a suite fails, say so with the output; never report a step as done that was skipped.
