# Run Shiftline locally

Requirements: Node 22 (`.nvmrc`), Docker with compose.

```bash
make install                 # npm install; builds @shiftline/shared, installs git hooks
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
make db                      # PostgreSQL 16 in Docker on localhost:5432
```

Set in `apps/api/.env`:

```
DATABASE_URL=postgresql://shiftline_migrator:shiftline_migrator@localhost:5432/shiftline
JWT_ACCESS_SECRET=<any 32+ random characters>
DATA_ENCRYPTION_KEY=<any 32+ random characters>
```

Then:

```bash
npx -w @shiftline/api prisma migrate deploy   # until P0-06 lands: npx -w @shiftline/api prisma db push
make seed                                     # demo tenant, roles, users, masters
make dev                                      # api on :5000, web on :5173
```

Demo logins (password `SEED_PASSWORD`, default `Demo@12345678`): `demo.owner`,
`demo.accounts`, `demo.stores`, `demo.production`, `demo.sales`. The platform admin is
created from `ADMIN_*` in `.env` (a development-only default password is used and
announced on boot when they are unset).

Full stack in containers instead: `docker compose --profile full up`.

Useful: `make reset` (drop, migrate, seed), `make typecheck`, `make lint`, `make test`.
