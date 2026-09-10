# P0-03 — Docker compose, images, anonymised seed

## Shipped

- Compose stack, Postgres role init, api and web Dockerfiles, nginx config, Makefile.
- `apps/api/prisma/seed.ts` (idempotent). Verified twice against a local PostgreSQL 16.
- ImageKit client is now lazy: the API boots without file-storage keys and uploads
  return 503 until configured.
- Live verification of P0-02 against the seeded database:
  public branding endpoint 200 with name/logo only; `/api/companies`, `/api/accounts/ledgers`,
  `/api/whatsapp/config` unauthenticated → 401; bad pagination → 400; malformed JSON → 400;
  12 MB body → 413; out-of-range and non-numeric ids → 400; products `?page=1&limit=2` →
  paginated shape; helmet headers present, no `X-Powered-By`; 12 wrong admin passwords →
  429 after the 10th and all 12 recorded in `login_attempts`.
- Runbooks: `local-run.md`, `data-handling.md`; `scripts/anonymise-dump.sql`.

## Half-done

- The access token embeds all 349 permission keys (10 KB). P0-13's short-lived token
  drops permissions from the JWT (the middleware already re-reads them from the DB).
- Schema is applied with `prisma db push` until P0-06 creates the initial migration.

## Next

- P0-04: Vitest + supertest harness, template-DB isolation, factories, first suites,
  route lister. The P0-02 probes above become the first integration tests.

## Blocked on you

- Branch protection and the named approver (since P0-00).
