# P0-01 — Shared package and static checks

**Goal.** One source of truth for permission keys and API paths, and a lint/format
gate that every later package inherits.

**Data model.** None.

**Packages.**
- `@shiftline/shared` (`packages/shared`): `PERMISSION_REGISTRY`, `generatePermissions`,
  `ALL_PERMISSION_KEYS`, `isKnownPermission`, `API_PATHS`. Built to `dist/esm` and
  `dist/cjs` on `npm install` (`prepare`). The API imports the CJS build, Vite the ESM build.
- `@shiftline/config` (`packages/config`): `tsconfig.base.json`, `eslint.base.js`.
- Root `eslint.config.js` (ESLint 10 flat config) covers api, web and packages.
  Prettier at root; husky pre-commit runs lint-staged (eslint --fix + prettier on staged files).

**Architecture rules (errors).** No `new PrismaClient` outside the shared client file;
no session-scoped `SET app.*`. Warnings until their package flips them: `getIO` imports
(P0-10), `console.*` (P0-13). React Compiler rules and legacy style findings are warnings
in the imported UI until a screen is touched.

**Done when.** `npm run typecheck` and `npm run lint` exit 0 for all workspaces;
the API boots with the registry imported from the shared package.
