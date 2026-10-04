# P1-14 part A — exports, foreign currency and advances

## Shipped

- **Exports.** `SalesInvoice` gains `exportType` (`UNDER_LUT` | `WITH_TAX`), `lutNumber`,
  `shippingBillNo`, `shippingBillDate` and `portCode`. GSTR-1's EXP rows now carry `sbnum`,
  `sbdt` and `sbpcode`, and `exp_typ` comes from the document rather than being inferred from
  whether IGST happened to be charged. An export with no shipping bill still goes out, with a
  warning naming it — it is the portal's match against customs, and a silent omission is a
  refund that never arrives.
- **Currency.** `Currency` master (seeds a common list on first read) and `ExchangeRate`, one
  rate per currency per day in rupees per unit. `rateFor` takes the rate published _on or
  before_ the document's date, because a holiday has no rate of its own, and refuses when there
  is none rather than posting a dollar as a rupee. A foreign invoice converts its line rates up
  front, so every stored figure — line and header — is in rupees and nothing downstream needed
  changing; `foreignTotal` keeps what the customer was billed, and the rate is frozen onto the
  document so a later correction cannot restate a closed month.
- **Advances.** `AdvanceReceipt` and `AdvanceAdjustment` with `advance.service.ts` and
  `advance.posting.ts`. The receipt works the tax out _inside_ the amount received, credits
  `ADV-CUST-001` (a new system ledger: money owed until it is earned) and credits the output-tax
  ledgers immediately. Adjusting against an invoice releases the tax in proportion and moves only
  money, because the invoice carries its own tax. Refunding returns the tax through a numbered
  refund voucher. GSTR-1 tables 11A and 11B (`at`, `txpd`) report both.
- Routes `/api/advances` (list, `open?customerId=`, create, adjust, refund) and `/api/currencies`
  (master, rates). Permissions `advances.{view,create,refund,export}`, `currencies.{view,edit}`
  in the `sales` feature, granted to Owner and Accounts. New document series `RV` and `RFV`.
- Web: `/sales/advances` (the form shows the tax split as the amount is typed, which is the
  number people get wrong) and `/settings/currencies`. Both in `e2e/smoke.spec.ts`.
- Migration `20260912070000_exports_currency_advances` with RLS and audit triggers; the four new
  models in `AUDITED_MODELS` and the leak sweep. `advances.spec.ts` (7 tests).

## Decisions worth knowing

- **An advance is tax-inclusive.** ₹11,800 at 18% is ₹10,000 plus ₹1,800. Treating the figure as
  tax-exclusive bills the customer tax on tax, and it is the single easiest thing to get wrong
  here, so the API, the voucher and the screen all work the same way and the test asserts it.
- **An advance credits a liability, not the customer.** It is not a receipt against a debt; the
  debt does not exist yet. Crediting the customer's account would understate the receivable and
  flatter the ageing.
- **Adjustment moves no tax.** The invoice already carries the tax on the supply; the advance's
  tax was paid earlier and is released by the 11B disclosure, not by a second journal.
- **Foreign line rates convert on the way in.** The alternative — storing foreign figures and
  converting at read time — would have meant every downstream consumer (vouchers, GSTR-1,
  ageing, books) learning about currency. One conversion at the door kept the blast radius at
  one function.
- **An invoice edit leaves the export details and the rate alone.** The rate a document posted
  at is part of its history.

## Fixed in passing

`gstr9.spec` moved its documents to FY 2027-28. Its first home (2024-25) collided with the
year-end suite's closing; its second (2019-20) collided with the same suite's _cumulative_
trial-balance assertions as on 31 March 2025. A comment now says so at that assertion, because
this is the third time a suite has tripped over shared-database state and the constraint was
nowhere written down.

## Half-done / known gaps

- Part B of this package — job work, the job-worker master, delivery challans for movements
  without a sale, the 1-year and 3-year return clocks, the job-work register, ITC-04 and the
  delivery challan PDF with the e-way bill number — is not built yet. It is next.
- Advances _paid to suppliers_ are not modelled; only received.
- No realised or unrealised FX gain or loss, and no import purchase with customs duty and landed
  cost: those are P1-17, which builds on the currency master this package adds.
- The RBI rate import is a `RateSource` value with no fetcher behind it; rates are entered by
  hand or through the API.
- An advance cannot yet be cancelled (only refunded); the columns are there for it.
- GSTR-1 table 11 does not carry cess, and amendment tables 11(2)A/B are not built.

## Next

P1-14 part B: job work and delivery challans.

## Blocked on you

Unchanged. Nothing in this package was blocked.

## Changelog sentence

Exports now carry the shipping bill the portal matches against customs, invoices can be raised in
a foreign currency at the day's rate while the books stay in rupees, and money taken before the
invoice is recorded as an advance with its own tax — released, not charged again, when the
invoice goes out.
