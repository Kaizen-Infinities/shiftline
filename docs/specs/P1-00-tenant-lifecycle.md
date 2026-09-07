# P1-00 — Tenant lifecycle and onboarding

**Goal.** A platform admin can create a paying company in one call, that company is usable the
same minute (books, roles, numbering, financial year), its owner and staff join through email
invitations instead of passwords typed into a form, and the owner completes onboarding, imports
masters and opening balances, and sees platform notices in the app.

Delivered in parts; this spec grows with each.

## Part 1 — provisioning and invitations (2026-09-07)

**Provisioning** (`modules/platform/provisioning.service.ts`). `provisionTenant()` creates the
Company (code, name, legal name, `slug`, contact, GSTIN) and, inside the new tenant: system
ledgers via `ensureSystemLedgersExist`, head-office business place with the GST state code
derived from the GSTIN, the five default roles from `ROLE_DEFS` (Owner, Accounts, Stores,
Production, Sales Executive) mapped to the permission registry, seven units, the current
Indian financial year as an accounting period plus invoice settings, a numbering series for
thirteen document types (`DocumentSequence`, `fyCode` such as `2026-27`), and the settings other
modules read (`EOD_CUTOFF_TIME`, `MOBILE_ORDER_STATUS`). Idempotent: the development seed now
calls it and layers demo data on top; the platform API may re-run it to repair defaults.
`slug` is unique across tenants and reserved for per-tenant login branding and invitation links.

**Platform API** (`/api/platform/tenants`, super admin only): `POST` provisions and invites the
owner (201 on create, 200 when the code already existed and defaults were ensured; 409 for a
taken slug), `GET` lists tenants with user and pending-invitation counts.

**Invitations** (`modules/users/invitation.*`, `Invitation` model with RLS and audit trigger).
`POST /api/invitations` (`users.create`) takes email, optional name and a role; the row stores the
sha256 of a 256-bit token, expires in 7 days, and replaces any pending invitation for the same
email in the tenant. The email carries `${FRONTEND_URL}/accept-invitation?token=…`; outside
production the response also returns `acceptUrl` so local setups without SMTP work. Public
`GET /api/invitations/token/:token` previews (email, company, role, expiry; 404 unknown or
revoked, 410 used or expired); `POST …/accept` takes name, optional username and a password of
ten or more characters, creates the user with the invited role inside the tenant, marks the
invitation accepted and signs the user in (refresh cookie set, access token returned). `GET`,
`POST :id/resend`, `POST :id/revoke` for the office. The old welcome email that carried a
password stays only on the legacy direct-create path and is removed in Part 3.

**Web.** `/accept-invitation` public page: preview, form, sign-in, redirect to the dashboard.

**Tests.** `tenants.spec.ts`: provisioning creates every default and is idempotent, slug
conflicts, platform routes closed to tenants, owner accepts and lands in an empty tenant,
single-use link, colleague invitation replace/revoke/expire, field users cannot invite.
105 API tests.

## Part 2 — onboarding wizard and ToS (planned)

`onboardingStep` on Company (`company` → `gst` → `financial-year` → `bank` → `users` → done),
`tosAcceptedAt/By`; API to read and advance; web wizard replacing the `/company/create` redirect.

## Part 3 — CSV imports, notifications, surrogate keys (planned)

Dry-run CSV imports for customers, suppliers, products, raw materials, opening balances and
opening stock; `Notification` model and in-app centre; uuid primary keys for the seven
code-keyed models; Prisma 8 upgrade evaluation.
