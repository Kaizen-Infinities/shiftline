# P1-07 — MSME dues and section 43B(h)

## Why

Since April 2024, a payment to a micro or small supplier that is late under section 15 of the
MSMED Act is not deductible in the year it was incurred — section 43B(h) of the Income-tax Act
allows it only in the year it is actually paid. For a manufacturer buying on 60- and 90-day terms
from small vendors, that single clause can move a large part of a year's purchases into the next
year's accounts and add tax on profit the company never made.

The clock is short and nobody watches it: **15 days** from acceptance where there is no written
agreement, and at most **45 days** where there is. Miss it and the deduction moves, whatever the
terms the parties actually agreed.

## Scope

- **On the supplier**: Udyam registration number, category (micro, small, medium or not
  registered), the date the certificate was seen, whether there is a written contract, and the
  agreed payment days. The limit is derived, never typed: no written contract is 15 days, a
  written one is the agreed days capped at 45.
- **A clock per bill**, from the day of acceptance (the receipt date, falling back to the bill
  date) rather than the invoice date, because that is what section 15 counts from. Each bill
  carries what is still unpaid, the day it falls due, and how many days are left.
- **Alerts** through `notify` at 15 days left and 2 days left — which on a 45-day clock is day 30
  and day 43 — run daily on pg-boss, de-duplicated on the notification link.
- **The 43B(h) report** as at a year end: bills to micro and small suppliers still unpaid whose
  section-15 date had already passed, grouped by supplier, with the total that is disallowed.
  Alongside it, what was paid late during the year, because that is the amount coming _back_ as a
  deduction this year having been disallowed last year.
- **MSME Form 1**, the half-yearly MCA return of dues outstanding beyond 45 days, built from the
  same data and registered on the filing gate like every other return.

## Out of scope

Verifying a Udyam number against the government portal (a paid API), interest under section 16
(compound interest at three times the bank rate — real, but almost never paid, and posting it
would misstate the books), and the supplier's own side of the transaction.

## Acceptance

- The limit is 15 days without a written contract and the agreed days capped at 45 with one.
- The clock counts from acceptance, not from the invoice date.
- A bill paid within the limit never appears in the disallowance; one paid a day late appears in
  the year it was paid and not in the year it was incurred.
- Medium enterprises and unregistered suppliers are never disallowed — 43B(h) reaches micro and
  small only.
- The daily job warns once per threshold, not once per day.
- Every query is tenant-scoped.
