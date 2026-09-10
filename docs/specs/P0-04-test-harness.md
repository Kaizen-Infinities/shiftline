# P0-04 — Test harness (F1 part 1)

**Goal.** Every later package ships with integration tests against a real PostgreSQL, and
the audit fixes from P0-02 are pinned by tests.

**Design.**

- Vitest 5 with root `vitest.config.mts` and projects `api`, `shared`, `web`.
- API project: `test/global-setup.ts` builds `shiftline_test_template` once (schema via
  `prisma migrate deploy`, or `db push` until P0-06 lands the initial migration, then the
  seed). `test/setup.ts` gives each worker its own clone (`shiftline_test_w<N>`) via
  `CREATE DATABASE … TEMPLATE`, so files never share state. `TEST_DATABASE_URL` overrides the
  default `postgresql://shiftline_migrator:shiftline_migrator@localhost:5432/shiftline_test`.
- Helpers: `helpers/app.ts` (lazy app import, supertest, `loginAs`, `authed`),
  `helpers/db.ts` (`resetTransactionalTables` keeps seeded masters), `helpers/routes.ts`
  (route table from the explicit `API_MOUNTS` in `routes/index.routes.ts`).
- Factories in `test/factories` (faker, fixed seed): customer, supplier, product, raw material.
- Rate limiters are skipped when `NODE_ENV=test`.
- Lazy `require()` of local TypeScript modules was replaced by `await import("…js")` so the
  code runs under tsx, tsc output and Vitest alike.

**Suites.** Unit: pagination, crypto, validate middleware. Integration: auth (login,
messages, forged/alg=none tokens, SEC-01 admin lockout), security (guards on the formerly
public groups, public branding shape, helmet, 403, 404), input pipeline (400/413, ids,
companyId stripping), products (legacy array, paginated shape, by id), accounts (trial
balance, system ledgers, server-side companyId), route inventory snapshot. Shared: registry.

**Done when.** `npm test` green locally against Postgres (44 tests); the same command runs
in CI in P0-05.
