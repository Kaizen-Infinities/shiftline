# P1-09 part C — ledger group tree

## Shipped

- `LedgerGroup` tree per tenant (Tally-shaped groups, each with its Schedule III head), seeded and
  kept complete by `ensureLedgerGroups()`; every ledger filed under a node (system by code, parties
  under Sundry Debtors/Creditors, the rest by name or keyword mapping).
- `GET/POST /accounts/groups`, `PATCH /accounts/groups/:id`; ledgers accept `groupId` or a group
  name with a nature check; list responses include `ledgerGroup`.
- Trial balance rows carry `groupCode` and `scheduleHead`; balance sheet and P&L return a
  `scheduleIII` structure in statutory order.
- Chart-of-accounts screen: group picker from the tree, group path in the list.
- Migration `20260907080000_ledger_groups` (RLS, audit trigger); 3 tests; routes and leak
  snapshots updated. `/accounts/chart-of-accounts` added to the smoke suite.
- Verified locally: 160 API tests in 31 files, 19 browser tests, typecheck and lint clean.

## Half-done / known gaps

- Web balance sheet and P&L still render the legacy `groupedAssets` layout; the Schedule III
  layouts are P1-10 scope and read the new `scheduleIII` field.
- No screen to add or move custom groups yet (API only); the chart-of-accounts page only picks
  from the tree.
- Payment/receipt side guard in `vouchers.service` still detects bank or cash ledgers by group
  name; switch it to `groupCode` (CASH_IN_HAND, BANK_ACCOUNTS, BANK_OD) in P1-10.

## Next

- P1-09d audit trail viewer and auditor role; P1-09e year-end closing.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
