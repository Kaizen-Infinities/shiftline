# Shiftline

Multi-tenant ERP for secondary-sector manufacturing: sales, purchase, inventory,
production, accounts, GST and statutory compliance, payroll, and a field-sales
mobile app. Remastered from Sun Sea ERP.

## Layout

```
apps/api        Express 5 + Prisma 6 + PostgreSQL API, the pg-boss worker and the Field app sync API (/api/mobile)
apps/web        React 19 + Vite SPA
packages/*      shared code (permission registry, zod schemas, config)
docs/specs      half-page specs written before each work package
docs/handoff    session hand-off notes
docs/runbooks   operational procedures
```

## Run locally

Requirements: Node 22 (`.nvmrc`), Docker.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # fill in JWT_ACCESS_SECRET and ADMIN_*
cp apps/web/.env.example apps/web/.env
docker compose up -d postgres               # or `make db`
npm run -w @shiftline/api prisma:generate
npm run dev --workspace @shiftline/api      # or EMBED_WORKER=true to skip the next line
npm run worker --workspace @shiftline/api   # pg-boss worker: EOD snapshots, retention sweeps
npm run dev --workspace @shiftline/web
```

`npm run typecheck`, `npm run lint`, `npm run test` run across all workspaces; `npm run e2e`
(or `make e2e`) runs the Playwright smoke suite against a seeded database; `npm run audit:gate`
is the dependency gate CI runs. The API answers `GET /health` and `GET /ready`; logs are pino
JSON with an `x-request-id` that also appears in error responses. Backups: `make backup`,
`make restore` (see `docs/runbooks/backup-restore.md`).

## Working model

Every change is a branch and a pull request that passes CI. Work is organised in
PR-sized packages (see the plan in `docs/`), each with a spec in `docs/specs/`
and a hand-off note in `docs/handoff/`.
