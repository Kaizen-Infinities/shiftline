# P0-01 — Shared package and static checks

## Shipped

- `packages/shared` (`@shiftline/shared`): permission registry moved out of the API,
  API path table moved out of the web app; dual CJS/ESM build on install.
- `packages/config`: `tsconfig.base.json`, `eslint.base.js`.
- Root ESLint 10 flat config for api, web, packages; Prettier; husky + lint-staged.
- Architecture rules: `new PrismaClient` and session-scoped `SET app.*` are errors;
  `getIO` imports and `console.*` are warnings until P0-10 / P0-13.
- The two rogue Prisma clients (customer-type, customer-grade) now use the shared client.
- Removed the dead `utils/permission.ts` hook-in-a-function and a useless try/catch.
- `npm run lint` and `npm run typecheck` exit 0 (api: 273 warnings, web: 486 warnings,
  all legacy-style; they shrink as screens are touched).

## Half-done

- Nothing.

## Next

- P0-02: audit hotfixes (SEC-01..06, REL-01..03, PERF-01, TRUST-01, LOW-02), input
  pipeline (F6), auth on the 7 unguarded route groups, `DATA_ENCRYPTION_KEY`, rate limits.
