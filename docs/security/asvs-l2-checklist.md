# OWASP ASVS Level 2 checklist — Shiftline, end of Phase 0

Status legend: **Done** (implemented and tested in this repo) · **Partial** (in place, gap
named) · **Planned** (package that delivers it) · **N/A**. Requirement numbers follow ASVS 4.0.3.

## V1 Architecture

| Req  | Requirement                           | Status  | Evidence                                                                                        |
| ---- | ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| 1.1  | Secure SDLC, threat model per feature | Partial | Spec + hand-off per package (`docs/specs`, `docs/handoff`); no formal threat model yet (Gate 1) |
| 1.2  | Authentication architecture           | Done    | One auth module, JWT + rotating refresh (`modules/auth`), sessions in `user_sessions`           |
| 1.4  | Access control architecture           | Done    | Permission registry in `packages/shared`, `requirePermission`, tenant context + RLS             |
| 1.5  | Input/output architecture             | Done    | Zod on every route, `validateMiddleware` writes parsed output back                              |
| 1.9  | Communications                        | Planned | TLS terminates at nginx when hosted; local only today                                           |
| 1.11 | Business logic architecture           | Partial | Double-entry posting is transactional; period close enforcement is P1-09                        |
| 1.14 | Configuration architecture            | Done    | `config/env.ts` validates every variable; production refuses defaults                           |

## V2 Authentication

| Req | Requirement                                         | Status  | Evidence                                                                          |
| --- | --------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| 2.1 | Password security (length, breached, no truncation) | Partial | bcrypt, 12+ chars for admins; breached-password check not done (P1-00 onboarding) |
| 2.2 | Anti-automation                                     | Done    | Login limiter (30/15 min) + per-IP failed-attempt lockout incl. admins (SEC-01)   |
| 2.3 | Authenticator lifecycle                             | Done    | Invitations/set-password arrive P1-00; reset tokens hashed, single-use, expiring  |
| 2.5 | Credential recovery                                 | Done    | `password-reset` with hashed one-time token; generic responses                    |
| 2.7 | Out-of-band                                         | Planned | OTP via MSG91 in P1-22                                                            |
| 2.8 | MFA                                                 | Planned | `mfaEnabled` field exists; TOTP in Phase 2                                        |

## V3 Session management

| Req | Requirement                           | Status  | Evidence                                                                                          |
| --- | ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| 3.2 | Session binding, new session on login | Done    | `UserSession` per login, 4-device cap, session id in the JWT                                      |
| 3.3 | Logout and timeout                    | Done    | 15-min access token; sliding 7-day refresh, 30-day absolute; logout revokes and clears the cookie |
| 3.4 | Cookie-based session                  | Done    | `shiftline_rt` httpOnly, Secure, SameSite, `Path=/api/auth`                                       |
| 3.5 | Token-based session                   | Done    | Rotating refresh with reuse detection (`refresh.spec.ts`); tokens stored hashed                   |
| 3.7 | Re-authentication for sensitive ops   | Planned | P1-04 approval gates re-check the password for filings                                            |

## V4 Access control

| Req | Requirement            | Status | Evidence                                                                                             |
| --- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 4.1 | General access control | Done   | Every router `authMiddleware` + `requirePermission`; leak suite sweeps every route as another tenant |
| 4.2 | Operation-level, IDOR  | Done   | Prisma extension scopes every query; RLS forced on all tenant tables (`rls.spec.ts`, `leak.spec.ts`) |
| 4.3 | Admin interfaces       | Done   | Platform routes behind `requireSuperAdmin`; admins act on a tenant only via `X-Company-Id`           |

## V5 Validation, sanitisation, encoding

| Req | Requirement                | Status  | Evidence                                                                                       |
| --- | -------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| 5.1 | Input validation           | Done    | Zod schemas; unknown keys stripped; pagination clamps; id guards (REL-01)                      |
| 5.2 | Sanitisation               | Partial | JSON columns (`payments`, `mobile`) are normalised where read; HTML never rendered server-side |
| 5.3 | Output encoding, injection | Done    | Prisma parameterised queries; raw SQL only with tagged templates; helmet CSP                   |
| 5.5 | Deserialisation            | Done    | JSON body limit 10 MB, 413/400 handlers                                                        |

## V6 Cryptography

| Req | Requirement       | Status  | Evidence                                                                            |
| --- | ----------------- | ------- | ----------------------------------------------------------------------------------- |
| 6.2 | Algorithms        | Done    | bcrypt, AES-256-GCM for stored credentials (`utils/crypto.ts`), sha256 token hashes |
| 6.3 | Random values     | Done    | `crypto.randomBytes` / `randomUUID` everywhere (SEC-03)                             |
| 6.4 | Secret management | Partial | Secrets only in env; KMS/secret store when hosted                                   |

## V7 Error handling and logging

| Req | Requirement                 | Status | Evidence                                                                         |
| --- | --------------------------- | ------ | -------------------------------------------------------------------------------- |
| 7.1 | Log content, no secrets     | Done   | pino with redaction list; request id on every line and error body                |
| 7.2 | Log processing, auth events | Done   | Login success/failure, logout, token reuse in `audit_log`; pino-http per request |
| 7.3 | Log protection              | Done   | `audit_log` append-only by trigger, UPDATE/DELETE revoked from the app role      |
| 7.4 | Error handling              | Done   | Sanitised error middleware; detail only outside production; Sentry hook optional |

## V8 Data protection

| Req | Requirement             | Status  | Evidence                                                                 |
| --- | ----------------------- | ------- | ------------------------------------------------------------------------ |
| 8.1 | General data protection | Done    | Tenant isolation by RLS; positions purged by retention (90 days default) |
| 8.2 | Client-side             | Done    | Access token in memory only; no tokens in localStorage                   |
| 8.3 | Sensitive private data  | Partial | Retention policies with statutory floors; DPDP export arrives P1-03      |

## V9 Communications

| Req | Requirement | Status  | Evidence                                            |
| --- | ----------- | ------- | --------------------------------------------------- |
| 9.1 | TLS         | Planned | Local compose only; nginx TLS with HSTS when hosted |

## V10, V11, V12, V13, V14

| Area                    | Status  | Evidence                                                                                             |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| V10 Malicious code      | Done    | Lockfile, Dependabot, `npm audit` gate with expiring allowlist (`scripts/audit-gate.mjs`)            |
| V11 Business logic      | Partial | Idempotent sync, append-only documents, balanced vouchers; period close and approvals in P1-04/P1-09 |
| V12 Files and resources | Done    | Multer type/size limits, tenant-prefixed storage paths, no path from client                          |
| V13 API                 | Done    | JSON only, CORS allowlist with credentials, rate limits, request ids                                 |
| V14 Configuration       | Done    | Helmet headers, env validation, no default credentials in production, Docker non-root user           |

## Open items before Gate 1

1. TLS, HSTS and secret storage when hosting is chosen.
2. Threat model for the finance packages (filing submission, payment links).
3. MFA/OTP (P1-22, Phase 2).
4. Breached-password check on invitation and reset (P1-00).
5. Pentest against this checklist (see `pentest-scope.md`).
