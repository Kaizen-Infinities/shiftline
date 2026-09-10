# P1-00 part 2 — onboarding wizard and terms of service

## Shipped

- `/api/onboarding`: state, six steps (company, GST and places, financial year, bank accounts,
  team invitations, review), terms acceptance with a version, completion that marks the tenant
  onboarded and locks the wizard. Writes need `company-settings.edit`; reads need a login.
- `BankAccount` model (details for a bank ledger; RLS, audit trigger; migration
  `20260907013000_bank_accounts`); the wizard posts opening balances dated the day books begin.
- `@shiftline/shared`: GST state table and GSTIN check-digit validation, used by API and web.
- Web wizard at `/onboarding` replacing the `/company/create` redirect; colleagues of an
  unfinished tenant see a progress page instead of a broken dashboard.
- Fixes found on the way: the system-ledger memo was process-wide (a second tenant could skip
  ledger creation for five minutes); `PUT /companies/:id` no longer marks a tenant onboarded; the
  leak suite's seed-coverage assertion no longer depends on which suites share a worker database.
- Tests: 113 API (onboarding.spec.ts adds 8), 15 browser (onboarding flow added).

## Half-done / known gaps

- Terms text on the review screen is a summary; the full terms document is still to come from
  Kaizen Infinities and should be linked there (bump `TOS_VERSION` when it lands).
- Places of business carry only the GST state code; a GSTIN per place arrives with P1-08.
- `GST_REGISTRATION_TYPE`, `BOOKS_BEGIN_ON` and `TOS_VERSION_ACCEPTED` live in `SystemSetting`
  until P1-08 gives registration type a column.
- The Users screen still has no "Invite" button (the wizard covers first invitations); the legacy
  `POST /api/users` with an emailed password is retired in Part 3.
- Opening balances for customers, suppliers and stock are Part 3 (CSV imports), dated
  `BOOKS_BEGIN_ON`.

## Next

- Part 3: CSV imports with dry-run validation, notification centre, surrogate keys for the seven
  code-keyed models, Prisma 8 evaluation, retire the legacy user-create path.

## Blocked on you

- Branch protection and the approver handle (since P0-00).
- Pentest vendor booking (Gate 0 criterion).
- Anthropic API key for cheque OCR, or the decision to drop OCR (P0-11).
- The terms-of-service document for the review step.
