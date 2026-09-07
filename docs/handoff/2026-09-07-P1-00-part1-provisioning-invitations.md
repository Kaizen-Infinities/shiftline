# P1-00 part 1 — tenant provisioning and invitations

## Shipped

- `provisioningService.provisionTenant()`: company + ledgers, head office, five default roles,
  units, financial year and accounting period, invoice settings, thirteen document sequences,
  module settings; idempotent; the seed is built on it.
- `POST/GET /api/platform/tenants` (super admin): create a tenant and invite its owner; list
  tenants with counters. Company gained `slug`, `onboardingStep`, `tosAcceptedAt/By`.
- Invitations: `Invitation` model (RLS, audit trigger), create/list/resend/revoke for the
  office, public preview and accept that creates the user and signs them in; email through the
  existing mailer with a dev-only `acceptUrl` fallback; `/accept-invitation` page in the web app.
- Migration `20260907001500_invitations_onboarding`; 105 API tests green (tenants.spec.ts adds 4).

## Half-done / known gaps

- The Users screen has no "Invite" button yet; invitations are API-only until the onboarding
  wizard's "first users" step (Part 2) adds the UI.
- `POST /api/users` (direct create with a generated password and welcome email) still exists;
  it is retired in Part 3 once every screen uses invitations.
- Per-tenant login branding by `slug` (login page reading `/companies/public?slug=`) is not
  wired; the column and uniqueness are in place.
- Platform admins create tenants through the API; the admin console screens come with P1-02.

## Next

- Part 2: onboarding wizard (API + web) with ToS acceptance.
- Part 3: CSV imports, notification centre, surrogate keys for the seven code-keyed models,
  Prisma 8 evaluation.

## Blocked on you

- Branch protection and the approver handle (since P0-00).
- Pentest vendor booking (Gate 0 criterion).
- Anthropic API key for cheque OCR, or the decision to drop OCR (P0-11).
