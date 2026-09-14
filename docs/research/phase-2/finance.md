Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Finance & Accounts — research report

Scope: chart of accounts, vouchers, banking/BRS, cheques/PDC, petty cash, expenses, GST
(calc/returns/e-invoice/e-way bill), TDS/TCS, MSME, FX, assets, costing/budgets/cost centres,
year-end, tally export, account-export, reports, audit-trail, retention, payments, documents.

## 1. Inventory (what already exists — this domain is unusually mature)

### Prisma models (apps/api/prisma/schema.prisma)

- COA / ledgers: `LedgerGroup` (2674), `AccountLedger` (2741), `Category` (2648, item categories,
  not finance), `HsnCode` (2941), `GstRate` (2964).
- Vouchers/books: `Voucher` (2980, POSTED/CANCELLED + reversal chain), `JournalItem` (3015, with
  `costCentreId`), `AccountingPeriod` (3219, period lock).
- Banking: `BankAccount` (2769, has `upiId` field, unused today — see gap), `BankStatement` (5076),
  `BankStatementLine` (5102, dedupe hash + match confidence), `Cheque` (5142, PDC lifecycle
  IN_HAND→deposited→cleared/bounced).
- Petty cash / expenses: `PettyCashEntry` (3184, GST + TDS aware), `Expense` (2104).
- GST: `HsnCode`, `GstRate`, `ItcEntry` (3967), `Gstr2bRecord` (4024), `ImsAction` (4079),
  `EInvoiceConfig`/`EInvoice` (3776/3803), `Transporter`/`EwayBill`/`ConsolidatedEwayBill`
  (3854/3874/3931).
- TDS/TCS: `TdsSection` (4420), `TdsDeduction` (4456), `TdsChallan` (4511).
- MSME: `msme.service.ts` computes from `GrnInvoice`/`Supplier` (no dedicated model; category on
  `Supplier`).
- Currency/FX: `Currency` (4117), `ExchangeRate` (4141), `FxRevaluation` (4847), `BillOfEntry`
  (4878, import customs landed cost split).
- Assets: `AssetClass` (4679), `FixedAsset` (4710), `AssetEvent` (4758), `DepreciationRun` (4786),
  `AssetDepreciation` (4811).
- Costing/budgets: `StockValuationEntry` (4935, weighted-avg ledger), `CostCentre` (4975),
  `Budget` (5001), `ProductCostSheet` (5027).
- Year-end: `YearEndClosing` (2707).
- Advances: `AdvanceReceipt` / `AdvanceAdjustment` (4165/4213) — customer advance + GST + set-off,
  no supplier-side (payment) advance model.
- Returns: `SalesReturn`/`SalesReturnItem`, `PurchaseReturn`/`PurchaseReturnItem` (3041–3184) —
  these are the credit/debit note mechanism, GST-aware.
- Tally: `TallyNameMap` (4564), `TallyExportRun` (4606).
- Account-export: `AccountExport` (191, generic export runs).
- Payments (SaaS billing/collections gateway): `PaymentGatewayConfig`, `PaymentLink`,
  `PaymentCapture`, `PaymentWebhookEvent`, `SubscriptionInvoice` (5462–5636) — this is both
  "receive payment via link" (customer-facing) and the platform's own subscription billing.
- Documents: `DocumentSequence` (3453, per-type/branch/FY numbering).
- Retention: `RetentionPolicy`/`RetentionSweep` (3620/3638).
- Filings: `FilingApproval` (219, maker-checker for statutory filings).
- Invoice settings: `InvoiceSetting` (2155, prefix/sequence/FY, no UPI/QR/terms fields).

### API modules (apps/api/src/modules/)

`accounts` (ledgers, groups, day/cash/bank book, **ageing**, **cash-flow statement**,
**receivable/payable with credit-check data**, **party statement PDF/email/WhatsApp send**,
**trial balance/P&L/balance sheet**, period control, opening balances), `vouchers` (payment/
receipt/journal/contra CRUD + cancel), `banking` (statement import + BRS matching + cheque
lifecycle), `petty-cash`, `expense` (with `expense.tax.ts` for GST/TDS), `gst`
(calc/context/HSN/rates), `gst-returns` (GSTR-1/2B/3B/9, IMS, ITC rule-37 reversal engine —
very complete), `e-invoice`, `eway-bill` (+ transporter), `tds` (sections/challans/returns),
`msme` (section 15/43B(h) ageing + nudges), `currency` (FX + import BOE), `assets`
(register + depreciation runs, SLM/WDV), `costing` (valuation, cost sheets, **budget-vs-actual
variance**), `year-end` (prepare→approve, closing JV to retained earnings), `tally`
(masters+vouchers XML export with name mapping), `account-export`, `reports` (currently
**production-only**: machines/weekly-programs/production-orders/sales-orders/purchase-orders —
no financial statements here; those live under `accounts`), `audit-trail`, `payments`
(payment links/gateway capture + SaaS subscription billing — two purposes in one module),
`documents` (numbering service), `filings` (maker-checker approval), `imports` (opening-balance/
master CSV import), `advances` (customer advance receive/adjust/refund), `returns` (sales/
purchase returns → credit/debit notes), `invoice-settings`, `retention`.

### Web screens (apps/web/src)

`modules/accounts/pages/`: year-end, books (day/cash/bank book + cash-flow), Tally export, MSME,
fixed assets, forex, costing, bank reconciliation, payable/receivable (with supplier/customer
breakdown), ledger statement, chart of accounts, bank accounts/statements, voucher pages
(payment/receipt/journal/contra add+list), trial balance/balance sheet/P&L, sales/purchase return
pages, petty cash. `modules/expenses/ExpensesList.tsx`. `modules/reports/pages/`: sales/purchase/
inventory/production reports centres + `AuditTrailPage`. `modules/gst/pages/GstMastersPage`.
`modules/payments`.

### Quality issues noticed

- **No integration tests** for `petty-cash`, `expense`, `returns` (sales/purchase returns),
  `currency` beyond `fx.spec.ts`, `invoice-settings`, `documents` numbering, `advances` has a spec
  but check coverage of refund path. `test/integration/` has no `petty-cash.spec.ts`,
  `expense.spec.ts`, `returns.spec.ts`.
- `BankAccount.upiId` is captured but never read by any invoice/print path (`grep upi -i` across
  modules found nothing beyond the schema field) — dead data.
- `reports` module name is overloaded/misleading: it is production reporting only; financial
  reports live under `accounts`. Not a bug, but confusing for future contributors and worth a
  note (not a gap to build, a naming/IA observation).
- `payments` module conflates tenant-facing payment collection (links/gateway capture posted to
  books) with the platform's own SaaS subscription billing (`billing.service.ts`,
  `SubscriptionInvoice`) — two audiences in one module; fine functionally, harder to reason about
  permissions (`payments.*` permission keys should be checked to ensure SaaS billing endpoints are
  super-admin-gated, not tenant-accessible).
- `Category` model name collides conceptually with COA "ledger group" language; no issue found,
  just a naming trap for a new dev searching for "chart of accounts categories".
- MSME dues tracking has no persisted `MsmeDue`/model — it's computed live from `GrnInvoice` +
  `Supplier.msmeCategory` each call; fine for now but means no historical "as of" audit trail of
  what was flagged overdue on a past date (a P1-07 compliance report a tax officer asks for later
  can't be reproduced exactly unless computed off point-in-time data, which it is, from immutable
  GRNs — likely fine, flagging for confirmation only).

## 2. Gap proposals (ranked by value to a plastics SME owner/accountant/plant manager)

1. **UPI/QR code on sales invoice & payment voucher print** — `BankAccount.upiId` already exists
   but nothing renders a UPI deep-link QR on the invoice PDF; SME customers overwhelmingly pay by
   UPI and a printed QR collapses "raise invoice → get paid" into one scan. Data: none new (reuse
   `BankAccount.upiId`, `InvoiceSetting`). Endpoints: extend `sales-invoice` PDF render and
   `documents`/e-invoice print templates. Screens: invoice print/preview, invoice settings toggle.
   Touches: `sales-invoice`, `invoice-settings`, `accounts` (bank account picker). Size: S.
   Isolated: yes.

2. **Automated receivables dunning / collection follow-up** — party statement send exists but is
   manual/on-demand only; no scheduled reminder on ageing buckets (e.g. auto WhatsApp/email at
   7/15/30 days overdue), no per-customer reminder cadence or opt-out, no "promise to pay" log.
   Data model: `DunningRule` (companyId, bucket thresholds, channel, template, cadence),
   `DunningLog` (customerId, ruleId, sentAt, channel, status, promiseToPayDate/notes). Endpoints:
   `/finance/dunning/rules` CRUD, `/finance/dunning/run` (pg-boss job), `/finance/dunning/log`.
   Screens: dunning rules setup, per-customer collection timeline tab on customer breakdown page.
   Touches: `accounts` (ageing.service.ts, statement.service.ts), `notifications`, `whatsappservice`,
   `email-config`, pg-boss jobs. Size: M. Sequencing: depends on existing ageing/statement services
   (reuse, not build from scratch) — low cross-domain risk, but needs a scheduled job.

3. **Credit control enforcement beyond sales-order** — `creditCheckService` exists for sales
   orders; confirm/extend the same check at sales-invoice creation and goods-dispatch time (a
   customer can still be invoiced/dispatched past their limit if the order step is skipped or the
   order was created before a limit was tightened). Data: none new. Endpoints: reuse
   `creditCheckService`, call from `sales-invoice.service.ts` and `goods-dispatch.service.ts`
   with an override-with-reason path (audited). Screens: warning banner + override dialog on
   invoice/dispatch create. Touches: `sales-order`, `sales-invoice`, `goods-dispatch`, `accounts`.
   Size: S. Sequencing: needs coordination with Sales/Dispatch domain owners.

4. **Cash-flow forecast (projected, not just historical)** — `cash-flow.service.ts` is an
   indirect-method historical statement; SME owners need a forward 30/60/90-day cash position
   from open receivables (by expected collection date from ageing), open payables (by due date),
   scheduled TDS/GST/loan/EMI outflows and recurring payroll. Data: no new tables needed if built
   as a read model over `AdvanceReceipt`/invoices/`GrnInvoice`/`PayrollRun`/loan schedule (item 6);
   optionally a `CashFlowForecastSnapshot` for point-in-time comparison. Endpoints:
   `/accounts/cash-flow/forecast?horizonDays=`. Screens: forecast chart on `CashFlowPage`.
   Touches: `accounts`, `payroll`, `tds`, `gst-returns`, item 6 (loans). Size: M. Sequencing:
   more valuable once loan/EMI (6) and dunning (2) exist, but can ship a basic version now.

5. **Loan / EMI tracking with interest schedule** — no `Loan`/`LoanEmi` model exists at all
   despite plastics SMEs commonly carrying machine-purchase term loans, OD/CC limits, and
   unsecured loans from directors/NBFCs. Data model: `Loan` (companyId, lenderName, kind
   TERM/OD/CC/UNSECURED, principal, rate, tenureMonths, startDate, ledgerId (liability),
   interestLedgerId, status), `LoanEmi` (loanId, dueDate, principalComponent, interestComponent,
   paidVoucherId, status). Endpoints: `/finance/loans` CRUD, `/finance/loans/:id/schedule`
   (amortisation calc), `/finance/loans/:id/emi/:emiId/pay` (posts a voucher via
   `voucherPosting.service`). Screens: loan register, EMI schedule, "loans due this month" widget.
   Touches: `accounts` (ledgers, voucher posting, period), `banking` (auto-match EMI debit in BRS
   against schedule). Size: M. Isolated: yes, new module `loans`.

6. **Bank statement CSV/Excel import for more banks + reconciliation UX polish** — check
   `banking/statement.parse.ts` supported formats; if limited to a handful of bank layouts, add a
   generic column-mapping importer (map headers once per bank, reuse `format: "GENERIC"` already
   in schema) so any bank's CSV/XLS works, not just pre-coded parsers. Data: none new (schema
   already supports `format`). Endpoints: `/banking/statements/import` with a mapping payload.
   Screens: "map columns" step in `BankStatementPage` when auto-detect fails. Touches: `banking`.
   Size: S–M. Isolated: yes. _(Verify actual parser coverage before sizing — quick follow-up
   check recommended.)_

7. **Multi-bank cash position dashboard** — `BankAccount` already supports multiple accounts and
   `dashboard`/`insights` modules exist, but no single "all banks + cash-in-hand today" tile;
   owners currently must open each ledger. Data: none new. Endpoints:
   `/accounts/bank-accounts/positions` (balance as-of, last statement date, last reconciled date).
   Screens: dashboard widget. Touches: `accounts`, `dashboard`. Size: S. Isolated: yes.

8. **Cheque printing** — `Cheque` model tracks lifecycle but nothing generates a printable/
   MICR-formatted cheque leaf (common need for outward payments to suppliers/job-workers in
   plastics trade where cheques are still routine). Data: add `chequeLayoutId`/print offsets to
   `BankAccount` or a `ChequeLayout` table (bank-specific leaf templates). Endpoints:
   `/banking/cheques/:id/print`. Screens: print preview with position calibration. Touches:
   `banking`. Size: M. Isolated: yes.

9. **Profitability by customer and by product** — `ProductCostSheet` gives per-product cost;
   nothing joins that with `SalesInvoiceItem` realised price to show margin by customer/product/
   period, which is the number an owner actually wants (who is profitable, what SKU subsidises
   another). Data: none new (read model over `SalesInvoiceItem`, `ProductCostSheet`,
   `CustomerType`). Endpoints: `/reports/profitability/customers`,
   `/reports/profitability/products`. Screens: new report under a finance reports centre. Touches:
   `costing`, `sales-invoice`, `customer`, `reports`. Size: M. Sequencing: depends on
   `ProductCostSheet` being populated regularly (costing module) — check adoption first.

10. **Balance confirmation letters (ledger confirmation, Form 3CD-adjacent)** — `statement.service`
    sends a statement but not a formal "please confirm your balance as on DD/MM" letter with a
    signature block, commonly needed for audits and for MSME/related-party reconciliation. Data:
    reuse statement data; add a `letterType` to the existing send endpoint. Endpoints: extend
    `POST /accounts/statements/:party/:id/send` with `kind: "confirmation"`. Screens: toggle on
    statement send dialog. Touches: `accounts`. Size: S. Isolated: yes.

11. **Ratio analysis / financial health dashboard** — trial balance, P&L, balance sheet all exist
    but no derived ratios (current ratio, quick ratio, debtor/creditor days, inventory turns,
    gross margin %) that an accountant/owner checks monthly. Data: none new — pure computation
    over existing balance-sheet/P&L data plus `StockValuationEntry`. Endpoints:
    `/accounts/ratios?asOn=`. Screens: ratios tile set alongside `BalanceSheetPage`/`ProfitLossPage`.
    Touches: `accounts`, `costing` (for inventory turns). Size: S–M. Isolated: yes.

12. **Cash denomination / cash-counter register** — plastics SME shop-floor cash counters (wages,
    petty cash top-up, cash sales at the gate) commonly need a denomination-wise count sheet that
    reconciles to the cash-in-hand ledger balance at shift/day end. Data:
    `CashCount` (companyId, businessPlaceId, countedOn, denominations Json {500:x,200:x,...},
    totalCounted, ledgerBalance, variance, countedBy). Endpoints: `/finance/cash-count` CRUD.
    Screens: cash counter page (denomination grid), variance flag. Touches: `accounts`
    (cash-in-hand ledger), `petty-cash`. Size: S. Isolated: yes.

13. **Supplier-side advance payments** — `AdvanceReceipt`/`AdvanceAdjustment` cover customer
    advances only; paying a supplier an advance (common for tooling/mould deposits, raw-material
    pre-payment to avoid price volatility) has no symmetric model — currently would need a manual
    journal, losing the GST/RCM and set-off tracking the customer side gets. Data:
    `AdvancePayment`/`AdvancePaymentAdjustment` mirroring the receipt models (RCM tax where
    applicable). Endpoints: `/finance/advances/payments` (parallel to `/advances`). Screens:
    "Pay advance" flow next to existing "Receive advance". Touches: `advances`, `accounts`,
    `supplier`, `gst`. Size: M. Isolated: mostly — mirrors existing pattern closely.

14. **E-invoice bulk generation / bulk cancel** — `e-invoice.service.ts` operates per document
    (`request()`/`cancel()`); no batch endpoint to raise IRNs for "all invoices from today not yet
    e-invoiced" in one action, which matters once daily invoice volume is more than a handful.
    Data: none new. Endpoints: `/e-invoice/bulk` (queues one `request()` per doc via pg-boss, one
    job per tenant, respects existing per-document guardrails). Screens: "Generate e-invoices"
    bulk action on sales invoice list with a result summary (success/failed with reasons).
    Touches: `e-invoice`, `sales-invoice`. Size: S–M. Isolated: yes (thin orchestration over
    existing per-document service — must not bypass `eInvoiceService.request()`).

15. **E-way bill auto-generation on dispatch threshold** — confirm whether `eway-bill` triggers
    automatically when a `GoodsDispatch`/invoice crosses the ₹50,000 threshold, or is always
    manual; if manual only, add an opt-in auto-raise on dispatch confirm (still going through
    `ewayBillService`, never a direct call). Screens: setting toggle + dispatch confirm banner.
    Touches: `eway-bill`, `goods-dispatch`. Size: S. _(Verify current behaviour before committing
    to build — may already exist; flagged for a quick follow-up read of
    `eway-bill.service.ts` triggers.)_

16. **GST rate change effective-dating** — `GstRate`/`HsnCode.gstRate` are mutable-in-place with
    no effective-from date; a rate change (GST Council notifications are frequent) silently
    changes the default for every future document from the moment of edit, which is correct for
    new docs but leaves no audit of "what was the rate on this HSN on 1 June" for reconciling old
    filings against a rate table that has since moved on. Data: add `GstRateHistory`
    (hsnCodeId/rateId, rate, cessRate, effectiveFrom, effectiveTo) populated on every edit.
    Endpoints: extend `gst.service.ts` update to snapshot history. Screens: rate history view on
    HSN master. Touches: `gst`. Size: S. Isolated: yes.

17. **Cash sales / cash purchase quick-entry workflows** — brief explicitly flags this as wanted
    (kachha-to-pakka, unregistered/composition parties). Confirm `petty-cash` + `sales-invoice`
    already cover "cash sale with proper voucher" fully for an unregistered walk-in customer (no
    GSTIN, no credit, immediate cash-in-hand posting) and for cash purchase of small consumables
    from an unregistered supplier — if a distinct fast-entry screen doesn't exist (separate from
    full sales/purchase order flow), add one. Data: none new — reuse `SalesInvoice`/`Expense`/
    `PettyCashEntry` with `paymentMethod = CASH` and no customer/supplier master required
    (walk-in) using a generic "Cash Customer"/"Cash Supplier" ledger. Endpoints: reuse existing;
    add a lightweight `/sales-invoice/cash-quick` shortcut if the full order flow is too heavy for
    counter sales. Screens: "Quick cash sale" / "Quick cash purchase" tiles. Touches:
    `sales-invoice`, `expense`, `petty-cash`, `accounts`. Size: S. Isolated: yes. _(Needs a look at
    current sales-invoice UX to see if this is already fast enough — may be a UX gap, not a
    backend gap.)_

18. **Financial-year lock hard-stop across all posting paths** — `periodService.assertPostingAllowed()`
    is called by `safeCreateVoucher`; verify every direct-posting path (asset depreciation runs,
    FX revaluation, year-end closing itself, TDS challan posting) routes through the same check
    rather than posting straight to `JournalItem`. This is a correctness audit item, not
    necessarily new scope — flagging for a dedicated code-review pass rather than a build item.

19. **Interest on delayed customer payments (beyond ageing display)** — `ageing.service.ts`
    computes `overdueInterest` for display; confirm there's a way to actually _invoice_ that
    interest (an interest debit note against the customer, GST-exempt as per RBI/GST circular
    treatment) rather than just show it on the ageing report. Data: reuse `SalesReturn`-style
    debit note mechanism or a lightweight `InterestDebitNote`. Endpoints:
    `/accounts/receivable/:customerId/interest-note`. Screens: "raise interest note" action on
    customer breakdown page. Touches: `accounts`, `gst`. Size: S–M.

20. **MSME payment prioritisation queue** — `msme.service.ts` computes what's overdue/near-due;
    add a "pay these first" actionable payables queue (sorted by days-to-breach) feeding directly
    into voucher creation, rather than a report the accountant has to translate into payment
    decisions manually. Data: none new. Endpoints: `/msme/payment-queue`. Screens: MSME page
    action list with "Pay now" → prefilled payment voucher. Touches: `msme`, `accounts`,
    `vouchers`. Size: S. Isolated: yes.

21. **Recurring/standing vouchers** — no support found for recurring journal/payment vouchers
    (e.g. monthly rent, AMC, loan EMI once item 5 exists, insurance) that need to post
    automatically or be one-click-confirmed each period. Data: `RecurringVoucherTemplate`
    (companyId, templateItems Json, frequency, nextRunDate, autoPost boolean). Endpoints:
    `/vouchers/recurring` CRUD + pg-boss job to generate/post. Screens: recurring voucher setup +
    "pending recurring postings" inbox. Touches: `vouchers`, `accounts`. Size: M. Isolated: yes.

22. **Document retention / archival for finance documents beyond DB rows** — `retention` module
    covers policy/sweep at the row level; confirm whether generated PDFs (invoices, e-invoices,
    statements, TDS certificates) are retained/archived with the same discipline or regenerated
    on demand only (regeneration risk if template changes later and an old PDF can no longer be
    reproduced identically for an audit). Flag for verification, possible gap: `DocumentArchive`
    (docType, docId, generatedAt, storageKey, hash) so a served PDF is immutable evidence. Size: M.

## 3. Isolation vs sequencing

**Buildable in isolation (low cross-domain risk):**
1 (UPI QR), 6 (generic bank import), 7 (multi-bank dashboard), 8 (cheque printing), 10 (balance
confirmation letters), 11 (ratio analysis), 12 (cash denomination register), 14 (e-invoice bulk,
thin wrapper), 16 (GST rate history), 20 (MSME payment queue), 21 (recurring vouchers).

**Need sequencing / cross-domain coordination:**

- 2 (dunning) — depends on notifications/whatsapp/email infra being reliable at scale; coordinate
  with whoever owns customer comms cadence to avoid duplicate reminder systems.
- 3 (credit control at invoice/dispatch) — touches Sales and Inventory/Dispatch domains directly;
  needs their sign-off on override UX.
- 4 (cash-flow forecast) — best sequenced after 5 (loans) and payroll cadence data are solid, else
  the forecast is missing major line items.
- 5 (loans) — standalone module but its EMI postings should reuse `voucherPosting.service` and
  ideally auto-match in banking's BRS (item 6/reconciliation), so coordinate with Banking owner.
- 9 (profitability reports) — depends on `costing`'s `ProductCostSheet` being populated in
  practice; check adoption before committing.
- 13 (supplier advances) — mirrors existing `advances` module; should be built by the same owner
  to keep the two symmetric, and touches GST RCM logic so needs `gst` module review.
- 15, 17, 18, 19, 22 — verification/audit items first; scope narrows or disappears once confirmed
  against current behaviour, so should not be estimated for build until checked.

## Summary of method

Enumerated every Prisma model, module directory and route file under the assigned domain,
cross-checked against web routes/pages and integration test coverage, and grep'd for specific
capability markers (creditLimit enforcement, UPI, dunning/reminder, loan/EMI, denominations,
ratio) to separate "exists" from "missing" rather than assuming gaps from the module list alone.
