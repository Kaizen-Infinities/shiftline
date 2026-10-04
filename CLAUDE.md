# Shiftline — working conventions

## What this is

Multi-tenant ERP SaaS for Indian secondary-sector manufacturers. npm-workspaces
monorepo: `apps/api` (Express 5, Prisma 6, PostgreSQL, pg-boss), `apps/web`
(React 19, Vite, Redux Toolkit, Tailwind), `packages/*` shared code. Runs locally
on Docker compose; hosted at https://shiftline.apps.kaizeninfinities.com on a single-node
kind cluster (`docs/runbooks/hosting.md`); CI on GitHub Actions.

## Start of every session

1. Read `docs/STATUS.md` (and `docs/AS-BUILT.md` for what is live), then the newest note in
   `docs/handoff/` if any.
2. Read the spec for the package you are working on in `docs/specs/`.
3. `npm install && npm run typecheck` must be green before you change anything.

New work packages come from `docs/ROADMAP.md` with `R-xx` ids; ignore `docs/archive/` unless asked.

## Loop for every work package

Spec (half a page, `docs/specs/<id>.md`) → schema + failing tests → implement →
verify on the running stack (screenshot in the PR) → self-review for tenancy,
input leaks, secrets, error text → human review and merge → hand-off note, then update
`docs/STATUS.md` and `docs/ROADMAP.md`.

## Definition of done

- Integration tests cover the happy path and every validation rejection; CI green. A new
  screen is added to `e2e/smoke.spec.ts`.
- Every new query is tenant-scoped; a cross-tenant test proves a foreign
  `companyId` returns nothing.
- No endpoint returns a raw error message; no secret in code; env validated.
- Permission keys registered in `packages/shared`; nav gated; socket events per tenant.
- One user-facing sentence in the changelog.

## Conventions

- Backend module: `apps/api/src/modules/<name>/<name>.{routes,controller,service,validation}.ts`,
  mounted in `apps/api/src/routes/index.routes.ts`. Every router uses `authMiddleware`
  and `requirePermission`.
- Prisma client only from `apps/api/src/lib/prisma.ts` (never `new PrismaClient()`). It scopes
  every tenant model to the current tenant; code without a request context uses
  `runAsTenant(companyId, fn)` (jobs, seeds) or `withoutTenant(fn)` (login, platform admin).
- Business codes are unique per tenant: look them up with `findFirst`, or the compound key
  `companyId_<field>` for `upsert`/`update`.
- Socket emits only via `lib/realtime.ts` (`emitToTenant`); never `getIO()` or `io.emit`.
- Scheduled and background work runs on pg-boss (`lib/jobs.ts`, handlers in `src/jobs/`),
  one job per tenant under `runAsTenant`, idempotent, never `node-cron` or `setInterval`.
- Logging only via `lib/logger.ts` (pino): `logger.info({ id }, "message")`; never `console.*`
  in the API. Every request has a request id (`lib/request-context.ts`) that appears in logs,
  error bodies and audit rows; jobs get a synthetic one.
- Books, documents, payroll and master tables are audited by database trigger
  (`AUDITED_MODELS` in `src/lib/audited-models.ts`, migration from `scripts/gen-audit-migration.ts`). Add new models of that kind to the list
  and generate a new migration; never write to `audit_log` by hand and never delete from it.
- Auth: 15-minute access tokens in memory on the client; the httpOnly refresh cookie rotates on
  every use (`modules/auth/refresh-token.ts`). New clients call `POST /api/auth/refresh` on 401.
- New tenants come only from `provisioningService.provisionTenant()` (seed, platform API,
  later self-signup); anything every company needs on day one belongs there, not in a seed.
  Users join through invitations (`modules/users/invitation.service.ts`), never with a password
  sent by email. A new tenant is finished by its owner in the onboarding wizard
  (`modules/onboarding`, web `/onboarding`); only `POST /api/onboarding/complete` sets
  `Company.isOnboarded`. GSTINs are validated with `isValidGstin` from `@shiftline/shared`.
- Business codes (store, machine, raw material, production order, weekly program, daily plan,
  location, shift) are unique per tenant, not globally: the primary key is a uuid and the code is
  `@@unique([companyId, code])`. Look rows up with `byCode("storeId", code)` from `lib/prisma.ts`,
  never `where: { storeId }`; relations to these models pair the code with `companyId`.
- GST on documents (`modules/gst/gst.calc.ts`, `gst.context.ts`): the tax split comes from the
  issuing business place's state code against the place of supply, never from state names; HSN
  and rate default from the item master and are copied onto the line. Document numbers come from
  `documentNumberService.next(docType, { date, businessPlaceId, tx })` (`modules/documents`),
  one series per type, branch and financial year; never build a number from `count()` or the
  last row. Returns raise credit/debit notes; reverse charge posts to the `RCM-*` ledgers.
- E-invoice (`modules/e-invoice`): IRNs are raised only through `eInvoiceService.request()` and
  cancelled through `eInvoiceService.cancel()`; portals are reached only via an `EInvoiceProvider`
  (`providers/`), never with a direct HTTP call; GSP secrets are encrypted with `encryptText` and
  never returned. Any cancel path for a tax document calls `assertDocumentCancellable(docType, id, tx)`. E-way bills
  (`modules/eway-bill`) follow the same shape: `ewayBillService` only, providers behind `EwayBillProvider`,
  one live bill per document, validity from `validUptoFor`.
- Books are never deleted (P1-09): cancel through `cancellationService` (status `CANCELLED`
  plus a `REVERSAL` journal) and gate every posting date with
  `periodService.assertPostingAllowed()`; `safeCreateVoucher` already does both checks. Lookups
  for "the voucher of this document" must filter `status: "POSTED"`.
- Year-end (`modules/year-end`): closing is prepared then approved; the closing JV carries
  `refDocType "YEAR_END"`, the P&L statement excludes it and the balance sheet includes it. Never post
  or cancel it by hand; the freeze date moves with the closing.
- Platform admins (`Admin` rows, `isSuperAdmin`) have no tenant: console screens sit behind
  `ProtectedRoute superAdmin` and `requireSuperAdmin()`, read tenant data with `runAsTenant`, and
  act as a user only through `impersonationService` (30-minute token, reason, `impersonatedBy` on
  every audit row). Native clients send `x-device-id`; a session bound to a device dies with it.
- Field app sync (`modules/mobile`): the server enforces the conflict policy in
  `mobile.types.ts` (server-owned tables pull-only, documents append-only, visits merged field
  by field, device headers on writes). Never let a device overwrite a server-owned row.
- Money is `Decimal`; dates are `Timestamptz`; ids are uuid; codes are
  `@@unique([companyId, code])`.
- Frontend HTTP only through `apps/web/src/api/apiClient.ts` or the RTK `baseApi`.
- New screens use Tailwind; do not add Bootstrap.
- Never `prisma db push`; always `prisma migrate dev --name <change>`.
- Never hard-delete books-of-account rows; cancel or reverse.
- Filing, payment, tenancy and auth PRs need the named human approver.

## Product vs tenant data

"Shiftline" is the product; "Sun Sea" was the origin codebase and must not appear
in code or UI. Company names, logos and email domains come from the tenant record.
