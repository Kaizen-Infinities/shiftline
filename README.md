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

Requirements: Docker (everything in containers) or Docker + Node 22 (`.nvmrc`) to run the
api and web on the host.

**Everything in Docker** (first start builds the images and takes a few minutes):

```bash
make up            # = docker compose --profile full up --build
```

The api container applies the migrations and seeds the demo tenant before it listens, so the
stack is ready when http://localhost:5173 shows the login page. Development credentials come
from `docker/api.env` (placeholders, never for anything reachable from the internet):

| Who                                                     | Login                                                                           | Password          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------- |
| Demo tenant owner                                       | `owner@demo.shiftline.local` (or `demo.owner`)                                  | `Demo@12345678`   |
| Accountant / storekeeper / supervisor / sales / auditor | `accounts@`, `stores@`, `production@`, `sales@`, `auditor@demo.shiftline.local` | `Demo@12345678`   |
| Platform admin                                          | `admin@dev.shiftline.local`                                                     | `DevAdmin#2026!!` |

`make down` stops the stack; `docker compose --profile full down -v` also drops the database.
`make up` removes the previous containers first, so a worker or web container never keeps
running against a database volume that was dropped underneath it. The worker and web
containers start only after the api reports `/ready` (migrations applied, seed done).
`apps/api/.env` (gitignored) overrides anything in `docker/api.env`.

**Api and web on the host** (faster reloads):

```bash
npm install
make env                                    # apps/api/.env and apps/web/.env from the examples
docker compose up -d postgres               # or `make db`
npm run -w @shiftline/api prisma:generate
npx -w @shiftline/api prisma migrate deploy
npm run -w @shiftline/api db:seed           # or `make seed`
make dev                                    # api (embedded worker) + web
```

`npm run typecheck`, `npm run lint`, `npm run test` run across all workspaces; `npm run e2e`
(or `make e2e`) runs the Playwright smoke suite against a seeded database; `npm run audit:gate`
is the dependency gate CI runs. The API answers `GET /health` and `GET /ready`; logs are pino
JSON with an `x-request-id` that also appears in error responses. Backups: `make backup`,
`make restore` (see `docs/runbooks/backup-restore.md`). For a production deployment, follow the
Railway and Cloudflare runbook in `docs/runbooks/railway-cloudflare.md`.

## Working model

Every change is a branch and a pull request that passes CI. Work is organised in
PR-sized packages (see the plan in `docs/`), each with a spec in `docs/specs/`
and a hand-off note in `docs/handoff/`.
