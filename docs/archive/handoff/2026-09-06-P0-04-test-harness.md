# P0-04 — Test harness

## Shipped

- Vitest projects (api, shared, web), template-database-per-worker isolation, factories,
  supertest helpers, route inventory snapshot. 44 tests, all green locally.
- `API_MOUNTS` table in `routes/index.routes.ts` (Express 5 hides mount paths on layers).
- 27 lazy `require()` calls converted to `await import()`; the API and tests share one
  module path now.
- `npm test` at root runs every project; `npm run test:coverage` for coverage.

## Half-done

- Web project has no tests yet (`passWithNoTests`); component tests come with the first
  Tailwind screens.
- `resetTransactionalTables()` exists but no suite needs it yet.

## Next

- P0-05: GitHub Actions CI (static, migrations gate, test-api with a Postgres service
  container, test-web + build, docker build), Dependabot, CODEOWNERS, PR template.

## Blocked on you

- Branch protection and the named approver (since P0-00).
