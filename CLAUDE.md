# Shiftline — working conventions

## What this is

Multi-tenant ERP SaaS for Indian secondary-sector manufacturers. npm-workspaces
monorepo: `apps/api` (Express 5, Prisma 6, PostgreSQL, pg-boss), `apps/web`
(React 19, Vite, Redux Toolkit, Tailwind), `packages/*` shared code. Runs locally
on Docker compose; CI on GitHub Actions. No hosting yet.

## Start of every session

1. Read the newest file in `docs/handoff/`.
2. Read the spec for the package you are working on in `docs/specs/`.
3. `npm install && npm run typecheck` must be green before you change anything.

## Loop for every work package

Spec (half a page, `docs/specs/<id>.md`) → schema + failing tests → implement →
verify on the running stack (screenshot in the PR) → self-review for tenancy,
input leaks, secrets, error text → human review and merge → hand-off note.

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
