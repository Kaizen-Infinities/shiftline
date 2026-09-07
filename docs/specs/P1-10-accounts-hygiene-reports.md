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

## Part B — day book, cash book, bank book, cash flow

- `GET /api/accounts/day-book` (`startDate`, `endDate`, `type`, `search`, `includeCancelled`):
  vouchers by date with their ledger lines and day totals; cancelled vouchers are left out unless
  asked for; capped at 5,000 vouchers with a `truncated` flag.
- `GET /api/accounts/cash-book`: the merged running statement of every ledger under Cash-in-Hand
  (falls back to `CASH-001`/`PCASH-001` on an ungrouped chart).
- `GET /api/accounts/bank-book` lists the ledgers under Bank Accounts and Bank OD;
  `GET /api/accounts/bank-book/:ledgerId` is one of them as a running statement (any other
  ledger is refused with 400).
- `GET /api/accounts/cash-flow?startDate&endDate` (`cash-flow.service.ts`), indirect method:
  every balance-sheet ledger's movement in the period is a cash effect of the opposite sign,
  classified by its nearest system group — working capital (operating), Fixed Assets and
  Investments (investing), Capital, Reserves and loans (financing). Cash and equivalents are
  Cash-in-Hand plus Bank Accounts less Bank OD. Depreciation (ledgers under the Depreciation
  group) is added back to profit and removed from the fixed-asset movement, which assumes it is
  credited to a Fixed Assets ledger (net block). Year-end closing entries are ignored. The
  response carries opening and closing cash from the trial balance and `reconciles`; by
  double entry the sections always sum to the change in cash, so a difference means an
  unbalanced voucher.
- Web: `/accounts/day-book`, `/accounts/cash-book`, `/accounts/bank-book` (one page, three tabs,
  expandable voucher lines, links to the ledger statement) and `/accounts/cash-flow` (sections
  with group drill-down and the cash reconciliation), under Display → Account Books and
  Financial Statements. Both new screens are in the smoke suite.
- Tests: a scripted period (capital, machine purchase, depreciation, cash sale, contra) checks
  each section, the tie to cash, the day book totals and filters, cancellation visibility, the
  cash and bank books, refusals and permissions.

## Part C — Schedule III web layouts, statements of account

- Balance sheet and P&L pages gain **Schedule III · Summary / Detailed** variants that render the
  `scheduleIII` structures the API already returns (sections → heads → groups → ledgers, in
  statutory order, with Roman numerals and bracketed negatives) through
  `modules/accounts/components/ScheduleIII.tsx`. The other variants are unchanged.
- `GET /api/accounts/statements/customer/:id` and `…/supplier/:id` (`startDate?`, `endDate?`,
  default up to today; `statement.service.ts`): company block, party block (code, name, GSTIN,
  email, phone), the party ledger's opening, entries and closing for the period, and the
  ageing of what is still unpaid as on the end date (buckets, overdue, interest, documents).
  `…/pdf` renders the same through `templates/statementTemplate.ts` and the PDF generator;
  `POST …/send { channel: email|whatsapp, to?, startDate?, endDate?, message? }` attaches the
  PDF and sends it to the given contact or the party's own email / WhatsApp number. Delivery
  failures come back as a sanitised 502; nothing about SMTP or Meta reaches the client. Customer
  routes need `receivable.view`, supplier routes `payable.view`.
- Web: a **Statement** button on the customer and supplier breakdown pages opens
  `StatementPanel` (period, opening / closing / overdue summary, Open PDF, Email, WhatsApp with
  the party's contact pre-filled).
- Tests: customer statement ties to the invoice and the ageing; supplier statement; unknown
  parties, inverted dates, permissions; send validation (channel, missing or malformed contact)
  before anything is generated. Balance sheet and P&L screens join the smoke suite.

## Part D — hygiene (planned)

Web `/expenses` route restored; expense claims with approval; `PUT /returns/purchase/:id`;
vouchers' cash/bank side guard by `groupCode`; cancel-with-reason dialogs and CANCELLED badges;
"History" links to `/reports/audit`.

## Done means

Every unpaid invoice and bill has a due date and appears in exactly one ageing bucket; the ageing
totals tie to the party balances on the statements; day, cash and bank books agree with the
ledger; the cash flow statement's closing cash equals the balance sheet's; Schedule III layouts
render on the web; a customer can receive a statement of account without anyone leaving the app.
