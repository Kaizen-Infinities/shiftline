Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Sales Management & CRM — Research Report

Scope: customer, customer-grade, customer-type, sales-product, sales-order, sales-invoice,
goods-dispatch, returns, invoice-settings, whatsappservice, notifications, sms, email-config,
mobile, documents. Plus everything CRM/order-to-cash adjacent.

## 1. Inventory

### Prisma models (apps/api/prisma/schema.prisma)

- `CustomerType` (434), `CustomerGrade` (448) — simple lookup tables, `@@unique([companyId, name])`.
- `Customer` (462) — has `creditLimit`, `creditDays`, `overdueInterestRate`, `outstandingAmount`,
  `gstRegType`, `stateCode`, `openingBalance`/`openingBalanceType`, `transports` (Json),
  `mobile` (Json), soft-delete (`deletedAt`), full-text `searchTsv`. No price-list link, no
  sales-territory/beat, no KYC doc fields, no default transporter FK (just free-form Json).
- `CustomerAddress` (519) — Json `address` blob + `label`/`is_default`/`state_code`.
- `SalesProduct` (1018), `SalesProductStock` (1042, per-store on-hand qty),
  `SalesProductComponent` (1064, BOM-style link from a sellable SKU to production `Product`s).
- `SalesOrder` (1681) / `SalesOrderItem` (1727) — quotations are **not** a separate model; a
  quotation is a `SalesOrder` with `orderType`, statuses `QUOTATION_IN_PROGRESS` /
  `QUOTATION_COMPLETED`, and `SalesOrderItem.quotationUnitPrice`. Order-source tracking fields
  (`orderSource`, `sourceEmployeeId`, `referredByCustomerId`, `referredByName`,
  `sourceSalesOrderId`) exist — a decent lightweight lead-attribution mechanism, but no real
  lead/enquiry pipeline (no stage, no follow-up, no loss-reason).
- `SalesInvoice` (2173) / `SalesInvoiceItem` (2245) / `SalesInvoicePayment` (2282) — rich:
  GST fields (place of supply, supply type, reverse charge, cess), export fields (`exportType`,
  `lutNumber`, `shippingBillNo/Date`, `portCode`), multi-currency (`currencyCode`,
  `exchangeRate`, `foreignTotal`), `businessPlaceId`, cancellation fields, `payments` Json.
  `documentType` enum defaults to `TAX_INVOICE` (so a proforma/other type is modeled at the
  enum level — check `SalesDocumentType` values) but there's no dedicated Proforma workflow/UI.
- `InvoiceSetting` (2155) — one row per company: prefix/sequence/format template. This looks
  like a legacy/duplicate of `documentNumberService` (per CLAUDE.md, doc numbers should come
  from `modules/documents/document-number.service.ts`, one series per type+branch+FY) — worth
  checking whether `InvoiceSetting` and `documentNumberService` are both live (possible drift).
- `GoodsDispatch` (1426) / `GoodsDispatchItem` (1511) — this is **production→store** dispatch
  (items reference `productionOrderId` + `productItemId`), gate/store approval workflow
  (`PENDING_GATE_APPROVAL`, gate/store received). It is **not** linked to `SalesOrder`,
  `SalesInvoice` or `Customer` at all — there is no customer-facing delivery note/dispatch
  document tied to an invoice. `vehicleNumber`/`driverName`/`transportName` are free strings,
  not FK to `Transporter`.
- `SalesReturn` (3041) / `SalesReturnItem` (3086) — solid: credit-note number, GST fields,
  cancellation fields, links to originating `SalesInvoiceItem`.
- `Transporter` (3854) — master exists (code, name, GSTIN-style `transporterId`, phone/email)
  but is only consumed by `eway-bill` (`EwayBill.transporterId/Name` are free strings, not FK)
  and not referenced by `GoodsDispatch`, `SalesInvoice.transport` (Json), or `DeliveryChallan`
  (`transporterName`/`vehicleNumber` also free strings) — i.e. a real master exists but nothing
  actually foreign-keys to it.
- `DeliveryChallan` / `DeliveryChallanItem` (4298) — `ChallanKind` enum: `JOB_WORK_OUT`,
  `JOB_WORK_RETURN`, `BRANCH_TRANSFER`, `EXHIBITION`, `LINE_SALES`. `LINE_SALES` is the closest
  thing to a van-sales/direct-delivery challan but there's no `SALE` kind for a plain
  delivery-challan-before-invoice workflow (very common in Indian trade: goods move on a challan,
  invoice raised later) outside of production job-work.
- `EwayBill` (3873ish) — `docType` "INV" or "CHL" only; generated from e-invoice/e-way modules,
  reachable from sales invoices and dispatches conceptually but only invoice is wired
  (`sales-invoice.service.ts` calls `eInvoiceService.assertDocumentCancellable`).
- `MobileVisit` (3472), `MobileCollection` (3503), `MobileRouteCustomer` (3540),
  `MobileRouteAssignment` (3559ish), `AgentPosition` (3691) — field-sales app backing tables;
  well documented conflict policy in `mobile.types.ts`. Orders from mobile piggyback on
  `SalesOrder`/append-only push (see `mobile.order.service.ts`).
- `WhatsappConfig` (731), `EmailConfig` (747), `SmsConfig`/`SmsTemplate`/`SmsMessage`
  (5636–5684ish), `Notification` (2803).
- No models for: leads/enquiries, price lists (customer- or grade-specific pricing beyond the
  single `SalesProduct.rate`/`quotationUnitPrice`), rate contracts, sample requests, proforma
  invoice as a distinct doc, customer complaints, sales commission/brokerage, discount
  schemes, cash/POS counter sales, customer self-service portal, packing lists (carton/box
  breakdown), or dispatch-vehicle/route optimization for finished-goods delivery.

### API modules (apps/api/src/modules)

- `customer/` — `customer.{routes,controller,service,validation}.ts`.
- `customer-grade/`, `customer-type/` — CRUD only.
- `sales-product/` — `salesProduct.{controller,routes,service,validation}.ts`.
- `sales-order/` — `sales-order.{routes,service,validation}.ts`, `slaes-order.controller.ts`
  (typo in filename), `creditCheckService.ts` (credit-limit/overdue/blocking-order checks,
  uses `prisma` re-exported from `lib/prisma.ts` so tenant-scoped — OK). Endpoints include
  quotation PDF download (`/:id/download-quotation`, `templates/quotationTemplate.ts`),
  WhatsApp/email send of quotation.
- `sales-invoice/` — full CRUD, cancellation via `eInvoiceService.assertDocumentCancellable`.
- `goods-dispatch/` — create/list/detail + gate-approval + store-approval endpoints
  (`goods-dispatch.routes.ts`: 7 routes).
- `returns/` — `returns.{routes,controller,service,types}.ts` (sales + purchase returns share
  this module based on file names, confirm split).
- `invoice-settings/` — controller+routes only, no `.service.ts`/`.validation.ts` file (thin).
- `whatsappservice/` — webhook verify/handle (public), `config` view/edit, `send` message
  (`whatsapp.routes.ts`, 24 lines, 3 authenticated endpoints total — thin: no template
  management, no per-document auto-send hooks visible beyond ad hoc `send`).
- `notifications/` — controller/service/routes + `notify.ts` helper.
- `sms/` — `otp.service.ts`, `sms.calc.ts` (credit calc), `providers/`, typed.
- `email-config/` — controller+routes only (no service/validation file — thin, likely just
  reads/writes `EmailConfig`).
- `mobile/` — the most mature module here: 11 files, device/position/visit/order/collection/
  OCR/attachment services, `mobile.sync.service.ts` for WatermelonDB push/pull.
- `documents/` — `document-number.service.ts` (the canonical numbering service per CLAUDE.md)
  - generic documents controller/routes.

### Web (apps/web/src)

- `modules/customers/` — list/form pages + view modal, validations. No dedicated
  customer-detail/360 page (ledger + orders + invoices + visits in one place) evident.
- `modules/sales/salesorder/` — `AllSalesOrderList.tsx`, `SalesOrderDetail.tsx`, `CreateOrder.tsx`.
- `modules/sales/quatation/` — `CreateQuatation.tsx` (imports from
  `pages/sales/QuotationForm/QuotationForm.tsx` — indicates file was moved/duplicated;
  worth a cleanup pass), `QuatationList.tsx`. Note consistent "quatation" typo throughout
  routes/module naming (`/quatation-order` route in nav config).
- `modules/sales/advances/AdvancesPage.tsx` — advance receipts against sales orders.
- `modules/sales-order-invoice/` — `SalesInvoiceCreate.tsx` (+ a stray lowercase duplicate
  `sales-invoiceCreate.tsx` — likely dead file), `SalesInvoiceView.tsx`, `SalesInvoiceList.tsx`.
- `modules/goods-dispatch/pages/` — Create/List/Detail/View + Gate/Store approval pages (6).
- `modules/sales-product/pages/` — Form + List.
- `modules/whatsapp/WhatsappCreate.tsx` — single page (config), matches thin backend.
- `modules/sms/pages/SmsPage.tsx`, `modules/notifications/pages/NotificationsPage.tsx`,
  `modules/email-config/pages/EmailConfigPage.tsx` — single-page settings screens.
- `features/customer/`, `features/goods-dispatch/` also exist alongside `modules/` — dual
  location pattern (module vs feature) worth checking for duplication/drift.
- No customer portal, no complaint/ticket screens, no price-list screens, no commission/agent
  screens found.

### Permission keys (packages/shared/src/permissions.ts)

`whatsapp`, `email-config`, `sms`, `sales_products`, `customer-types`, `customer-grades`,
`customers`, `sales-orders`, `pending-quotations` (Sales MD Approvals), `sales-invoices`,
`sales-returns`, `goods-dispatch`, `sales-reports`, `mobile-app`. A `quotations.view` permission
is referenced from web nav config (`Ctrl+Q`) but the shared permissions list above only shows
`pending-quotations` — confirm `quotations` permission key actually exists in
`packages/shared/src/permissions.ts` (grep found `pending-quotations`, not a plain `quotations`
module); if not, that nav item may be gated on a permission key that doesn't exist. Worth a
follow-up grep before building on it.

### Tests (apps/api/test/integration)

Only `mobile.spec.ts`, `notifications.spec.ts`, `sms-otp.spec.ts`, `e-invoice.spec.ts` exist in
this domain. **No integration tests for customer, customer-grade, customer-type, sales-order,
sales-invoice, sales-product, goods-dispatch, returns, whatsapp, email-config, invoice-settings**
— a large gap against the repo's own Definition of Done ("integration tests cover the happy path
and every validation rejection"). This is the single biggest quality issue in the domain.

### Other quality notes

- `slaes-order.controller.ts` filename typo (functional but should be renamed in a follow-up).
- `InvoiceSetting` model duplicates responsibility with `documentNumberService` — needs
  reconciliation; CLAUDE.md says document numbers must come from
  `documentNumberService.next()`, never a hand-rolled counter.
- `GoodsDispatch` has no relation to `SalesOrder`/`SalesInvoice`/`Customer` — it's an internal
  stock-movement doc, not a customer delivery note; this is a real functional gap (see gaps
  below), not just a naming issue.
- `Transporter` master exists but nothing foreign-keys to it (`SalesInvoice.transport` is Json,
  `GoodsDispatch`/`DeliveryChallan`/`EwayBill` all store transporter as free-text) — data quality
  risk (typos, no reporting by transporter, no e-way `transporterId` validation).
- Web has duplicate/likely-stale files: `sales-invoiceCreate.tsx` vs `SalesInvoiceCreate.tsx`,
  and `modules/sales/quatation/CreateQuatation.tsx` whose top comment still points at a different
  path (`pages/sales/QuotationForm/QuotationForm.tsx`), suggesting an incomplete file move.
- Consistent "quatation"/"quotation" spelling split across routes, module folder, permission
  key naming — should be normalized in any new work rather than propagated further.

## 2. Gaps — proposed features (ranked by value to a plastics SME owner/accountant/plant manager)

1. **Sales-linked delivery note / dispatch against invoice** — S/M/L: **M**. Rationale: today
   `GoodsDispatch` only moves goods production→store; there is no document a driver carries that
   ties dispatched cartons/qty to a specific `SalesInvoice`/`SalesOrder`, customer address and
   e-way bill. Data model: add `SalesDispatch`/extend `GoodsDispatch` with optional
   `salesInvoiceId`/`customerId`, or a new `CustomerDelivery` + `CustomerDeliveryItem` linking to
   `SalesInvoiceItem`, FK `transporterId` to `Transporter`. Endpoints: create from invoice, POD
   (proof-of-delivery) capture (signature/photo via existing `documents`/attachment pattern),
   status transitions. Screens: "Create Dispatch" from invoice detail, POD capture on mobile.
   Touches: goods-dispatch, sales-invoice, mobile, eway-bill. Sequencing: needs Transporter FK
   cleanup first (item 15) to be done well, but can ship independently.

2. **Price lists / customer- and grade-specific pricing** — **M**. Rationale: plastics SMEs
   routinely quote different rates per customer grade (A/B/C) or per contract; today rate lives
   only on `SalesProduct.rate` (single global) or ad hoc `quotationUnitPrice` per order line, so
   every order re-negotiates price with no source of truth. Data model: `PriceList` (id, name,
   validFrom/To, customerGradeId? customerId?), `PriceListItem` (priceListId, salesProductId or
   productId, rate, minQty tiers). Endpoints: CRUD + "effective price" lookup used by
   sales-order/quotation line default. Screens: Price List manager, picker in order/quotation
   form. Touches: customer-grade, sales-product, sales-order. Isolated build, but sales-order
   pricing logic needs a follow-up integration PR.

3. **Rate contracts (period-bound agreed pricing/quantity with a customer)** — **M**. Rationale:
   common in Indian B2B trade — a customer locks a rate for N months/qty; billing must flag
   deviations. Data model: `RateContract` (customerId, validFrom/To, status), `RateContractItem`
   (salesProductId, rate, contractedQty, billedQty). Endpoints: create/approve/close, "check
   contract" call from sales-order creation. Screens: Rate Contract list/detail, warning banner
   on order/invoice when price deviates. Touches: customer, sales-order, sales-invoice. Depends
   on price-list infra (#2) for clean reuse, but can stand alone.

4. **Leads / enquiry pipeline before quotation** — **M**. Rationale: `orderSource`/
   `referredByCustomerId` on `SalesOrder` is attribution-only; there's no pre-order stage to track
   a walk-in/call/exhibition enquiry, follow-ups, and win/loss, so marketing spend and conversion
   can't be measured, and enquiries that don't convert vanish. Data model: `Lead`
   (companyId, name, contact, source, productInterest, stage enum NEW/CONTACTED/QUOTED/WON/LOST,
   lostReason, assignedToEmployeeId, nextFollowUpAt), `LeadActivity` (note/call log). Endpoints:
   CRUD, convert-to-quotation (creates `SalesOrder` with `orderType=quotation`, sets
   `sourceSalesOrderId`/`referredBy*`). Screens: Lead list/kanban, lead detail with activity
   timeline, "Convert to Quotation" action. Touches: sales-order, customer, notifications (
   follow-up reminders via pg-boss). Can be built in isolation; only the "convert" action needs a
   light sales-order hook.

5. **First-class Quotation entity (split from SalesOrder)** — **M**. Rationale: quotations today
   are `SalesOrder` rows with a status flag and a second price column, which conflates a
   non-binding proposal with a committed order — no quotation-specific validity date, version
   history (revised quote after negotiation), or win/loss analytics, and it complicates every
   sales-order query with `quotationOnly`/`quotationUnitPrice` branching. Data model: `Quotation`
   (customerId, quotationNo, quotationDate, validUntil, status DRAFT/SENT/NEGOTIATION/WON/LOST/
   EXPIRED, version, supersedesQuotationId), `QuotationItem`. `SalesOrder.sourceQuotationId`
   replaces `sourceSalesOrderId` for this flow. Endpoints/screens: mirror the existing quotation
   UI but backed by its own table; "Convert to Sales Order" action. Touches: sales-order (needs
   migration of existing quotation-flagged orders), sales-product, documents (own numbering
   series), whatsapp/email (send quote). Size **L** because it's a schema migration of live data
   with UI rewiring — needs sequencing (do after leads #4, before rate contracts if possible), not
   safely isolated.

6. **Sales commission / brokerage tracking for agents & brokers** — **M**. Rationale: very common
   in Indian SME trade — a broker/agent introduces a customer or order and earns a %/flat
   commission, tracked separately from payroll and settled periodically; today there is no model
   at all (only `referredByCustomerId`/`sourceEmployeeId` for attribution, no rate or payable
   tracking). Data model: `SalesAgent` (name, gstin?, panNo?, commissionType PERCENT/FLAT,
   defaultRate), `CommissionEntry` (salesInvoiceId, salesAgentId, baseAmount, rate, amount,
   status ACCRUED/PAID, paidVoucherId). Endpoints: agent CRUD, auto-accrue on invoice post
   (hook in sales-invoice), commission statement per agent, mark-paid (creates payment voucher
   via existing voucher/payments infra). Screens: Agent master, Commission report, pay-out
   screen. Touches: sales-invoice, sales-order (agent on order), documents/vouchers. Depends on
   invoice-posting hook so needs light sequencing with sales-invoice service, otherwise isolated.

7. **Scheme / discount management (volume, seasonal, product-bundle)** — **M**. Rationale: only
   ad hoc `discountType`/`discountValue`/`orderDiscountValue` exist per document; no reusable
   scheme a plant can define once ("buy 500kg get 2% off", "Diwali scheme on X SKU") and apply
   consistently, and no audit trail of scheme usage for GST/accounting review. Data model:
   `Scheme` (name, kind PERCENT/FLAT/SLAB, validFrom/To, appliesTo customerGradeId?/
   salesProductId?/all), `SchemeSlab` (minQty, discountPct), `SchemeApplication` (documentType,
   documentId, schemeId, amount) for audit. Endpoints: CRUD, "applicable schemes" lookup on
   order/invoice line add. Screens: Scheme manager, auto-apply badge in order/invoice line.
   Touches: sales-order, sales-invoice, sales-product. Isolated build; application logic is an
   additive hook.

8. **Customer complaints / quality-return tracking (linked to production batch)** — **M**.
   Rationale: plastics manufacturers get complaints about batch quality (warpage, colour
   mismatch) that should trace to the production order/shift, not just a generic sales return;
   currently `SalesReturn.reason` is a free string with no linkage to root-cause/production and
   no SLA/status tracking. Data model: `CustomerComplaint` (customerId, salesInvoiceId?,
   productionOrderId?, category, severity, status OPEN/INVESTIGATING/RESOLVED/CLOSED, resolution,
   relatedSalesReturnId). Endpoints: CRUD, link-to-return, close-with-resolution. Screens:
   Complaint list/detail, "Raise Complaint" from invoice/return screen. Touches: sales-invoice,
   returns, production (read-only link). Isolated.

9. **Proforma invoice as a first-class flow** — **S/M**. Rationale: Indian B2B commonly needs a
   proforma (for advance payment / import LC / customer PO approval) before a real tax invoice;
   `SalesInvoice.documentType` enum hints at support but there's no distinct numbering series,
   no "convert proforma to tax invoice" action, and a proforma must never touch GST returns/e-
   invoice. Data model: reuse `SalesInvoice` with `documentType = PROFORMA` (already scaffolded)
   but add `convertedToInvoiceId`, ensure GSTR-1/e-invoice code paths explicitly skip PROFORMA
   rows (check `gst-returns` module doesn't already need this). Endpoints: create proforma,
   convert-to-tax-invoice (copies lines, gets a real doc number from `documentNumberService`).
   Screens: "Proforma" toggle on invoice create, convert action. Touches: sales-invoice,
   documents, gst-returns (verify exclusion), e-invoice (verify exclusion). Size **S** if the
   enum value already fully exists and is just unwired in UI — verify first.

10. **Packing list / carton-wise breakdown for dispatch** — **S/M**. Rationale: plastics goods
    (bags/crates/rolls) are dispatched in numbered cartons/bundles; `SalesInvoice.numberOfBundle`
    is a single int with no per-carton contents, which blocks proper packing lists for large
    export/distributor orders. Data model: `PackingListCarton` (dispatchId or invoiceId,
    cartonNo, grossWeight, netWeight, items Json or `PackingListCartonItem`). Endpoints: generate
    from invoice/dispatch, print. Screens: Packing list builder + PDF. Touches: sales-invoice,
    goods-dispatch (once #1 exists). Depends loosely on #1.

11. **Cash sales / B2C counter mode** — **S/M**. Rationale: many plastics units also sell scrap/
    regrind or small retail quantities for cash at the gate; today every sale needs a full
    `Customer` record and `gstin`/full workflow, which is friction for one-off cash buyers under
    GST's B2C rules (no need for full party master, but the sale must still be recorded, per repo
    rule against off-record sales). Data model: allow `Customer.customerType = "CASH"` with a
    single shared "Cash Sale" customer per company (seeded in `provisioningService`, per
    CLAUDE.md convention) or a lighter `walkInName`/`walkInMobile` pair of nullable fields on
    `SalesInvoice` when `customerId` is the cash-counter customer. Endpoints: quick-invoice
    creation skipping address/credit checks. Screens: "Cash Sale" quick-entry form. Touches:
    customer, sales-invoice, provisioning (seed the default cash customer). Isolated, must stay
    fully on-books (matches the brief's explicit "cash sales... fine and welcome").

12. **Sample request tracking** — **S**. Rationale: before a bulk order, customers request
    physical samples (with or without charge) — currently no way to record this outside a
    zero-value sales order hack. Data model: `SampleRequest` (customerId, salesProductId,
    quantity, chargeable bool, status REQUESTED/DISPATCHED/CONVERTED, convertedSalesOrderId).
    Endpoints: CRUD, convert-to-order. Screens: Sample Request list, convert action. Touches:
    customer, sales-order, goods-dispatch. Isolated, low risk, good "quick win".

13. **Customer 360 / ledger view (web)** — **S**. Rationale: there's no single customer-detail
    screen aggregating outstanding balance, ledger entries, open orders, recent invoices, and
    visit history — accountants/owners currently have to jump across five screens. Data model:
    none new (read aggregation from `Customer`, `AccountLedger`, `SalesOrder`, `SalesInvoice`,
    `MobileVisit`). Endpoints: one aggregate `GET /customers/:id/summary`. Screens: Customer
    Detail page with tabs. Touches: customer, sales-order, sales-invoice, mobile (read-only).
    Fully isolated, good first PR to establish patterns for other gaps.

14. **Overdue/credit-limit dashboard & auto-hold enforcement** — **S/M**. Rationale:
    `Customer.creditLimit`/`overdueInterestRate` and `creditCheckService` exist, but nothing
    calls `checkCustomerCredit`/`hasBlockingPendingOrder` from the invoice-creation path (only
    referenced around sales-order), and there's no company-wide "customers over limit / overdue"
    report or notification. Data model: none new; add a scheduled pg-boss job (per CLAUDE.md
    convention, one job per tenant under `runAsTenant`) that flags overdue customers and creates
    `Notification` rows / auto-applies `overdueInterestRate` as debit-note-style ledger entries.
    Endpoints: `GET /customers/overdue`, `POST /customers/:id/apply-overdue-interest`. Screens:
    Overdue dashboard widget. Touches: customer, sales-invoice, notifications, sms/whatsapp
    (reminder send). Isolated but should audit whether sales-invoice creation already enforces
    credit check (it currently does not appear to, based on the grep — verify before building).

15. **Transporter FK cleanup + dispatch-vehicle/transporter master usage** — **S**. Rationale:
    `Transporter` master exists (with GST transporter ID needed for e-way bills) but
    `GoodsDispatch`, `SalesInvoice.transport`, and `DeliveryChallan` all store transporter/vehicle
    as free text, causing data-quality issues and blocking reporting-by-transporter or e-way bill
    validation against a known transporter ID. Data model: add `transporterId` FK (nullable, to
    preserve free-text fallback) on `GoodsDispatch`, `DeliveryChallan`, and a structured
    `transport` shape referencing `Transporter` from `SalesInvoice`. Endpoints: minor service
    updates to resolve+store the FK. Screens: replace free-text transport fields with a
    typeahead against `Transporter`. Touches: goods-dispatch, sales-invoice, eway-bill. Small,
    isolated, but is a prerequisite for #1 and #10 to be done cleanly — do this first.

16. **WhatsApp/SMS/Email template + auto-send hooks for sales documents** — **S/M**. Rationale:
    `whatsappservice` only exposes a generic `send`; there's no template library or automatic
    trigger (e.g. auto-WhatsApp the invoice PDF on posting, auto-SMS on dispatch, payment-
    reminder cadence) — every send today looks ad hoc from the sales-order controller
    (`slaes-order.controller.ts` builds the message inline). `sms` already has `SmsTemplate`
    (DLT-approved templates) — WhatsApp/email have no equivalent. Data model:
    `WhatsappTemplate`/reuse a generic `MessageTemplate` (channel enum, event trigger enum,
    body with placeholders). Endpoints: template CRUD, and hook invoice/order/dispatch
    post-actions to enqueue a pg-boss job that renders+sends. Screens: Template manager per
    channel. Touches: whatsappservice, sms, email-config, sales-invoice, sales-order,
    goods-dispatch, notifications. Medium coupling — needs sequencing after whichever document
    events are chosen as triggers exist/stabilize.

17. **Export sales workflow polish (shipping bill / LUT / FOB terms UI)** — **S**. Rationale:
    the data model already carries `exportType`, `lutNumber`, `shippingBillNo/Date`, `portCode`,
    multi-currency — but there's no dedicated Export Sales screen/checklist (Incoterm, packing
    list requirement, bank realization tracking) surfaced in the web app (not found under
    `modules/sales*`). Data model: maybe add `incoterm`, `bankRealizationStatus` on
    `SalesInvoice` if not present; otherwise UI-only. Endpoints: none new if fields exist.
    Screens: Export Invoice form variant, FIRC/BRC tracking view. Touches: sales-invoice.
    Isolated, low schema risk — verify exact existing field coverage before sizing further.

18. **Sales order → production linkage / make-to-order visibility** — **M**. Rationale: for a
    plastics MTO shop, sales staff need to see which `ProductionOrder`(s) are fulfilling a given
    `SalesOrderItem` and its stage/ETA; today `SalesOrderItem` has no FK to `ProductionOrder`
    (only `SalesProductComponent` links a sellable SKU to production `Product`s at the BOM
    level, not per order). Data model: `SalesOrderItem.productionOrderId` (nullable) or a join
    table `SalesOrderProductionLink`. Endpoints: "production status" on sales-order detail.
    Screens: ETA/status chip in Sales Order Detail. Touches: sales-order, production module
    (cross-domain — coordinate with production researcher). Needs sequencing with production
    domain; not buildable in isolation.

19. **Delivery challan "SALE" kind for challan-before-invoice trade flow** — **S**. Rationale:
    `ChallanKind` covers job-work/branch-transfer/exhibition/line-sales but not the common trade
    pattern of "goods move now on a delivery challan, tax invoice raised in a few days" for a
    normal sale (distinct from `LINE_SALES` van-selling). Data model: add `SALE` to
    `ChallanKind`, add optional `customerId`/`salesOrderId` on `DeliveryChallan`, and a
    "convert to invoice" action bringing challan items into a new `SalesInvoice`. Endpoints:
    convert action. Screens: reuse existing Delivery Challan UI (if any exists — none found
    under `apps/web/src/modules`; the challan module may be purchase/job-work-only on the web
    side, verify with production/purchase researcher). Touches: delivery-challan (not in this
    domain's module list — cross-domain), sales-order, sales-invoice. Needs sequencing/
    coordination since `DeliveryChallan`'s owning module wasn't found under this domain's list.

20. **Customer self-service portal (order/invoice/payment visibility)** — **L**. Rationale: buyers
    increasingly expect to check invoice/payment status and download e-invoice PDFs themselves,
    reducing calls to the accounts team; nothing like this exists (no customer-auth, no portal
    routes). Data model: `CustomerPortalUser` (customerId, email, passwordHash or magic-link),
    scoped read-only views. Endpoints: separate auth flow + read-only `GET` endpoints under a
    `/portal` prefix, careful tenant+customer double-scoping. Screens: new portal SPA or route
    tree. Touches: customer, sales-invoice, sales-order, auth (new customer-auth pattern), e-
    invoice (PDF fetch). Size **L**, cross-cutting (new auth surface) — sequence last, needs
    security review given it's a new external-facing auth boundary.

21. **Notification digest / in-app read/unread center wiring for sales events** — **S**.
    Rationale: `Notification` model and `notifications` module exist but it's unclear (not
    verified beyond controller/service/notify.ts) whether sales events (order approved, invoice
    overdue, dispatch gate-approved) actually call `notify.ts` — a quick audit + wiring pass
    would raise the value of an existing feature cheaply. Endpoints/screens: none new, just
    call-sites. Touches: sales-order, sales-invoice, goods-dispatch, notifications. Isolated,
    very cheap — good candidate to bundle with #13 or #14.

22. **Discount/commission-safe GST compliance guardrails** — **S**. Rationale: ensure any new
    scheme/commission features (items #6, #7) never let a discount be applied _after_ invoice
    GST calculation in a way that under-reports taxable value — i.e. schemes must feed into
    `gst.calc.ts` inputs, not be bolted on post-hoc. This isn't a standalone feature but a
    guardrail to bake into #6/#7's implementation; flagged here so it isn't missed during
    estimation/sequencing of those two items.

## 3. Isolation vs sequencing

**Buildable in isolation (low cross-domain risk):**
#2 price lists, #4 leads, #8 complaints, #11 cash sales, #12 sample requests, #13 customer 360,
#15 transporter FK cleanup, #17 export polish, #21 notification wiring.

**Needs light sequencing within this domain (small hook into an existing service):**
#3 rate contracts (after #2), #6 commission (hook sales-invoice posting), #7 schemes (hook
order/invoice line pricing), #9 proforma (verify enum wiring first), #10 packing list (after #1),
#14 credit-limit enforcement (verify current invoice-creation path first), #16 template/auto-send
hooks (after choosing trigger events).

**Needs cross-domain coordination / bigger sequencing:**
#1 sales-linked dispatch (touches goods-dispatch's production-facing model + mobile POD),
#5 first-class Quotation entity (data migration + UI rewrite, do after #4),
#18 sales-order↔production linkage (coordinate with production domain),
#19 delivery-challan SALE kind (coordinate with whichever domain owns `delivery-challan`/
job-work — not present in this domain's module list),
#20 customer portal (new auth surface, sequence last, needs security review).

**Cheap high-value quick wins to lead with:** #13 (customer 360), #21 (notification wiring),
#15 (transporter FK), #12 (sample requests) — plus closing the test-coverage gap (section 1)
before adding more surface area to modules that currently have zero integration tests.
