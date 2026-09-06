# P0-02 — Audit hotfixes and input pipeline (F4 part 1, F6)

**Goal.** Close every blocker and medium from the Sun Sea pre-delivery audit, fix the
input pipeline, and stop trusting the client for `companyId`.

**Changes.**
- SEC-01 admin login failures are recorded (rate limiter now sees them).
- SEC-02 error handler returns fixed messages; detail only outside production; JSON
  parse → 400, oversize body → 413, Prisma validation / bad ids → 400.
- SEC-03 password generator uses `crypto.getRandomValues` and Fisher–Yates.
- SEC-04 `GET /api/companies/public` returns name, logo, favicon only; `GET /api/companies`
  requires auth. Login page uses the public endpoint.
- SEC-05 socket handshake requires a valid access token; origins allow-listed; web
  connects only when signed in and reconnects on token change.
- SEC-06 `helmet()` with CSP replaces hand-set headers.
- REL-01 / F6 `validateMiddleware` writes parsed output back (unknown keys stripped);
  shared clamped pagination (`utils/pagination.ts`) on customers; BigInt id guard.
- REL-02 socket transports fall back to polling. REL-03 stable row keys.
- PERF-01 products list supports `page`/`limit`, caps unpaginated results, trims includes.
- TRUST-01 in-app sales map badged SIMULATED (TV scene already was).
- LOW-02 no default admin credentials in production; env validation requires `ADMIN_*`
  and `DATA_ENCRYPTION_KEY` there.
- Auth + permissions on accounts, vouchers, returns, petty-cash, whatsapp (webhook stays
  public), customer-types, customer-grades. New registry modules `customer-types`,
  `customer-grades`.
- `companyId` never read from the client: `utils/companyContext.getCurrentCompanyId()`
  (single-company until P0-07 replaces it with the tenant context).
- `DATA_ENCRYPTION_KEY` via `utils/crypto.ts` for WhatsApp tokens and SMTP passwords;
  SMTP password masked in responses.
- `express-rate-limit`: 1200 req / 15 min per IP on `/api`, 30 / 15 min on credential routes.
- Request bodies are no longer logged.

**Done when.** Typecheck and lint green; each fix is covered by an integration test once
P0-04 lands (the tests are listed in the P0-04 spec).
