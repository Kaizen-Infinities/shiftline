# P1-09 — Audit trail viewer, period control, chart-of-accounts tree, year-end (MCA)

**Goal.** The books cannot be silently edited or backdated: every posting date is checked against
closed periods, the company freeze date and the user's backdating allowance; nothing that touched
the ledger is deleted, it is cancelled with a reversing entry; the audit log written since P0-13 has
a screen; ledgers sit in a Schedule III group tree; and a financial year can be closed.

## Part A — period control (2026-09-07)

- `periodService.assertPostingAllowed(date, actor)` replaces the never-called `assertDateIsOpen`:
  1. a date inside a closed `AccountingPeriod` is refused (403 `PERIOD_CLOSED`);
  2. a date on or before `Company.booksFrozenUpTo` is refused (403 `BOOKS_FROZEN`) — the accountant
     sets the freeze date after filing a month;
  3. a date more than `Role.backdateDays` days before today is refused for that user (403
     `BACKDATE_LIMIT`); null means no limit, 0 means today only. Platform admins pass.
- The check runs in `safeCreateVoucher` (so every auto-posted, manual and mobile-collection voucher
  passes through it) and at the start of every document create, update and cancel (sales invoice,
  GRN, returns, expense, petty cash, payroll lock), so a document can never exist without its
  voucher because posting was refused after the fact.
- API: `GET/PUT /api/accounts/period-control` (`accounts.view` / `accounts.edit`) reads and sets
  `booksFrozenUpTo`; `PUT /api/roles/:id` accepts `backdateDays`. Closing and reopening periods keep
  their existing endpoints.

## Part B — cancel and reverse instead of delete (2026-09-07)

- `Voucher.status` (`POSTED`, `CANCELLED`), `cancelledAt/By`, `cancelReason`, `reversalOfId`.
  Cancelling a voucher marks it `CANCELLED` and posts a `JOURNAL` reversal (`refDocType =
"REVERSAL"`, `refDocId` = the original id) with the debit and credit sides swapped, dated on the
  original date when that period is open, else on the cancellation date. Reports therefore need no
  status filter: the pair nets to zero, and the ledger statement shows both lines, as auditors
  expect. Opening-balance vouchers cannot be cancelled.
- Documents gain `cancelledAt/By`, `cancelReason` (and a `status` where missing): sales invoice,
  GRN, sales and purchase return, expense, petty cash. `DELETE` routes now cancel: the row stays,
  `status = CANCELLED`, every voucher posted from it is cancelled and reversed, stock effects are
  undone with a reversal stock adjustment (as the old delete already did), customer/supplier
  outstanding is corrected, and the document leaves the "open" lists. Payroll runs may still be
  deleted while `DRAFT` (nothing has been posted); approved or locked runs cannot be deleted.
- `POST /:id/cancel { reason }` is the explicit form; `DELETE /:id` maps to it so the existing web
  keeps working. Cancelling twice is a 409.

## Part C — ledger group tree (2026-09-07)

- `LedgerGroup` (tenant, RLS, audited): `code`, `name`, `nature` (ASSET, LIABILITY, EQUITY, INCOME,
  EXPENSE), `parentId`, `scheduleHead` (the Schedule III line it rolls up to), `isSystem`,
  `isActive`, `sortOrder`. `AccountLedger.groupId` points at a node; the free-text `group` stays as
  the node's name for older screens.
- The standard tree (`ledgerGroups.ts`) is Tally-shaped: Fixed Assets, Investments, Current Assets
  (Cash in Hand, Bank Accounts, Sundry Debtors, Stock-in-Hand, Loans & Advances, Deposits, Tax
  Assets, Other), Misc. Expenses (Asset); Loans (Secured, Unsecured, Bank OD), Current Liabilities
  (Sundry Creditors, Duties & Taxes, Provisions, Other), Suspense; Capital, Reserves & Surplus;
  Sales Accounts, Direct Income, Indirect Income; Purchase Accounts, Direct Expenses, Indirect
  Expenses, Employee Benefits, Finance Costs, Depreciation. Each carries its Schedule III head.
- `ledgerGroupService.ensureLedgerGroups()` runs with `ensureSystemLedgersExist()` (provisioning
  and every posting path), so every tenant has the tree and every ledger is filed: system ledgers
  by code, party ledgers under Sundry Debtors/Creditors, others by `legacyGroupCode()` (name
  match, then keywords, then a default per nature).
- API: `GET /accounts/groups` (tree; `?flat=true` for a picker with paths), `POST /accounts/groups`
  (custom group under a parent, nature and head inherited), `PATCH /accounts/groups/:id` (rename,
  move within the same nature, deactivate when empty; system groups cannot move or deactivate).
  Ledger create/update take `groupId` or a group name; the nature must match.
- Reports: trial balance rows carry `groupCode` and `scheduleHead`; the balance sheet returns
  `scheduleIII` (Shareholders' funds, Non-current liabilities, Current liabilities; Non-current
  assets, Current assets → heads → groups → ledgers, net profit under Reserves and surplus); the
  P&L returns `scheduleIII.income` and `.expenses` by head in statutory order. The web layouts that
  read these are P1-10.
- Web: the chart-of-accounts form picks a group from the tree (filtered by ledger type) and the
  list shows the group path.
- Migration `20260907080000_ledger_groups`; `ledger-groups.spec.ts` (3).

## Part D — audit trail viewer and auditor role

The trigger-written `audit_log` (P0-13) gets a reader. `modules/audit-trail`:

- `GET /api/audit-trail` behind `audit-reports.view`: filters `entity` (table name), `entityId`,
  `action` (CREATE/UPDATE/DELETE), `userId`, `requestId`, `from`/`to` (YYYY-MM-DD, inclusive);
  `page`/`pageSize` (max 200), newest first. Each entry carries the entity label, the actor
  (user, platform admin or system, with `impersonatedBy`), the request id, `changes` (field,
  before, after) for updates, and the redacted before/after rows.
- `GET /api/audit-trail/filters`: the audited entities (from `AUDITED_MODELS`, now in
  `src/lib/audited-models.ts`) and the tenant's users.
- `GET /api/audit-trail/export` behind `audit-reports.export`: CSV of the same filter, capped at
  10,000 rows (`X-Truncated` header when cut).
- Secrets: the trigger drops password hashes, session/refresh tokens, MFA secrets and invitation
  token hashes (migration `20260907090000_audit_trail_redaction`); the reader additionally hides
  any key that looks like a password, secret, token or hash.
- Tenancy: rows are scoped by the Prisma extension and RLS; the reader never writes.
- Web `/reports/audit` ("Audit Trail" under Display → MIS Reports): filter bar, table, expandable
  before/after diff, CSV export, deep-linkable through the query string (`?entity=&entityId=`).
- Default role `AUDITOR` ("Auditor"): view keys on books, documents, stock, reports, GST, payroll
  and settings plus `audit-reports.view/export`; nothing that creates, edits or deletes. The demo
  seed adds `demo.auditor`.

Tests: actor and diff on a voucher's posting and cancellation; user/action/date filters and
pagination; 403 without the permission, auditor reads and cannot post; another tenant's rows never
appear; CSV export.

## Part E — year-end closing

`modules/year-end` closes a financial year in two steps, each behind its own key (`year-end.view`,
`year-end.prepare`, `year-end.approve`; the Accounts role prepares, the Owner approves, the Auditor
reads):

- `GET /api/year-end/preview?fyCode=YYYY-YY` (default: the year that ended most recently) shows the
  closing journal as the books stand: each income and expense ledger's balance for the year on the
  opposite side, and the net result to Retained Earnings (system ledger `EQ-002`, group Reserves &
  Surplus). It also lists blockers (year not ended, already closed, books frozen up to or past the
  year end) and whether an existing preparation has gone stale.
- `POST /api/year-end/prepare` snapshots the lines and their hash into `YearEndClosing`
  (`PREPARED`); one live closing per year (`409 YEAR_END_EXISTS`).
- `POST /api/year-end/:id/approve` recomputes the journal and refuses if the hash moved
  (`409 YEAR_END_STALE`), then in one transaction: posts the closing `JOURNAL` voucher dated the
  year's last day (`refDocType YEAR_END`, number from the year's JV series), closes every open
  accounting period ending on or before the year end, creates the next year's period and its
  head-office numbering series (`SEQUENCED_DOC_TYPES`), moves the freeze date forward to the year
  end, and rolls `InvoiceSetting`'s financial year forward. Closed periods and the freeze date still
  gate the posting; the approve permission stands in for a role's backdating allowance.
- `POST /api/year-end/:id/reverse` (reason required) cancels the closing voucher with a reversal
  and marks the row `REVERSED`; it refuses while the books are frozen up to or past the year end
  (`409 BOOKS_FROZEN`), so the freeze date is moved back first, deliberately. Periods stay closed
  until reopened. `POST /:id/discard` drops a preparation (`DISCARDED`). Nothing is deleted.
- Reports: the statement of profit and loss leaves `YEAR_END` vouchers out, so the year still reads
  as earned; the trial balance and balance sheet include them, so after closing income and expense
  stand at zero and the result sits once in Retained Earnings (the balance sheet's `NET-PNL` line
  counts the closing too and disappears for a closed year).
- `Voucher` cancel refuses a `YEAR_END` entry (`REVERSE_YEAR_END_INSTEAD`).
- Web `/accounts/year-end` ("Year-End Closing" under Accounts): freeze-date card (move back needs a
  tick), year picker, preview table with blockers and stale warning, prepare / approve / discard /
  reverse buttons per permission, and the history of closings.
- Migration `20260907100000_year_end_closing` (RLS, audit trigger); `YearEndClosing` audited.

Tests: stale preparation refused then re-prepared and approved; a full close of FY 2024-25
(post-closing trial balance, P&L still earned, balance sheet once, periods, next-year sequence,
freeze date, refused backdated posting, 409 on a second preparation); reverse only after the
freeze date moves back, closing voucher cancelled, direct voucher cancel refused; current year
refused; permissions.

## Done means

Postings into a closed or frozen period are refused on every path (tests per path); a cancelled
invoice leaves a reversal and the trial balance still balances; nothing on a books table is
hard-deleted by the API any more (grep gate in CI); the audit log has a screen; the balance sheet
reads by Schedule III heads; a year can be closed and the next year's numbering starts from 1.
All five parts shipped (A–E, 2026-09-07).
