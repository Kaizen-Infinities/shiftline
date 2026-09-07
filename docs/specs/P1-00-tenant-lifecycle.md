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

## Part 3a — CSV imports with dry run (2026-09-07)

**Module** `modules/imports`, mounted at `/api/imports`. Six import types, each with a column
list (template, header matching, docs), a zod row schema and the permission that allows it:

| Type               | Permission (any of)                                                         | Creates                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`        | `customers.create`                                                          | Customer, default address, ledger under Sundry Debtors, opening receivable/payable voucher; customer type and grade by name (created when missing) |
| `suppliers`        | `suppliers.create`                                                          | Supplier, ledger under Sundry Creditors, opening voucher; `stateCode` from the column, the GSTIN or the state name                                 |
| `products`         | `products.create`                                                           | Product (category by code, type PRODUCT), opening finished-goods stock in a named store                                                            |
| `raw-materials`    | `raw_materials.create`                                                      | Raw material (category by code, store by id), opening quantity with an `OPENING_STOCK` movement                                                    |
| `opening-balances` | `accounts.create`, `chart-of-accounts.create`                               | Opening journal per ledger (`LEDGER_OPENING_BALANCE`, contra Opening Balance Equity); new ledgers from name, type and group; party ledgers refused |
| `opening-stock`    | `finished_goods_stocks.create`, `raw_material_stocks.create`, `stores.edit` | `OPENING_STOCK` movement and on-hand increment per item and store, once                                                                            |

Routes: `GET /types` (types the caller may run, with columns), `GET /templates/:type` (CSV with
header and example row), `POST /:type?dryRun=true|false` (multipart `file`, 5 MB, 5,000 rows).
Headers match case- and punctuation-insensitively (`Customer Code`, `customer_code`,
`customerCode`); unknown columns are reported as ignored; a missing required column is a 400.
Cells are coerced (`"1,25,000.50"`, `yes/no`, `DR/CR`, `;`-separated phones); GSTINs are
check-digit validated. The dry run returns a report with every row's status (`ok`, `exists`,
`error`) and messages; duplicates within the file are errors, rows whose code already exists are
skipped. A commit with any error row is a 400 carrying the report; otherwise rows are created
sequentially through the module services (so ledgers, vouchers and movements follow the same
paths as the screens), and an unexpected failure stops the run and reports the row (207). Opening
entries and movements are dated `BOOKS_BEGIN_ON` from onboarding, else the financial-year start.
A small RFC 4180 parser (`imports.csv.ts`) avoids a new dependency.

Fix on the way: `rawMaterialService.create` used `connect` for store, category and location, which
the tenant extension breaks by adding `companyId` to `data`; it now writes scalar foreign keys.

**Web.** `/settings/imports` (Configuration → Data Imports): type picker limited to what the user
may run, column reference, template download, file pick triggers the dry run, filterable row
report, Import button enabled only for a clean report. Added to the browser smoke suite.

**Tests.** `imports.spec.ts` (8): type listing by permission and templates; customer dry run
(bad check digit, in-file duplicate, existing code, missing code) writes nothing and a commit with
errors is refused; customer commit creates ledgers, types, grades, addresses and opening
vouchers and is idempotent; supplier state code derivation and mismatch; products and raw
materials with reference errors and opening quantities; opening balances for existing and new
ledgers dated the FY start, refused for party ledgers, `exists` on re-run; opening stock
increments once; permissions per type. 121 API tests.

## Part 3b — notification centre (2026-09-07)

**Model.** `Notification` (RLS; one row per recipient: `userId`, `level` INFO/SUCCESS/WARNING/ERROR,
`category`, `title`, `body`, `link`, `data`, `readAt`, `createdBy`). Fan-out at write time keeps
read state and retention per user; a new `NOTIFICATIONS` retention class (30-day floor, 180-day
default, purge) sweeps old rows. Sockets now also join `user:<userId>`; `emitToUser()` in
`lib/realtime.ts` addresses one person.

**Producer API.** `notify({ category, title, body?, link?, level?, data?, to, createdBy? })` in
`modules/notifications/notify.ts`, callable from requests and jobs under a tenant context. Audiences:
`{ userIds }`, `{ permission, exclude? }` (active users whose role holds the key) or
`{ all: true, exclude? }`. Platform admin ids are never recipients. It never throws into the
caller: the business action already happened, the notice is a courtesy. Each recipient's sockets
receive `notification:created`.

**First producers.** Invitation accepted → the inviter ("X joined", `/users`); onboarding completed
→ every other member ("Setup complete"); CSV import committed → the person who ran it (counts, or
the row it stopped at, `/settings/imports`); retention sweep with effect or errors → `retention.view`
holders; end-of-day snapshot failure → `eod-stock.view` holders. The seed leaves a welcome notice for
every demo user.

**Reader API** (`/api/notifications`, signed-in tenant users): `GET /?unread=&limit=&cursor=`
(newest first, `unreadCount`, `nextCursor`), `POST /:id/read`, `POST /read-all`. Rows are scoped
to the caller; another user's id is a 404.

**Web.** Bell in the header (`NotificationBell`): unread badge, dropdown of the latest twelve,
mark-all-read, click opens the link; fed by the socket room with a one-minute poll fallback.
`/notifications` page lists everything with unread filter and paging. Both in the smoke suite.

**Tests.** `notifications.spec.ts` (5): permission audience reaches only holders; per-recipient read
state and 404 across users; unread filter and read-all; everyone-except and explicit audiences,
admin ids skipped; cursor paging; invitation acceptance notifies the inviter; import commit leaves
a record. 126 API tests.

## Part 3c — tenant-scoped business codes and the Prisma decision (2026-09-07)

**Problem.** Store, Machine, RawMaterial, ProductionOrder, WeeklyMachineProgram, DailyProductionPlan
and Location used their business code as the primary key, and Shift had a global unique on
`shiftCode`. A primary key is unique across the whole database, so tenant B could not create machine
`M-01` once tenant A had one, and every foreign key to these rows pointed at a global code.

**Change** (migration `20260907030000_tenant_scoped_codes`). Each of the eight models now has a
uuid primary key (`id`, `gen_random_uuid()` at the database so existing rows fill in) and
`@@unique([companyId, <code>])`. All 47 relations that pointed at a code now pair it with
`companyId` on both sides (`fields: [companyId, storeId], references: [companyId, storeId]`), so a
row can only reference a store, machine, order, program, plan, material, location or shift in its
own tenant, enforced by the database as well as by RLS. Column names, API paths (`/stores/:storeId`)
and payloads are unchanged: codes remain what users type and what the web app sends; responses
carry the extra `id`.

**Code.** `where: { storeId }` is no longer a unique selector. `byCode("storeId", value)` in
`lib/prisma.ts` returns the composite selector for the current tenant and is used at the 176 unique
lookups a tsc-driven codemod rewrote; the tenant extension also rewrites the legacy shape at
runtime (`CODE_KEYS`), so untyped callers keep working. Nested `connect: { storeId }` became
`connect: byCode(...)`. The audit trigger on `raw_materials` records the uuid as `entityId` now.
`RawMaterial.create` also stopped using `connect` for its foreign keys (part 3a), which the
tenancy extension could not combine with the injected `companyId`.

**Tests.** `tenant-codes.spec.ts` (4): a second tenant reuses the demo tenant's store, machine,
shift and raw-material codes and its material resolves to its own store; typed and legacy lookups
stay inside the caller's tenant; the API serves each tenant its own row for the same code; a
reference to another tenant's store code fails on the composite foreign key. 133 API tests; the leak
suite's tenant B no longer needs prefixed codes (kept for readability).

**Prisma 7/8.** Evaluated in `docs/decisions/2026-09-07-prisma-7-8.md`: stay on 6.19.x through
Phase 1; Prisma 7.10 still ships the allowlisted deepmerge-ts, and 7+ removes the runtime DMMF the
tenancy extension and the RLS/audit generators rely on. The move is scheduled as its own package
after Gate 1 with a checklist.

**Left for later.** `POST /api/users` with an emailed password is still mounted; the Users screen
gains an Invite button and the legacy path is removed together (P1-02 admin console work touches
that screen).
