# P1-17 — Foreign exchange and imports

## Why

The currency master, the rate table and foreign-currency sales invoices landed with P1-14,
because export invoices needed them. What was left out is everything that happens _after_ a
foreign-currency document is raised, and it is the part that moves the profit:

- The rupee moves between the day a bill is raised and the day it is settled. The difference is a
  **realised** gain or loss and belongs in the accounts on the day the money lands.
- At a year end, anything still outstanding in a foreign currency has to be restated at the
  closing rate (AS 11 / Ind AS 21), and that difference is an **unrealised** gain or loss.
- An **import** is not a purchase with a foreign price on it. Customs duty, IGST under section
  3(7) of the Customs Tariff Act, and the freight and clearing charges all land separately, the
  IGST is creditable while the basic duty is not, and what the stock actually cost is the whole
  lot apportioned across the goods.

## Scope

- **Rates**: an `ExchangeRateProvider` interface with a fixture adapter and an RBI reference-rate
  adapter, so a tenant can pull the day's rates rather than typing them. Secrets, where a provider
  needs them, are encrypted like every other provider's.
- **Realised gain and loss**: when a foreign-currency invoice or bill is settled, the difference
  between the rate it was raised at and the rate the money came in at is posted to FX gain or
  loss.
- **Restatement**: a period-end run that revalues every open foreign-currency balance at the
  closing rate, posts the unrealised difference, and reverses itself on the first day of the next
  period — because an unrealised difference is an opinion about a rate, not a transaction, and it
  must not survive into the month where it will be realised.
- **Imports**: a bill of entry against a purchase — assessable value, basic customs duty, social
  welfare surcharge, IGST and cess — with the creditable IGST going to the input-credit ledger,
  the non-creditable duty going into the cost of the goods, and the landed cost apportioned to
  the lines by value.

## Out of scope

Forward contracts and hedge accounting, cash-flow hedges under Ind AS 109, a second reporting
currency for the whole company, and duty drawback or advance-authorisation schemes.

## Acceptance

- A bill raised at 83 and settled at 84 posts a gain of one rupee per unit of currency, on the
  settlement date.
- A restatement at a year end posts the unrealised difference and reverses it on day one of the
  next period.
- Restating twice for the same period does not double the entry.
- An import apportions landed cost by value and puts the creditable IGST in the credit ledger
  rather than in stock.
- Every query is tenant-scoped.
