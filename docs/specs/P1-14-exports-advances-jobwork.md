# P1-14 — Exports, advances and job work

## Why

Three things a manufacturer does that the sales pipeline could not express. An export leaves the
country under a bond or on payment of IGST, and the shipping bill that proves it left is what the
portal matches against customs before the refund comes — GSTR-1's export table has been going out
without it. An advance is money taken before the invoice exists, and tax on it falls due the day
it arrives, so it needs its own document, its own tax, and an adjustment that releases that tax
rather than charging it twice. Job work moves goods out without selling them, and the credit on
those goods is only safe while they come back inside a year (three for capital goods).

## Scope — part A (exports, currency, advances)

- `SalesInvoice` gains `exportType` (under a bond or with tax), `lutNumber`, `shippingBillNo`,
  `shippingBillDate`, `portCode`, and `currencyCode`/`exchangeRate`/`foreignTotal`. GSTR-1's EXP
  rows carry `sbnum`, `sbdt` and `sbpcode`, and the return warns about an export with no
  shipping bill instead of quietly sending one the portal cannot match.
- `Currency` master and `ExchangeRate` (one rate per currency per day, rupees per unit, manual or
  imported). A foreign-currency invoice converts its line rates at the rate published on or
  before its date, so every stored figure — line and header — is in rupees and nothing
  downstream needs to know the document was ever foreign; `foreignTotal` keeps what the customer
  was billed. An invoice in a currency with no rate is refused rather than posted 1:1.
- `AdvanceReceipt` and `AdvanceAdjustment`: the receipt carries GST worked out _inside_ the
  amount received, credits an advances-received liability rather than the customer's account,
  and credits the output-tax ledgers straight away. Adjusting it against an invoice releases the
  tax in proportion; refunding it gives the tax back through a refund voucher with its own
  number. GSTR-1 tables 11A and 11B report both.
- Routes `/api/advances` (list, open-for-customer, create, adjust, refund) and `/api/currencies`
  (master and rates). Permissions `advances.{view,create,refund,export}` and
  `currencies.{view,edit}`. Web: `/sales/advances` and `/settings/currencies`.

## Scope — part B (job work and delivery challans)

- `JobWorker` master and `DeliveryChallan` for goods moving without a sale: job work out and in,
  transfers between the company's own places, exhibitions and line sales. Material sent, received
  back, consumed and scrapped, per challan.
- The 1-year and 3-year return clocks with alerts before they lapse, the job-work register, and
  ITC-04 for the half-year.
- A delivery challan PDF carrying the e-way bill number.

## Out of scope

Realised and unrealised FX gain or loss, import purchases with customs duty and landed cost —
those are P1-17, which builds on the currency master this package adds. Advances _paid_ to
suppliers. Deemed-export refund claims (RFD-01).

## Acceptance

- `advances.spec.ts`: an advance of ₹11,800 at 18% is ₹10,000 plus ₹1,800, not ₹11,800 plus tax;
  its voucher credits the liability and the tax ledgers, not income; a part adjustment releases
  exactly its share of the tax and moves only money; over-adjustment, a cancelled document and
  another customer's invoice are refused; a refund returns the tax through a numbered voucher;
  11A and 11B carry the advance and then its adjustment; an export carries its shipping bill into
  the EXP table and one without is warned about; a foreign invoice with no rate on file is
  refused, and with one it bills in the currency and posts in rupees.
- `jobwork.spec.ts` (part B): challan out and part return, the balance and the clock, the alert
  before a year is up, scrap, ITC-04 for a half-year, and a cross-tenant challan returning
  nothing.
