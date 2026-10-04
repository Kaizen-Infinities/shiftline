# Commission: Phase 2-T — the transition into Phase 2

You are taking over an in-progress remaster. Read this whole brief before touching code.

## Why this phase exists

Phase 1 is finished — `docs/handoff/2026-09-12-phase-1-complete.md` is its map, and every one of
its fifteen packages has a spec in `docs/specs/` and a hand-off note here. Phase 2 is the shop
floor: machine telemetry, energy, maintenance, quality, traceability, change control
(`docs/handoff/2026-09-13-commission-phase-2.md`).

Between them sits work that is neither. The Phase 1 completion note names five gaps that cut across
packages, and the frontend remake was dropped from that run by agreement after one slice of seven.
None of it belongs inside a shop-floor package, and all of it makes the shop-floor packages harder
if left undone — Phase 2 adds roughly a dozen screens to a half-migrated web app and several
scheduled jobs to a codebase that has just demonstrated it forgets to schedule things.

**Phase 2-T closes that gap. Phase 2 begins when it does.**

## The repository

- GitHub: `Kaizen-Infinities/shiftline`. Work only on branch
  `<BRANCH — the owner fills this in before commissioning>`. Never push to another branch and never
  open a pull request unless the owner asks for one.
- Monorepo with npm workspaces: `apps/api` (Express 5, Prisma 6, PostgreSQL 16, pg-boss, pino, zod),
  `apps/web` (React 19, Vite, Redux Toolkit, Tailwind), `packages/shared` (permission registry,
  feature tiers, API paths, filings registry), `e2e` (Playwright). Docker compose locally; CI is
  `.github/workflows/ci.yml`. There is no hosting.
- Current size: 160 Prisma models, 85 API modules, 58 integration suites.

## Start of every session (non-negotiable)

1. Read `CLAUDE.md` in full. It is the rulebook and every rule in it was written after a real bug.
2. Read **this brief**, the hand-off note of the package you are continuing, and — for the remake —
   `docs/specs/P1-UI-remake.md`. Do not read Phase 2 specs while working here.
3. `npm install`, `npm run build -w @shiftline/shared`, `npm run typecheck` green before you change
   anything.

## What remains, in build order

Each package is its own commit, its own push and its own hand-off note.

### 1. Scheduling — the jobs that were never written

The completion note's first cross-cutting gap: "Nothing schedules itself that should." Three things
are manual or synchronous and each is a pg-boss job:

- Subscription invoice generation (P1-21) — per tenant, on the billing cycle.
- Leave accrual from attendance (P1-17b) — monthly, per tenant.
- The SMS send queue (P1-22) — currently synchronous, so a slow provider blocks a request.

All three follow the existing pattern: a `QUEUES` entry in `apps/api/src/lib/jobs.ts`, a handler in
`apps/api/src/jobs/`, registration in `src/jobs/index.ts` with `tz: "Asia/Kolkata"`, one job per
tenant under `runAsTenant`, **idempotent** — pg-boss retries, and a double-posted subscription
invoice or a double leave accrual is a real financial bug. Copy `src/jobs/eod-snapshot.job.ts`.

### 2. Wire the Labour Code wage rules into the payroll run

The completion note: "Overtime and the Labour Code wage rules are computed but not wired into the
payroll run. The engine has its own slabs; reconciling the two is one package." P1-17b computes
overtime at double wages with the 9-hour, 48-hour and quarterly-cap rules; the payroll run still
uses its own slabs. One of them has to win, and it is the statutory one. Reconcile them, and prove
with a test that a run over a period containing overtime produces the Labour Code figure.

### 3. The inspector's registers

"The data exists; each is a report." Muster roll, wages, overtime, fines, deductions and advances —
the registers the Factories Act and the Labour Codes require an inspector be shown. Generated from
payroll and attendance data, never separately maintained, each with a golden-file test.

### 4. Characterisation tests for the untested core

**No integration suite covers any shop-floor, inventory, purchase-receipt or payroll module.** There
is no `oee.spec.ts`, `machine.spec.ts`, `production-order.spec.ts`, `hourly-production.spec.ts`,
`inventory.spec.ts`, `grn-invoice.spec.ts`, `goods-dispatch.spec.ts` or `payroll.spec.ts` — the 58
existing suites cover tenancy, accounts and compliance. Phase 2 changes exactly these paths: P2-04
changes the OEE service, P2-07 changes the GRN receipt path, P2-08 migrates stock movement, P2-11
migrates `AttendanceRecord`.

Write characterisation suites for the **current** behaviour of those eight modules now, while
nothing is changing underneath them. This is the highest-value package in this phase: without it,
Phase 2 modifies untested production paths blind.

### 5. The frontend remake, slices 2–7

`docs/specs/P1-UI-remake.md` already specifies them and slice 1 (Foundation) has landed — Bootstrap
and the origin logo are gone and `apps/web/src/components/ui/TailwindPrimitives.tsx` exists. Build
slices 2 through 7 in order, one commit and one hand-off note each, ending with the hardening slice.
Every slice leaves every screen usable and `e2e/smoke.spec.ts` green.

### Not in this phase

Payout reconciliation for the payment gateway and SMS delivery receipts. Both need a live Razorpay
and MSG91 account, and the completion note is right that they cannot be built honestly without one.
Leave them; the Phase 2 brief repeats the ask.

## The loop for every package

1. Write the spec first: half a page in `docs/specs/<id>-<name>.md` with Why, Scope, Out of scope,
   Acceptance. `docs/specs/P1-12-eway-bill.md` is the shape.
2. Schema changes — where there are any — go in first: `companyId` with the
   `current_setting('app.company_id')` default and a `Company` relation on every tenant model;
   migration by `prisma migrate diff`; append the RLS block and, for books, documents and masters,
   the audit trigger, as `apps/api/prisma/migrations/20260907170000_eway_bills/migration.sql` does;
   audited models into `apps/api/src/lib/audited-models.ts`; every new tenant model without seed
   rows into `MODELS_WITHOUT_SEED_ROWS` in `apps/api/test/integration/leak.spec.ts`.
3. Registries: `packages/shared/src/permissions.ts`, a feature in `features.ts`, paths in
   `api-paths.ts`, keys onto roles in `ROLE_DEFS` in
   `apps/api/src/modules/platform/provisioning.service.ts` (OWNER, ACCOUNTS, STORES, PRODUCTION,
   SALES_EXEC, AUDITOR). Rebuild shared.
4. Backend under `apps/api/src/modules/<name>/`, `authMiddleware` and `requirePermission` on every
   route, mounted in `apps/api/src/routes/index.routes.ts`. Zod schemas exported from the service,
   as the newer modules do. Background work only on pg-boss.
5. Integration tests in `apps/api/test/integration/<name>.spec.ts`: happy path, every validation
   rejection, permission refusal, and a cross-tenant case. `authed("demo.owner")`,
   `authed("demo.accounts")`, `authed("demo.production")`, `authed("demo.stores")` from
   `test/helpers/app.ts`; factories in `test/factories/index.ts`.
6. Web in Tailwind via `apps/web/src/components/ui/TailwindPrimitives.tsx`; an axios service in
   `apps/web/src/services/` and a `createAsyncThunk` slice in `apps/web/src/features/` — the
   dominant pattern; the only injected RTK-Query slice is `features/auth/authApi.ts`. Route in
   `AppRoutes.tsx` behind `ProtectedRoute`, sidebar entry in
   `apps/web/src/components/common/sidebar/sidebar.data.ts`, a line in `e2e/smoke.spec.ts`.
7. Hand-off note with Shipped, Half-done / known gaps, Next, Blocked on you, one changelog sentence.
8. Verify, commit, push, confirm CI green before the next package.

## Where things actually live (do not search for these)

- `runAsTenant`, `withoutTenant`, `requireTenantId`, `getTenant` —
  `apps/api/src/lib/tenant-context.ts` (**not** `lib/prisma.ts`).
- `prisma`, `byCode`, `CODE_KEYS`, `TENANT_MODELS` — `apps/api/src/lib/prisma.ts`.
- `emitToTenant` — `apps/api/src/lib/realtime.ts`; events are `<camelCaseEntity>:<action>`.
- `QUEUES`, `sendTenantJob`, `TenantJobData` — `apps/api/src/lib/jobs.ts`; handlers in
  `apps/api/src/jobs/`; schedules in `src/jobs/index.ts`.
- `notify` — `apps/api/src/modules/notifications/notify.ts`.
- `filingApprovalService` — `apps/api/src/modules/filings/filing-approval.service.ts`.
- `safeCreateVoucher`, `cancellationService`, `periodService.assertPostingAllowed()` —
  `apps/api/src/modules/accounts/`.
- `encryptText` — `apps/api/src/utils/crypto.ts`. `ApiResponse`, `asyncHandler` —
  `apps/api/src/utils/`.

## Commands that must be green before every push

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

Route and leak snapshots update with `npx vitest run routes leak -u`. Playwright runs from the root
against `shiftline_e2e`; after schema or permission changes run `prisma migrate deploy` and
`npm run db:seed` against it first. Never run `prisma migrate reset`.

## Hard rules (a violation is a failed package)

- Never `prisma db push`, never `new PrismaClient()`, never `console.*` in the API, never
  `setInterval` or `node-cron`, never `getIO()` or `io.emit`.
- Never write `SET app.*` or `SET SESSION app.*` in `apps/api/src` — CI greps for it.
- `prisma.$transaction([...])` array form throws by design; use the interactive form and read
  through `tx` inside it.
- Never hard-delete books, documents or masters; cancel or reverse through `cancellationService`.
  CI greps for hard deletes on the books models.
- Every filing refuses to submit until `filingApprovalService.assertSubmittable` passes.
- No endpoint returns a raw error message; no secret in code or in a response body.
- "Sun Sea" must not appear in code or UI.
- Commit messages: a subject, a body explaining what and why, and a `Co-Authored-By:` trailer. No
  model identifiers in code, comments, PR text or docs.
- Push with `git push -u origin <branch>`; retry network errors with backoff; never force-push.

## Blocked on the repository owner

A GSP account for e-invoice, e-way bill and the GSTR-2B/IMS adapters; a tenant Razorpay account and
a platform Razorpay account with Subscriptions plus `PLATFORM_GATEWAY_WEBHOOK_SECRET`; an MSG91
account and the tenant's DLT registration; an accountant for one validation month against real
filings; the named human approver and branch protection; the branch for this phase.

## Reporting

After each package: what shipped with file paths, what the tests cover, the CI result, what is
half-done, what you need from the owner. If a suite fails, say so with the output; never report a
step as done that was skipped.
