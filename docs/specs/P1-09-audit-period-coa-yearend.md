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

## Part D — audit trail viewer and auditor role (planned)

`GET /api/audit-trail` (entity, id, user, action, date range; paginated) behind `audit-reports.view`;
`/reports/audit` page with before/after diff; `AUDITOR` default role with view-only keys.

## Part E — year-end closing (planned)

Closing JV transferring income and expense balances to Retained Earnings on the FY's last day,
periods for the new year, freeze date moved to the year end; prepare/approve two-step with a preview.

## Done means

Postings into a closed or frozen period are refused on every path (tests per path); a cancelled
invoice leaves a reversal and the trial balance still balances; nothing on a books table is
hard-deleted by the API any more (grep gate in CI); the audit log has a screen; the balance sheet
reads by Schedule III heads; a year can be closed and the next year's numbering starts from 1.
