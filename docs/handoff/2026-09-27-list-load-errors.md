# List screens — a failed load says so

**Changelog:** Lists across sales, purchasing, inventory, people, reports and accounts now show
"Couldn't load this list" with a "Try again" button when a load fails, instead of an empty list.

## Before

`useListCache` gained an `error` in the dashboard hardening pass, but only the dashboards read it.
Every other screen that loads through it still showed its "No records found" empty state when the
request failed. The same was true of `useDepartments`, `useRoles` and `usePermissions`: they
returned a hard-coded `error: null`, and their pages announced it with a toast that could never
fire. The OEE page also kept polling every minute while its tab was hidden.

## Now

- **Shared components.** `LoadError` and `StaleNotice` in `components/ui/v2/LoadError.tsx`:
  - `LoadError` is a failed-load panel with `role="alert"` and a retry button at least 40 px tall;
  - `StaleNotice` is a one-line "Couldn't refresh. Showing the last data that loaded." with a
    retry.
- **`DataTable`** takes `error` and `onRetry`. With no rows it shows `LoadError` instead of the
  empty message; with rows it keeps them and shows `StaleNotice` above the grid.
- **Screens on `DataTable`** now pass the cache's `error` and `refresh` to their table:
  - every list screen that loads through `useListCache`, including categories, customers,
    suppliers, machines, employees, orders, invoices and stock;
  - chart of accounts, and sales and purchase returns;
  - the supplier and customer breakdown tabs;
  - the four report centres. The production report centre picks the error for the chosen report
    type (weekly from the cache, hourly and daily from the Redux slices).
- **Accounts screens that build their own table** get the same two states:
  - the payment, receipt, journal and contra registers, and the voucher list;
  - the bank statement and bank accounts;
  - amount payable, amount receivable and petty cash.
- **Misleading figures on failure.** Bank accounts shows "—" for the total balance, and
  customers drops the "0 customers" count.
- **Voucher entry forms.** The four forms show "Couldn't load your ledgers, so the account lists
  below are empty." with a retry when their ledger list fails.
- **Hooks.** `useDepartments`, `useRoles` and `usePermissions` return the real error (and
  `usePermissions` now returns `refresh`). Their three list pages show it in the table and no
  longer raise a toast.
- **OEE polling.** The OEE page skips its minute ticks while the tab is hidden and refreshes as
  soon as it is shown.
- **Formatting commit.** The three hooks were reformatted with prettier in a commit of their own,
  so the behaviour change reads as a small diff.

## Checks

- **Local.** Web typecheck and web unit tests pass, and there are no new lint warnings.
- **Failure states on the running stack.** I forced the list APIs to fail for customers,
  machines, departments, payment vouchers, bank accounts and the receipt voucher form, at 1440 px
  and 390 px.
- **Smoke suite.** 57 of 60 tests passed.
  - Onboarding and "plans render" pass once they log in as this machine's platform admin (see the
    `.env` note below).
  - "The console lists tenants and a platform admin can act as a tenant owner" fails. After "Stop
    impersonating", the home dashboard's inventory tile fires four requests without a tenant,
    and they return 500.
  - That test fails the same way on the commit before this session's work, so the race already
    existed. It is still open.

## Not done

- A list screen that filters on the client (search or tabs) shows "Couldn't load this list" when
  a refresh fails and the filter happens to match nothing. `DataTable` only sees the filtered rows.
- An unquoted `ADMIN_PASSWORD=DevAdmin#2026!!` in `apps/api/.env` is read by dotenv as `DevAdmin`,
  because `#` starts a comment. The README's platform-admin password only works under Docker,
  whose `env_file` parsing keeps the `#`.
