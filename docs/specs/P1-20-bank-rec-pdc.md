# P1-20 — Bank reconciliation and cheques

## Why

The bank's balance and the company's cash book never agree, and the gap is where errors hide: a
cheque issued three weeks ago and still not presented, a charge the bank took without telling
anyone, a receipt entered twice. Reconciling by eye against a printed statement is slow enough
that most small companies do it once a quarter, which is exactly long enough for a mistake to
become impossible to trace.

Post-dated cheques are the other half. In Indian trade they are the normal instrument, a
receivable that becomes money on a date — and one that can bounce, taking a charge and a reversal
with it.

## Scope

- **Statement import** from CSV: a parser that reads the column layouts HDFC, ICICI, SBI, Axis
  and Kotak actually export, plus a generic mapper for anything else. Amounts come in as separate
  debit and credit columns or as one signed column, dates in four different orders — the parser
  normalises both rather than asking the user to reformat a file their bank gave them.
- **Auto-matching** of statement lines to posted vouchers: exact amount, a date within a
  tolerance, and a reference that survives normalisation. Each match carries a confidence, and
  anything below the bar is left for a person rather than guessed at.
- **Manual match and unmatch**, because the automatic rules will always be wrong about something.
- **The BRS**: bank balance per the statement, book balance per the ledger, and the reconciling
  items between them — cheques issued but not presented, deposits not yet credited, and bank
  charges not yet in the books.
- **The cheque register**, received and issued: post-dated cheques with the date they become
  money, deposit, clearing, and bounce — the last posting a reversal and the bank's charge.

## Out of scope

Direct bank feeds (account aggregator or corporate API — none is available), automatic posting of
unmatched bank charges (a charge posts when a person says what it is), and cheque printing.

## Acceptance

- A statement in each bank's layout imports with the right dates and the right sign.
- A line matching a voucher on amount, date and reference is matched automatically; one matching
  on amount alone is not.
- Importing the same statement twice does not duplicate the lines.
- The BRS reconciles: book balance plus or minus the reconciling items equals the bank balance.
- A bounced cheque reverses the receipt and posts the bank's charge.
- Every query is tenant-scoped.
