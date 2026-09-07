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

## Part 2 — onboarding wizard and terms of service (2026-09-07)

**State machine.** `Company.onboardingStep` holds the next step to complete:
`company` → `gst` → `financial-year` → `bank` → `users` → `review`; completion sets
`isOnboarded = true` and clears the step. Any step may be revisited until completion (the pointer
only moves forward); after completion every wizard write answers 409 and the ordinary settings
screens take over. `PUT /api/companies/:id` no longer flips `isOnboarded`; only completion does.

**API** (`modules/onboarding`, mounted at `/api/onboarding`; any signed-in member may `GET`, writes
need `company-settings.edit`):

| Route                 | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`               | Step pointer, per-step done flags, terms status and version, and the current values of every step (company, GST and places, financial year, bank accounts with balances, users, pending invitations, roles).                                                                                                                                                                                                                                                                                                                                         |
| `PUT /company`        | Name, legal and short name, contact, address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PUT /gst`            | Registration type (regular, composition, unregistered; stored as the `GST_REGISTRATION_TYPE` setting), GSTIN validated by format, state code and check digit (`isValidGstin` in `@shiftline/shared`), and the full list of places of business (exactly one head office; the GSTIN state must match it; codes unique). Places are upserted by id or code; dropped places are deleted, or deactivated when machines or stores point at them. `Company.gstin` and `state` follow.                                                                       |
| `PUT /financial-year` | `fyStart` (first of a month) and optional `booksBeginOn` (`BOOKS_BEGIN_ON` setting). Re-dates `InvoiceSetting`, renames and re-dates the open accounting period, and moves unused `DocumentSequence` rows (`next = 1`) to the new year code (`2026-27`, or `2026` for a calendar year). Refused with 409 once vouchers exist.                                                                                                                                                                                                                        |
| `PUT /bank`           | Bank accounts: an existing bank ledger (`ledgerId`, for example the provisioned `BANK-001`) is renamed and given details, new ones get the next `BANK-nnn` ledger in the _Bank Accounts_ group. Details live in the new `BankAccount` model (bank, account name and number, IFSC, branch, UPI id, default flag; RLS, audit trigger). A positive `openingBalance` posts the opening journal (`JV-LEDG-OP-<code>`, `LEDGER_OPENING_BALANCE`) dated the day books begin, once per ledger. Exactly one default account. An empty list is a valid "skip". |
| `PUT /users`          | Invitations by email and role code through `invitationService`; per-row result `invited`, `exists` or `error` so one duplicate does not fail the batch. Empty list skips.                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /accept-tos`    | Body `{ version }` must equal `TOS_VERSION` (`2026-09`); records `tosAcceptedAt/By` and the `TOS_VERSION_ACCEPTED` setting.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /complete`      | Requires the pointer at `review` and the current terms accepted; marks the company onboarded.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

`accountsService.ensureSystemLedgersExist()` memoises per tenant now (it was process-wide, so a
second tenant provisioned within five minutes of any report load could have skipped its ledgers).
`postGenericLedgerOpeningBalanceVoucher` accepts an explicit date.

**Shared.** `packages/shared/gst-states.ts`: the 37 GST state codes with names and abbreviations,
`GSTIN_REGEX`, `isValidGstin` (mod-36 check digit) and `stateCodeOfGstin`. The seed and tests use
check-digit-valid placeholder GSTINs (`33AAAAA0000A1Z9`, `29AAAAA0000A1ZY`).

**Web.** `/onboarding` (`modules/onboarding`), rendered without the main layout. `ProtectedRoute`
sends every member of a not-yet-onboarded tenant there and bounces onboarded tenants back to the
dashboard (the old `/company/create` route is gone). Left rail stepper (completed steps are
clickable), one screen per step, review screen with a terms summary and checkbox, "Finish setup"
accepts the terms if needed, completes, refreshes the company and lands on the dashboard. Members
without `company-settings.edit` see a "being set up" page with step progress, refresh and sign out.

**Tests.** `onboarding.spec.ts` (8): provisioned owner lands on step one with defaults; each step
validates and advances (bad GSTIN check digit, GSTIN/head-office state mismatch, mid-month FY start,
bad IFSC); FY change re-dates period, settings and sequences; bank step renames `BANK-001`, creates
`BANK-002` with a balanced opening journal dated the books-begin day and two audit rows; users step
reports invited/exists/error; completion needs the current terms, then locks the wizard; members
without the permission read but cannot write. `e2e/onboarding.spec.ts`: platform admin provisions
a tenant, the owner accepts and completes all six steps in the browser and reaches the dashboard.
113 API tests, 15 browser tests. The leak suite's seed-coverage check is now a subset assertion
against a documented list, so other suites sharing a worker database cannot make it flap.

## Part 3 — CSV imports, notifications, surrogate keys (planned)

Dry-run CSV imports for customers, suppliers, products, raw materials, opening balances and
opening stock; `Notification` model and in-app centre; uuid primary keys for the seven
code-keyed models; Prisma 8 upgrade evaluation.
