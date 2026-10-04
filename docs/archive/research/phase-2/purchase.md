Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Purchase management & supplier — research report

## 1. Inventory

### Prisma models (apps/api/prisma/schema.prisma)

- `Supplier` (836), `SupplierAddress` (902) — masters. Has MSME fields (`msmeCategory`, `udyamNumber`,
  `hasWrittenContract`, `agreedPaymentDays`, `higherRate206AB`), TDS `deducteeType`, `creditDays`,
  opening balance. `id` is `Int @autoincrement()` (only purchase-side master still on int PK; rest
  of schema is moving to uuid) — fine functionally, just inconsistent.
- `SupplierMaterialPrice` (819) — per-supplier, per-raw-material price with `validFrom/validTo`
  (simple price-history/rate-contract seed, no MOQ tiers, no currency, no approval).
- `PurchaseOrder` (1758) / `PurchaseOrderItem` (1805) — status is a free-text `String` (`DRAFT`
  default), not an enum; no PO approval workflow field, no `approvedBy/approvedAt`, no linkage to
  a requisition/indent, no revision/amendment history.
- `GrnInvoice` (1838) / `GrnInvoiceItem` (1915) / `GrnInvoicePayment` (1950) — combined
  goods-receipt + supplier-invoice-booking document, optional `poId` link, `reverseCharge`,
  `businessPlaceId`/`placeOfSupply`/`supplyType`, cancel fields, `payments` Json blob **and** a
  proper `GrnInvoicePayment` child table (redundant/duplicated payment tracking — pick one).
  No QC/inspection fields, no gate-entry/vehicle/weighbridge fields, no partial/multi-GRN
  reconciliation against a PO beyond `PurchaseOrderItem.receivedQty`.
- `PurchaseReturn` (3117) / `PurchaseReturnItem` (3159) — debit-note-capable purchase returns
  module (routes live under `returns`, not under `grn-invoice` or a dedicated module).
- `BillOfEntry` (4878) — import/customs landed-cost split (assessable value, BCD, SWS, IGST,
  cess, other charges → landed cost), links optionally to a `GrnInvoice`/`Supplier`. This is the
  "foreign purchase" / import module, even though the code module named `imports` is actually the
  generic CSV bulk-data importer (`apps/api/src/modules/imports/*`, unrelated to customs). The
  actual BOE logic lives in `apps/api/src/modules/currency/imports.service.ts` (263 lines) and is
  routed through `apps/api/src/modules/currency/fx.routes.ts` under `imports.*` permissions.
- `JobWorker` (4267), `DeliveryChallan`/`DeliveryChallanItem` (4297, 4353) — job-work-out register
  with ITC-04 return-due-date tracking (`ChallanKind`, `capitalGoods` 3-year clock). `JobWorker`
  is a separate master from `Supplier` (no FK) — a job worker who is also a raw-material vendor
  needs two separate master records with no link.
- `TdsSection` / `TdsDeduction` (4400s/4456) — TDS on supplier bills (194Q, 194C, 206AB etc.),
  linked to `Supplier` via `supplierId`.
- `Expense` (2104) — non-inventory/services purchases (with GST + RCM handling in
  `expense.tax.ts`), linked to `Supplier`.
- `Currency` (4117) + `fx.service.ts`/`fx.routes.ts` — exchange rates for foreign-currency
  purchases/imports.
- Supplier ledger/statement/ageing live in the **accounts** domain, not purchase:
  `modules/accounts/payable.service.ts`, `standardLedgers.ts`, `statement.service.ts`,
  `ageing.service.ts` (out of scope to rebuild, but purchase gaps below should reuse these).
- `StockValuationEntry` (weighted-average) picks up GRN receipts for landed-cost-aware costing.
- No models at all for: RFQ, quotation comparison, purchase requisition/indent, blanket/rate
  contract (beyond the flat `SupplierMaterialPrice`), supplier rating/scorecard, approved-vendor
  list/status workflow, gate entry/inward register, weighbridge, QC/inspection on receipt,
  three-way-match exceptions, capital-goods purchase register (capex sits generically under
  `FixedAsset`, with `Supplier` FK only), broker/agent/DCA-specific fields on `Supplier`.

### API modules (`apps/api/src/modules/<name>`)

`supplier`, `supplier-material-price`, `purchase-order`, `grn-invoice`, `imports` (CSV bulk
import, not customs), `currency` (`fx.routes.ts` — actually hosts BOE/imports + FX rates),
`msme`, `job-work`, `expense`, `tds`, plus `returns` (purchase+sales returns combined) and
`accounts` (payable/ageing/statements — supplier ledger lives here).

Quality issues found:

- **`grn-invoice.routes.ts` has no `requirePermission(...)` on any route** — only
  `requireFeature("purchase")` gates it. Every module in this domain (`purchase-order`,
  `supplier`, `supplier-material-price`, `job-work`, `msme`, `tds`, `expense`, `fx`) uses
  `requirePermission`; GRN — the module that books stock and supplier liability — does not. This
  contradicts CLAUDE.md ("every router uses requirePermission") and should be fixed regardless of
  new feature work.
- `GrnInvoice.payments` (Json) duplicates `GrnInvoicePayment` (proper relational table) — dead/
  legacy field or an in-progress migration; worth cleaning up.
- `PurchaseOrder.status` / `GrnInvoice.status` are free-text `String`, not enums — no compile-time
  guard against typos, unlike `ChallanStatus`/`WastageStatus` elsewhere in the schema.
- No `apps/api/test/integration/*.spec.ts` for **supplier**, **purchase-order**, **grn-invoice**,
  or **purchase-returns** — a large uncovered surface (money-moving, tax-affecting documents).
  Only `jobwork.spec.ts`, `msme.spec.ts`, `tds.spec.ts`, `fx.spec.ts`, `imports.spec.ts` exist in
  this domain.
- `JobWorker` has no relation to `Supplier`; a vendor who is both a material supplier and a job
  worker is entered twice with no cross-reference — ledger/TDS/MSME logic on the job-worker side
  is effectively absent (job work charges aren't on the `TdsSection`/`MsmeCategory` machinery at
  all since `JobWorker` carries none of those fields).
- `Supplier.id` is `Int` while the rest of the schema (`PurchaseOrder`, `GrnInvoice`, etc.) has
  moved to uuid — inconsistent but not a bug.

### Web (`apps/web/src`)

- `modules/supplier/pages`: `SupplierList`, `SupplierForm`, `SupplierView`,
  `Suppliermaterialpricinglist.tsx`; `features/supplier/supplierSlice.ts`.
- `modules/purchase/purchase-order/*`: list/create/view pages, `invoice/GrnInvoiceViewPage.tsx`
  (GRN is nested under purchase-order, no standalone GRN list/create screen path found separately
  — worth confirming with a fuller route scan if picking up GRN work);
  `features/purchaseOrder/purchaseOrderSlice.ts`.
- `modules/accounts/pages/MsmePage.tsx`, `modules/accounts/pages/returns/PurchaseReturnPage.tsx`
  — both purchase-domain screens live under the `accounts` web module, not `purchase`.
- `modules/production/jobwork/JobWorkPage.tsx` — job-work screen lives under `production`.
- `modules/compliance/pages/TdsPage.tsx` — TDS under `compliance`.
- `modules/expenses/{ExpensesList,Expensescreate}.tsx`.
- `modules/imports/pages/ImportsPage.tsx` — this is the CSV bulk importer UI, not customs BOE.
  No web screen found for Bill of Entry (`billOfEntry`) despite the API supporting it
  (`fxService.ts` exists for FX rates only) — likely a gap: BOE has backend + no dedicated UI.
- No RFQ/quotation, requisition/indent, gate-entry, QC-inspection, approved-vendor, or
  supplier-scorecard screens anywhere.

### Permission keys (`packages/shared/src/permissions.ts`)

`suppliers`, `supplierpricelist`, `purchaseOrders`, `expenses`, `purchase-returns`, `job-work`,
`tds`, `imports` (BOE/customs, confusingly shares the name with the CSV-import feature),
`purchase-reports`. No dedicated `grnInvoices` permission module (GRN rides on `requireFeature`
only, see above) — no `msme` module either (MSME routes reuse `payable.view`/`filings.prepare`).

## 2. Gaps (ranked by value to a plastics SME owner/accountant/plant manager)

1. **GRN permission gate + status enum + payments cleanup (fix, not a feature)** — close the
   `requirePermission` hole on `grn-invoice.routes.ts`, convert `PurchaseOrder.status` /
   `GrnInvoice.status` to enums, drop the dead `GrnInvoice.payments` Json in favour of
   `GrnInvoicePayment`. Touches: `grn-invoice`, `purchase-order`. Size: S. Isolated.

2. **Purchase requisition / indent** — plant floor or store raises a request (material, qty,
   need-by date, reason) that a purchase approver converts into one or more POs; gives spend
   control and a paper trail before PO. Model: `PurchaseRequisition`, `PurchaseRequisitionItem`
   (status DRAFT/APPROVED/PARTIALLY_ORDERED/CLOSED, `requestedBy`, `storeId`, `rawMaterialId`,
   `qty`, `neededBy`, optional `productionOrderId` link for MTO). Endpoints: CRUD + approve +
   convert-to-PO. Screens: requisition list/create, approval inbox, "create PO from requisition."
   Touches: `purchase-order`. Size: M.

3. **RFQ & quotation comparison** — send an RFQ to 3+ suppliers for the same raw material/spec,
   record each supplier's quoted price/lead-time/payment terms, compare side-by-side, award to
   one (creates the PO, and optionally a `SupplierMaterialPrice` row). Model: `Rfq`, `RfqItem`,
   `RfqSupplier`, `Quotation`, `QuotationItem` (per supplier per RFQ). Endpoints: create RFQ, log
   quotations (manual entry — no supplier portal needed for MVP), comparison view, award→PO.
   Screens: RFQ create/send, comparison grid, award. Touches: `supplier`,
   `supplier-material-price`, `purchase-order`. Size: L.

4. **Approved Supplier List (ASL) / supplier status & category** — a supplier can be
   `PENDING_APPROVAL` / `APPROVED` / `BLACKLISTED` / `ON_HOLD` per material category (a polymer
   DCA might be approved for PP but not additives); PO creation blocked for non-approved
   suppliers for a controlled category, with an override + reason. Model: add
   `approvalStatus`, `approvedCategories Json`/`SupplierCategoryApproval[]` to `Supplier`;
   `SupplierApprovalHistory`. Endpoints: approve/reject/blacklist with reason; PO create-time
   check. Screens: ASL tab on supplier, approval workflow. Touches: `supplier`, `purchase-order`.
   Size: M.

5. **Supplier rating / scorecard** — score suppliers on OTIF (on-time-in-full delivery), quality
   rejection %, price competitiveness, responsiveness; computed from GRN vs PO dates/qty and
   `QualityInspection` rejections (gap 6), plus a manual rating. Model: `SupplierRating` (period,
   supplier, otifScore, qualityScore, priceScore, overallScore, computedAt) or a materialized
   view refreshed by a pg-boss job. Endpoints: rating list, recompute, per-supplier scorecard.
   Screens: supplier scorecard tab, ranking report. Touches: `supplier`, `purchase-order`,
   `grn-invoice`. Size: M. Depends on GRN having received-vs-ordered qty/date data (already has
   `receivedQty`; needs `receivedDate` per line or reuse `GrnInvoice.receiveDate`).

6. **Quality inspection on receipt (QC/IQC)** — record accept/reject/hold per GRN line with
   inspector, sample size, defect reason, and post rejected qty to a "rejected/quarantine" stock
   location instead of usable stock; feeds supplier rating and purchase-return. Model:
   `GrnInspection`, `GrnInspectionItem` (grnItemId, qtyInspected, qtyAccepted, qtyRejected,
   defectCode, inspectorId, disposition REWORK/RETURN/SCRAP/USE_AS_IS). Endpoints: inspect a GRN,
   list pending inspections, disposition. Screens: QC inbox, inspection form. Touches:
   `grn-invoice`, `purchase-returns` (reject→return), stock modules for the quarantine location.
   Size: L. High value for plastics (resin batches, regrind quality vary a lot).

7. **Gate entry / inward register** — vehicle arrives at the factory gate before GRN is booked;
   security logs vehicle no., driver, supplier, challan/invoice no., gross/tare weight (many
   plastics plants weigh incoming PP/HDPE bags), time-in/time-out, and the GRN references the
   gate entry. Model: `GateEntry` (entryNo, vehicleNumber, driverName, supplierId, challanNo,
   grossWeight, tareWeight, netWeight, timeIn, timeOut, status, grnInvoiceId nullable). Endpoints:
   CRUD, close on GRN creation. Screens: gate register list/create, security-role-only access.
   Touches: `grn-invoice`. Size: M. Isolated (new module, optional FK from GRN).

8. **Three-way match (PO / GRN / Supplier Invoice) with tolerance** — today `GrnInvoice` books
   goods receipt and invoice as one document; add an explicit match check (qty and price
   tolerance %) between `PurchaseOrderItem`, `GrnInvoiceItem`, and a booked amount, flagging
   exceptions for approval before payment release. Model: reuse existing tables, add
   `PurchaseOrderItem` vs `GrnInvoiceItem` variance computation service +
   `GrnInvoice.matchStatus` (MATCHED/VARIANCE/OVERRIDDEN) and `matchOverrideReason`. Endpoints:
   match-check on GRN save, exception list. Screens: exception queue before payment approval.
   Touches: `purchase-order`, `grn-invoice`. Size: M.

9. **Blanket / rate contract with call-off tracking** — annual or period rate agreement with a
   supplier for a material (price, validity, min/max quantity commitment); POs are "call-offs"
   against the contract and the contract tracks cumulative ordered qty vs committed qty. Model:
   `RateContract` (supplierId, rawMaterialId, price, validFrom/To, committedQty, orderedQty,
   priceBasis e.g. "MCX polymer index + premium" for polymer distributors), link
   `PurchaseOrderItem.rateContractId`. Endpoints: CRUD, utilization report. Screens: contract
   list, utilization dashboard, PO-creation auto-fill from active contract. Touches:
   `supplier-material-price` (supersedes/extends it), `purchase-order`. Size: M.

10. **Landed cost allocation beyond imports (freight/duty apportionment to stock)** — `BillOfEntry`
    already computes landed cost for imports; extend the same freight/handling/octroi allocation
    to **domestic** GRNs (freight paid separately, loading/unloading, weighment charges) so raw
    material stock valuation (`StockValuationEntry.rate`) reflects true cost, not just invoice
    price. Model: `GrnLandedCost` (grnInvoiceId, chargeType FREIGHT/HANDLING/OTHER, amount,
    allocationBasis QTY/VALUE/WEIGHT) that apportions across `GrnInvoiceItem`s before posting to
    `StockValuationEntry`. Endpoints: add landed-cost lines to a GRN. Screens: landed-cost tab on
    GRN. Touches: `grn-invoice`, costing/stock-valuation modules. Size: M.

11. **Bill of Entry (BOE) web screens** — the backend (`currency/imports.service.ts`,
    `BillOfEntry` model, `fx.routes.ts` under `imports.*` permission) has no corresponding web
    module found (`modules/imports/pages/ImportsPage.tsx` is the unrelated CSV importer). Build
    BOE create/list/view screens under a proper `purchase/imports` or `purchase/customs` web
    module. Touches: `imports`(BOE)/`currency`. Size: S–M (backend logic already exists).

12. **Job worker ↔ Supplier unification (or at least linkage)** — let a `JobWorker` optionally
    reference an existing `Supplier` row (same GSTIN/PAN) so job-work charges bills flow through
    the same TDS (194C), MSME 43B(h), and supplier-ledger machinery that raw-material purchases
    already get; today job-work-out (`DeliveryChallan`) tracks only the _material movement_, not
    the _labour charge bill_ for job work done. Add `JobWorkInvoice`/`JobWorkBill` (references
    `DeliveryChallan` + `Supplier`, job-work charge, GST on job-work service, TDS) so job-work
    purchases show up in payables/MSME/TDS reports. Model: `JobWorker.supplierId` (nullable FK),
    new `JobWorkInvoice`. Endpoints: bill-against-challan, list. Screens: job-work billing tab.
    Touches: `job-work`, `supplier`, `tds`, `msme`. Size: L. Needs sequencing after #2 fix ideas
    are stable since it changes `JobWorker`.

13. **Purchase order approval workflow** — multi-level PO approval (e.g. above ₹X needs owner
    sign-off) before it can be sent to supplier or converted to GRN; today `status` is free text
    with no gating. Model: add `approvalThreshold` config + `PurchaseOrder.status` enum
    (DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/SENT/PARTIALLY_RECEIVED/CLOSED/CANCELLED),
    `approvedBy`/`approvedAt`. Endpoints: submit/approve/reject. Screens: approval inbox, PO
    status badges. Touches: `purchase-order`. Size: M.

14. **Broker/agent (DCA) purchase support** — polymer purchases often route through a dealer/
    consignment agent (Reliance/IOCL DCA) who isn't the manufacturer; add `brokerId`/`agentId` on
    `PurchaseOrder`/`GrnInvoice` (a `Supplier` row with a `supplierType=BROKER/DCA` flag) so
    commission/brokerage can be tracked separately from material cost, and the underlying
    principal (Reliance/IOCL) can be recorded for traceability even though the DCA issues the
    invoice. Model: `Supplier.supplierType` enum (MANUFACTURER/DISTRIBUTOR/DCA/BROKER/JOB_WORKER/
    TRANSPORTER), `PurchaseOrder.principalSupplierId` (nullable, informational). Endpoints:
    minor additions to existing supplier/PO APIs. Screens: supplier type filter, PO principal
    field. Touches: `supplier`, `purchase-order`. Size: S.

15. **Scrap/regrind purchase from unregistered dealers with RCM** — plastics recyclers often buy
    scrap/regrind from unregistered local dealers; GST RCM on such purchases (where applicable)
    and TDS treatment differ from normal trade purchases, and cash-heavy transactions need clean
    voucher trails (no off-book flows). `GrnInvoice.reverseCharge` already exists — extend
    `Supplier.gstRegType = UNREGISTERED` handling to auto-suggest RCM eligibility, and add a
    `purchaseCategory` (VIRGIN_MATERIAL/REGRIND/SCRAP/JOB_WORK/CAPITAL_GOODS/SERVICES) on
    `PurchaseOrder`/`GrnInvoice` to separate scrap-purchase reporting from virgin-resin purchase
    for the owner's dashboard and GST reconciliation. Endpoints: category filter on reports.
    Screens: scrap-purchase report, RCM liability report. Touches: `grn-invoice`, `gst`. Size: S.

16. **Capital goods purchase register with ITC tracking** — capital goods (moulds, machines) on
    which input credit is claimed over time or with restrictions; currently `FixedAsset` has a
    `Supplier` FK but no explicit "this GRN was a capital-goods purchase" flag feeding
    depreciation/ITC schedules. Model: `GrnInvoice.isCapitalGoods` flag (or reuse #15's
    `purchaseCategory`), link to `FixedAsset` creation from GRN directly (auto-create draft
    `FixedAsset` on capital-goods GRN). Endpoints: GRN→asset conversion. Screens: capital-goods
    GRN flag + "create asset" action. Touches: `grn-invoice`, `assets`. Size: S–M.

17. **Purchase order revision / amendment history** — price or qty change on an already-sent PO
    needs an auditable amendment (not silent edit) since suppliers act on the original. Model:
    `PurchaseOrderRevision` (poId, revisionNo, snapshot Json, reason, createdBy) written whenever
    a POSTED/SENT PO is edited. Endpoints: revision list, create-revision instead of raw update
    once sent. Screens: revision history tab. Touches: `purchase-order`. Size: S.

18. **Payment terms & due-date tracking dashboard (beyond MSME)** — MSME module already tracks
    section-15 due dates for MICRO/SMALL suppliers; extend the same due-date machinery to
    **all** suppliers via `Supplier.creditDays` (already exists) so accounts gets one unified
    "purchase bills due this week" view regardless of MSME status, not just the MSME-specific
    dashboard. Endpoints: generic AP due-list reusing `msme.service.ts` date math, filtered to
    non-MSME too. Screens: AP due-date widget on purchase/accounts dashboard. Touches: `msme`,
    `grn-invoice`, `accounts`. Size: S. Mostly a reporting extension, isolated.

19. **Supplier document management (certificates, agreements)** — GST certificate, UDYAM
    certificate (already has `msmeVerifiedOn` date but no file), PAN card, rate-contract PDF,
    ISO/quality certs, bank-details-change proof for fraud prevention. Model: `SupplierDocument`
    (supplierId, docType, fileUrl, expiryDate, verifiedBy). Endpoints: upload/list/expiry-alert.
    Screens: documents tab on supplier profile. Touches: `supplier`. Size: S. Isolated.

20. **Supplier bank-account change control** — a common ERP fraud vector: someone edits a
    supplier's bank account and the next payment goes to a fraudster. Add a maker-checker step
    (second approval required) specifically when `Supplier` bank details change, with an audit
    note and optional cooling-off period before the new account can receive a payment. Touches:
    `supplier`, `accounts`/payments. Size: S. High value, low cost — should be prioritized despite
    low line-count.

21. **Purchase of services/expenses — vendor rate card** — `Expense` already supports GST/RCM per
    line but has no linkage to a negotiated service rate (AMC, transport, job-work-adjacent
    services) the way `SupplierMaterialPrice` does for materials; add
    `SupplierServiceRate` (supplierId, serviceCategory, rate, uom) so recurring service expenses
    (freight per trip, mould maintenance per hour) can be rate-checked/auto-filled. Touches:
    `expense`, `supplier`. Size: S.

22. **PO/GRN delivery performance & short-close report** — report of POs still open past
    `expectedDeliveryDate`, partially received lines, and "short-closed" POs (accepted less than
    ordered and closed) — a plant manager view feeding into #5's OTIF scoring. Touches:
    `purchase-order`, `grn-invoice`. Size: S. Reporting-only, isolated.

23. **Debit note numbering & GSTR-2B-style reconciliation for purchase returns** — `PurchaseReturn`
    already has `debitNoteNo`; add matching against supplier's e-invoice/GSTR-2B data (when
    available) so ITC reversal on returns is auditable. Size: M, depends on GST/e-invoice modules
    maturing further — sequence after core GST reconciliation work, not purchase-only.

24. **Multi-currency PO/GRN for import purchases (not just BOE)** — `PurchaseOrder`/`GrnInvoice`
    have no `currencyCode`/`exchangeRate` fields of their own (only `BillOfEntry` does); a PO
    raised directly in USD to an overseas resin supplier can't be tracked in its own currency
    before the BOE stage. Add `currencyCode`, `exchangeRate` to `PurchaseOrder`/`GrnInvoice`,
    default INR. Touches: `purchase-order`, `grn-invoice`, `currency`. Size: M.

25. **Supplier segmentation / spend analytics (ABC/Pareto)** — spend-by-supplier, spend-by-
    material-category, top-N suppliers by value, single-source-risk flag (only one approved
    supplier for a critical raw material) — a report layer over existing GRN/PO data. Touches:
    `grn-invoice`, `purchase-order`, `supplier`. Size: S–M. Isolated, purely additive reporting.

## 3. Isolation vs sequencing

**Buildable in isolation (single-domain, few cross-module deps):**
1 (fix), 7 (gate entry), 9 (rate contract — extends existing `SupplierMaterialPrice`), 11 (BOE
screens — backend exists), 14 (broker/DCA flag), 15 (scrap/RCM category), 17 (PO revisions),
19 (supplier documents), 20 (bank-change maker-checker), 21 (service rate card), 22 (delivery
report), 24 (multi-currency PO fields), 25 (spend analytics).

**Need sequencing / cross-domain coordination:**

- 2 (requisition) → feeds 3 (RFQ) → feeds 9/13 (contract-aware, approval-gated PO) — natural
  build order: requisition → RFQ → PO approval → rate contract linkage.
- 6 (QC inspection) depends on GRN line-level receipt data and should land before/alongside 5
  (supplier rating, which consumes QC + OTIF data) and 8 (three-way match, which should include
  QC disposition in what counts as "matched").
- 12 (job-worker/supplier unification) touches `tds` and `msme` category logic — coordinate with
  whoever owns those so `JobWorker` doesn't silently duplicate `Supplier` compliance fields.
- 16 (capital goods → FixedAsset) needs the `assets`-module owner's input on the auto-create
  contract.
- 18 (unified AP due-list) is small but should reuse `msme.service.ts` date logic rather than
  reimplement it — coordinate to avoid drift between MSME-specific and generic due-date math.
- 23 depends on GST e-invoice/2B reconciliation maturing elsewhere — do not start standalone.
