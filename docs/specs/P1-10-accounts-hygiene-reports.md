# P1-10 — Accounts hygiene and reports

Finishes the bookkeeping surface an Indian manufacturer's accountant expects once the books are
compliant (P1-08, P1-09): due dates and ageing, the day/cash/bank books, a cash flow statement,
Schedule III layouts on the web, statements of account that can be sent, and the leftovers listed
in the P1-09 hand-offs. Built in four parts.

## Part A — due dates and ageing

- `Supplier.creditDays` joins `Customer.creditDays`; `Customer.overdueInterestRate` (annual %,
  optional). Migration `20260907110000_credit_terms`.
- A sales invoice saved without a due date falls due `invoiceDate + customer.creditDays`; a GRN
  bill without one falls due `supplierInvoiceDate ?? grnDate + supplier.creditDays` (create and
  update). No credit days means due on the document date.
- `GET /api/accounts/receivable/ageing` and `GET /api/accounts/payable/ageing`
  (`asOnDate`, `search`, `customerId` / `supplierId`): one row per party with the unpaid balance
  in buckets `notDue`, `d0_30`, `d31_60`, `d61_90`, `d90_plus`, plus `total`, `overdue`, the
  oldest due date and simple interest on overdue balances at the customer's rate; totals across
  parties. Asking for one party adds `documents` (number, date, due date, amount, paid, balance,
  days overdue, bucket, interest). Balances are document balances (grand total less the payments
  recorded on the document), which is what the party recognises on a statement; cancelled and
  draft documents are left out. Routes sit before the `:id` routes and behind `receivable.view` /
  `payable.view`.
- Web: an **Ageing** toggle on the receivable and payable screens swaps the balances table for
  the ageing table (shared `AgeingTable`), with drill-down per party and a link to the party's
  breakdown; the customer form gets "Overdue interest % p.a.", the supplier form "Credit Days".
- Tests: due dates from credit days on both documents; buckets, interest, drill-down, as-on date
  before and on the due date; validation of the new fields; permissions.

## Part B — day book, cash book, bank book, cash flow (planned)

`GET /accounts/day-book` (vouchers by date with lines), `/accounts/cash-book`,
`/accounts/bank-book/:ledgerId` (running balance), `/accounts/cash-flow` (indirect method from
the P&L and balance-sheet movements by ledger group); web pages under Display → Account Books.

## Part C — Schedule III web layouts, statements of account (planned)

Balance sheet and P&L pages render the `scheduleIII` structures (toggle with the grouped view);
`GET /accounts/statements/:partyType/:id.pdf` and `POST …/send` (email or WhatsApp) for a period
statement with opening, lines, closing and ageing.

## Part D — hygiene (planned)

Web `/expenses` route restored; expense claims with approval; `PUT /returns/purchase/:id`;
vouchers' cash/bank side guard by `groupCode`; cancel-with-reason dialogs and CANCELLED badges;
"History" links to `/reports/audit`.

## Done means

Every unpaid invoice and bill has a due date and appears in exactly one ageing bucket; the ageing
totals tie to the party balances on the statements; day, cash and bank books agree with the
ledger; the cash flow statement's closing cash equals the balance sheet's; Schedule III layouts
render on the web; a customer can receive a statement of account without anyone leaving the app.
