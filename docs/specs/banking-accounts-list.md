# Banking — list the tenant's bank accounts

## Why

Bank reconciliation is broken for every tenant. The screen fills its account picker from
`GET /api/accounts/bank-accounts`, which returns cash and bank _ledgers_ with integer ids. Every
`/api/banking/*` endpoint wants a `BankAccount` uuid. The first call after the picker loads is a
400, and no one can reach the statement, the BRS or the cheques tab. Nothing lists `BankAccount`
rows; only the onboarding wizard reads them.

## Scope

- `GET /api/banking/accounts`, behind `banking.view`, returns the tenant's `BankAccount` rows
  ordered by `createdAt` then `id`: `id`, `bankName`, `accountNumber`, `ledgerId`, `isActive`,
  `isDefault`. The account number is returned as the statement endpoints already return it; no
  secret lives on the model and IFSC, UPI id and branch are left out because the picker does not
  need them.
- The query lives in `bankingService.accounts()` and uses the tenant-scoped client.
- The Bank Reconciliation screen reads this endpoint through `bankingService`, lists active
  accounts as "bank name · account number", preselects the default one, and with no account shows
  a guide message and fires no banking calls.

## Out of scope

Creating or editing bank accounts (onboarding owns that), and any change to
`/api/accounts/bank-accounts`, which still serves the ledger-based screens.

## Tests

Integration (`banking.spec.ts`): the owner gets the seeded account with the expected fields and no
unlisted ones; a user without `banking.view` gets 403; a second company's bank account never
appears for the demo tenant, and the demo tenant's never appears for the second.

## Done when

`/api/banking/lines?bankAccountId=<uuid from the picker>` answers 200 on the running stack, CI is
green, and the changelog says: "Bank reconciliation now lists your bank accounts again."
