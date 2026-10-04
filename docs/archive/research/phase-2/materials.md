Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Materials Management & Inventory — Domain Research

## 1. Inventory (existing)

### Prisma models (apps/api/prisma/schema.prisma)

- `RawMaterial` (L1246) — hybrid item-master **and** single stock row: `onHandQty`, `reservedQty`,
  `storeId` (singular, one store only), `locationId` -> `StoreLocation`, `batchNo`, `minimumStock`,
  `reorderLevel`, `categoryId`, `hsnCodeId`, `gstRate`, `itemType`, `status`. `@@unique([companyId, rawMaterialId])`.
- `RawMaterialTransaction` (L1656) — ledger: `txnType` (free-text string, not enum), `qty`, `storeId`,
  `productionOrderId`. No `unitCost`/valuation fields — pure quantity ledger.
- `RawMaterialStock` — **no such Prisma model**; module `raw-material-stock` operates directly on
  `RawMaterial` rows (see Quality issues).
- `FinishedGoodsStock` (L1318) — proper per-store balance, PK `[storeId, productItemId]`, one row
  per store+product (unlike RawMaterial).
- `FinishedGoodsTransaction` (L1337) — ledger with `txnType` string, links to production order /
  delivery challan / invoice.
- `Store` (L1181) — `storeCategory` enum `StoreCategory {RAW_MATERIAL, FINISHED_GOODS, WASTAGE}`,
  `costMethod` (default `"WAVG"`), `allowNegative`, `gstPlace`, `inchargeId`, `businessPlaceId`.
- `StoreLocation` (L1225) — hierarchical bin/rack within a store (`parentId` self-relation,
  `locationCode`, `locationType`, `capacityQty`/`capacityUom`). Used by `RawMaterial.locationId`
  only — **not** by FinishedGoodsStock or Product.
- `BillOfMaterial` (L1296) — flat product→rawMaterial lines (`requiredQuantity`, `percentage`,
  `uom`); no versioning, no effective-dates, no nested/multi-level BOM, no scrap % or yield factor.
- `Category` (L2648) — generic `CategoryType` enum, used by both `RawMaterial` and `Product`.
- `UnitOfMeasure` (L1101) — simple code/name table, tenant-scoped; but many other models
  (`BillOfMaterial.uom`, `RawMaterial.baseUom`, `PurchaseOrderItem.uom`, `GrnInvoiceItem.uom`)
  store UOM as a free **string**, not an FK — no conversion factors, no UOM-to-UOM conversion table.
- `Product` (L961) — production item master (`productType` PRODUCTION | SALES_PRODUCTION), `uomId`
  FK, `weightPerPiece`, `capacityLitres`, `gradeRates` (Json), `categoryId`, `hsnCodeId`.
- `ProductImage` (L946), `SalesProduct`/`SalesProductStock`/`SalesProductComponent` (kit assembly).
- `StockAdjustment` / `StockAdjustmentItem` (L2024/2056) — generic adjustment doc covering stock
  increase/decrease, physical count corrections, and **Production Material Issue**
  (`adjustmentType: "PRODUCTION_MATERIAL_ISSUE"`) — i.e. material issue-to-production is piggy-backed
  onto the adjustment model rather than a first-class MRN/issue document.
- `ProductionWastage` (L1972) — `wastageType` enum, links `rawMaterialId` + `productId`, ties to
  machine/shift/hourly-production; this is the scrap/regrind capture point.
- `EodStockSnapshot` (L2333) — daily locked snapshot per category/item/store, used by `inventory` module.
- `StockValuationEntry` (L4935) + `ProductCostSheet` (L5027) — weighted-average valuation ledger
  (`costing`/`valuation.service.ts`), separate from the qty-only transaction tables above.
- `GrnInvoice`/`GrnInvoiceItem` (L1838/1915) — goods receipt (no separate QC/inspection model;
  `updateStock` boolean flag posts stock directly, no accept/reject/quarantine step).
- No models for: `Mould`/`Die`/`Tool` (tooling asset register), `Bin` (beyond `StoreLocation`),
  material requisition, physical/cycle stock count, batch/lot with expiry, barcode/QR, packaging
  materials as a distinct item type, consumables/spares register.

### API modules (apps/api/src/modules/)

- `raw-material/` — CRUD (`raw_materials.*` permission).
- `raw-material-stock/` — CRUD that mutates `RawMaterial.onHandQty`/`reservedQty` directly (not a
  separate stock table); includes `deductForPurchaseReturn`.
- `raw-material-transaction/` — ledger read/write.
- `finished-goods-stock/`, `finished-goods-transaction/` — mirror of the above for FG.
- `store/`, `store-type/` (**dead**, see below), `stock-adjustment/`, `uom/`, `category/`, `product/`,
  `product-image/`, `bill-of-material/` (`billOfMaterial.*`), `production-wastage/`, `costing/`
  (+ `valuation.service.ts`), `inventory/` (EOD stock view + `jobs/eodStockSnapshot.job.ts` pg-boss job).
- All mounted in `apps/api/src/routes/index.routes.ts` **except `store-type`**.

### Web (apps/web/src/modules/)

`category`, `finished-stock`, `product`, `production`, `production-orders`, `production-wastage`,
`raw-materials`, `sales-product`, `stock`, `stock-adjustments`, `storage-stores`, `store-types`
(dead-end, see below), `wastage-stock`, `wastage-store`, `Eodstock`.

### Permissions (packages/shared/src/permissions.ts)

`raw_material_categories`, `raw_material_stocks`, `finished_goods_stocks`, `categories`,
`sub-categories`, `uoms`, `product-images`, `product-pricing`, `costing`, `production-wastages`,
`wastage-store`, `wastage-stock`, `stock-adjustments`, `eod-stock`, `stores`, `store-types`
(dead permission — see below), `inventory-reports`, `dash-inventory`.

### Tests

Only `test/integration/costing.spec.ts` and `products.spec.ts` touch this domain. **No integration
tests** for raw-material, raw-material-stock/transaction, finished-goods-stock/transaction,
store, stock-adjustment, bill-of-material, uom, category, or inventory (EOD). This is a large gap
given "Definition of done" requires happy-path + validation-rejection coverage per module.

## 2. Quality issues found

1. **`store-type` module is entirely dead/broken end-to-end.** `store-type.service.ts` calls
   `db.storeType?.findFirst/create/...` (`db = prisma as any`) but **no `StoreType` Prisma model
   exists in `schema.prisma`** — every call silently returns `undefined` (optional-chained), so
   create/update/delete effectively no-op or throw misleading 404s. The router is also **not
   mounted** in `routes/index.routes.ts` (grep confirms no `store-type` import/route), yet the web
   app has a full `apps/web/src/modules/store-types` screen and `packages/shared/src/api-paths.ts`
   defines `storeType.base = "/store-types"` and permission key `store-types` — a fully wired dead
   feature the team should either finish (add the model + mount route) or delete.
2. **No tenant scoping in `store-type.service.ts`** — every query omits `companyId` (`where: { code }`
   instead of `byCode`/`companyId` filter), violating the repo's core tenancy rule; another reason
   this module needs rebuilding, not patching.
3. **Raw material stock is not multi-store.** `RawMaterial` carries a single `storeId`/`locationId`/
   `onHandQty`, so the same material code cannot have independent balances in two stores/godowns —
   unlike `FinishedGoodsStock`, which is correctly modelled per `[storeId, productItemId]`. Any SME
   with a main store + WIP/regrind store + multiple locations cannot track raw material stock
   correctly today; `raw-material-stock.service.ts` even comments "In the updated schema, raw
   material stock is part of the RawMaterial model itself" as the (fragile) design choice.
4. **UOM is a free-text string almost everywhere** (`RawMaterial.baseUom`, `BillOfMaterial.uom`,
   `PurchaseOrderItem.uom`, `GrnInvoiceItem.uom`) despite a real `UnitOfMeasure` table existing —
   no conversion factors, so purchasing in kg against a BOM expressed in g/pcs requires manual math
   and is a likely reconciliation source of error for plastics granules/masterbatch.
5. **`RawMaterialTransaction.txnType` / `FinishedGoodsTransaction.txnType` are free strings**, and
   `inventory.service.ts` infers direction by substring match (`typ.includes("IN")`,
   `typ.includes("ISSUE")` etc.) — brittle; a new txnType that doesn't match a keyword silently
   nets to 0 and throws off EOD snapshot math.
6. **Material issue-to-production is not a first-class document** — it is
   `StockAdjustment.adjustmentType = "PRODUCTION_MATERIAL_ISSUE"`, an awkward overload of the
   "correction" model (`currentQty`/`adjustedQty`/`difference` fields don't fit an issue naturally).
7. **No QC/inspection gate on GRN.** `GrnInvoice.updateStock` is a raw boolean that posts stock
   directly; there is no accept/reject/quarantine quantity split, so a batch failing incoming QC
   still just becomes "don't tick the box," with no record of _why_ or partial-accept quantities.
8. **`BillOfMaterial` has no version/effective-date, no nested BOM, no expected scrap %.** Every
   product recipe change is a silent in-place edit with no history — bad for costing audits and
   for a plastics process where regrind ratios change often.
9. Almost the whole domain (see Tests above) has **zero integration test coverage**, contrary to
   "Definition of done" in CLAUDE.md.

## 3. Gap list — proposed features (ranked by value)

1. **Multi-store raw-material stock ledger** — S/M/L: **L**. Rationale: today a material can only
   sit in one store; SMEs run main-store + WIP + regrind + rejection stores. Model: new
   `RawMaterialStock` table `@@id([companyId, storeId, rawMaterialId, batchId?])` with
   `onHandQty`/`reservedQty`, mirroring `FinishedGoodsStock`; `RawMaterial` keeps master fields only.
   Endpoints: `GET /raw-material-stocks?storeId=`, transfer endpoint. Touches raw-material,
   raw-material-stock, raw-material-transaction, stock-adjustment, costing. **Needs sequencing**
   (breaking schema change touching many services) — do this before batch/lot or bin gaps below.

2. **UOM conversion table + FK everywhere UOM is a free string** — **M**. Rationale: buy PP in kg,
   consume in g per BOM line, sell FG in pcs — today all manual. Model: `UomConversion
(fromUomId, toUomId, factor)`; migrate `RawMaterial.baseUom`, `BillOfMaterial.uom`,
   `PurchaseOrderItem.uom`, `GrnInvoiceItem.uom` to `uomId` FK with a display fallback. Touches
   uom, raw-material, bill-of-material, purchase (cross-domain). Can start in isolation (add table
   - service) but the FK migration needs sequencing with purchase/GRN owners.

3. **Batch/lot tracking with expiry for raw materials (esp. masterbatch/additives)** — **M**.
   Rationale: masterbatch and some additives have shelf life; recycled regrind blends need
   traceability back to source batch for customer complaints. Model: `RawMaterialBatch
(rawMaterialId, batchNo, mfgDate, expiryDate, supplierId, grnInvoiceItemId, qty, rate)`,
   FEFO-aware issue logic in raw-material-stock service. Endpoints: batch list/expiry report.
   Screens: batch picker on GRN and on material-issue. Depends on gap 1 (multi-store ledger) to
   avoid a second migration.

4. **First-class Material Requisition & Issue document (MRN)** — **M**. Rationale: production
   floor should request materials against a production order/BOM explosion and store staff should
   issue against it, not overload StockAdjustment. Model: `MaterialRequisition` +
   `MaterialRequisitionItem` (`requestedQty`, `issuedQty`, `status`), posts to
   `RawMaterialTransaction` on issue. Touches raw-material-stock, raw-material-transaction,
   production-order, stock-adjustment (retire PRODUCTION_MATERIAL_ISSUE overload). Sequencing:
   after gap 1.

5. **Physical stock count / cycle count workflow** — **M**. Rationale: no structured "count sheet
   → variance → approval → adjustment" flow exists; StockAdjustment today assumes you already know
   the new qty. Model: `StockCount` (`countDate`, `storeId`, `status`), `StockCountItem`
   (`systemQty`, `countedQty`, counted by, variance) that on approval creates `StockAdjustment`
   rows. Endpoints + screen for mobile-friendly count entry (ties into `modules/mobile` conflict
   policy). Can be built largely in isolation once gap 1 lands.

6. **Reorder / low-stock alerting job + purchase suggestion** — **S**. Rationale: `reorderLevel`/
   `minimumStock` fields exist on `RawMaterial` but nothing reads them proactively — no alert, no
   suggested-PO. Add a pg-boss daily job comparing `onHandQty` to `reorderLevel` per store, emits
   `emitToTenant` notification + optional auto-draft `PurchaseOrder`. Touches raw-material,
   inventory, purchase (job-work/purchasing domain), notifications. Isolated, low risk — good
   quick win.

7. **QC/inspection step on GRN (accept/reject/quarantine)** — **M**. Rationale: plastics granule
   colour/MFI variance and contamination need a gate before stock posts, especially for job-work
   returns. Model: `GrnInspection` (`grnInvoiceItemId`, `inspectedQty`, `acceptedQty`,
   `rejectedQty`, `quarantineQty`, `inspectorId`, `remarks`, `status`); `GrnInvoiceItem.updateStock`
   becomes conditional on inspection pass. Touches GRN (purchasing domain) + raw-material-stock.
   Needs sequencing with the purchasing/GRN owner.

8. **BOM versioning + nested BOM + scrap %** — **M**. Rationale: recipe changes (regrind ratio,
   masterbatch %) need audit history for costing disputes; multi-stage products (e.g. container +
   lid assembled into a kit) already exist via `SalesProductComponent` but raw-material BOM stays
   flat. Model: add `bomVersion`, `effectiveFrom`/`effectiveTo`, `expectedScrapPercent` to
   `BillOfMaterial`; optional `parentBomLineId` for nested/sub-assembly BOM. Touches
   bill-of-material, costing, production-order (BOM explosion). Isolated schema-only change.

9. **Moulds & dies tooling asset register with usage/maintenance linkage** — **M**. Rationale:
   moulds/dies are high-value tooling that wears out per shot-count; today nothing tracks them as
   inventory/assets tied to a machine+product. Model: `Tooling` (`toolingId`, `type` MOULD|DIE,
   `productId`, `cavityCount`, `machineCompatibility`, `shotCountLifeLimit`, `currentShotCount`,
   `location`, `status`), `ToolingMaintenanceLog`. Endpoints: CRUD + shot-count increment hook from
   hourly-production. Touches inventory (new domain slice), production (hourly-production,
   production-order), machine. Can be built in isolation as a new module; wire-up to production
   counters is a later increment.

10. **Consumables & spares register (distinct from RawMaterial)** — **S**. Rationale: machine
    spares/oils/filters are tracked (if at all) as raw materials today, polluting BOM-relevant
    material lists. Add `itemType` discriminator already exists (`RawMaterial.itemType`) — gap is
    UI/reporting split + a "spares issue" flow separate from production material issue. Mostly a
    screen/reporting gap; **S** size, isolated.

11. **Packaging materials as first-class item type with FG-side BOM (packing list)** — **S**.
    Rationale: cartons, liners, pallet wrap consumed per dispatch, not per production order; needs
    its own consumption trigger (goods dispatch) rather than production BOM. Model: reuse
    `RawMaterial.itemType = "PACKAGING"` + new `PackagingBom` linking `productId`/`deliveryChallanId`
    to packaging item qty. Touches raw-material, delivery-challan (dispatch domain). Needs
    sequencing with dispatch owner.

12. **Scrap/regrind store with automatic regrind-to-raw-material conversion** — **M**. Rationale:
    `Store.storeCategory` already has `WASTAGE`, and `ProductionWastage` captures scrap qty, but
    there's no workflow to convert accumulated rejects into a "Regrind PP" raw material lot once
    ground, with a yield/loss %. Model: `RegrindConversion` (`sourceWastageIds[]`, `inputQty`,
    `outputQty`, `yieldPercent`, `outputRawMaterialId`, `outputStoreId`) posting a
    `RawMaterialTransaction` OPENING/RECEIPT-like entry. Touches production-wastage, raw-material,
    store, costing (regrind should value lower than virgin). Depends on gap 1.

13. **Barcode/QR generation & scan-based stock moves** — **M**. Rationale: bag-level barcoding for
    PP/HDPE bags, scan-to-issue on the floor, mobile-friendly. Model: add `barcodeValue` to
    `RawMaterial`/batch (gap 3) and `Store`/`StoreLocation`; new `POST /inventory/scan` endpoint
    resolving a code to item+location for the mobile app. Screens: label print (GRN), scan issue
    (production/mobile). Touches raw-material, mobile module, production. Best sequenced after
    gap 3 (batch model exists to scan against).

14. **Bin/location putaway for Finished Goods and Products** (extend `StoreLocation` usage) — **S**.
    Rationale: `StoreLocation` hierarchy already exists but is wired only to `RawMaterial`; FG has
    no bin. Add optional `locationId` to `FinishedGoodsStock`. Touches finished-goods-stock,
    store. Isolated, small.

15. **Inter-store stock transfer document** — **M**. Rationale: no explicit transfer-out/transfer-in
    document exists; today a move between stores is two manual adjustments with no linkage. Model:
    `StockTransfer`/`StockTransferItem` (`fromStoreId`, `toStoreId`, `status` DISPATCHED/RECEIVED),
    posts paired `RawMaterialTransaction`/`FinishedGoodsTransaction` rows with a shared
    `relatedDocNo`. Touches raw-material-transaction, finished-goods-transaction, store,
    stock-adjustment. Depends on gap 1 for raw material side; FG side is isolated today.

16. **Negative-stock guardrail enforcement + `Store.allowNegative` actually used** — **S**.
    Rationale: `Store.allowNegative` field exists but a scan of the stock-mutating services shows
    no consistent check against it before decrementing `onHandQty` (worth verifying per-service);
    proposing a shared `assertStockAvailable(storeId, qty)` helper in `lib/`. Touches raw-material-
    stock, finished-goods-stock, stock-adjustment, production-wastage. Isolated helper + call-sites.

17. **Store-type re-implementation (fix the dead module) or removal** — **S**. Rationale: currently
    fully broken (see Quality issue 1); either finish it (Prisma model + tenant scoping + mount
    route) so a real store-category taxonomy beyond the fixed `StoreCategory` enum works, or delete
    the dead web screen, api-path and permission to stop confusing future contributors. Isolated,
    low risk, but blocks nothing else.

18. **Standard inventory reports: stock valuation summary, ageing, slow/non-moving, reorder list**
    — **M**. Rationale: `costing`/`valuation.service.ts` has the ledger but no owner-facing report
    surface beyond ad hoc queries; permission `inventory-reports` already exists in
    `packages/shared/permissions.ts` but no corresponding module was found under
    `apps/api/src/modules` — likely another dead/placeholder permission. Build
    `GET /inventory/reports/{valuation-summary,ageing,slow-moving,reorder}`. Touches costing,
    raw-material, finished-goods-stock. Isolated once gap 1's stock-by-store data exists (ageing
    needs batch dates from gap 3 to be meaningful, but a basic version works now).

19. **Non-moving/expiry alert job for batched materials** — **S**. Depends on gap 3. Rationale:
    plastics additives/masterbatch degrade; SME owners want a proactive nudge before a costly bag
    goes unusable. pg-boss daily job + notification. Isolated once gap 3 exists.

20. **Job-work material tracking (materials sent to/received from sub-contractors)** — **L**.
    Rationale: brief explicitly calls out job-work in/out as core to the sector; today no model
    tracks "raw material sent to job-worker" vs. "finished component received back," so that
    inventory effectively disappears from the books while at the job-worker. Model:
    `JobWorkChallan`/`JobWorkChallanItem` (`direction` OUT|IN, `partyId`, `rawMaterialId`/
    `productId`, `qty`, linked pair for reconciliation), posts to a new `storeCategory` "IN_TRANSIT
    /AT_JOB_WORKER" virtual store so it still shows on the balance sheet (never off-books). Touches
    raw-material-transaction, finished-goods-transaction, store, GST (job-work challans under GST
    have specific rules — cross-domain with GST/documents). **Needs heavy sequencing** — largest,
    most cross-cutting item in this list; likely a shared initiative with the GST/documents domain.

## 4. Isolated vs sequenced

**Can build largely in isolation (low cross-domain dependency):**
6 (reorder alert job), 8 (BOM versioning), 9 (tooling register — new module), 10 (consumables split),
14 (bin for FG), 16 (negative-stock guardrail), 17 (fix/remove store-type).

**Need sequencing (schema or cross-team dependency):**
1 (multi-store RM ledger — prerequisite for 3, 12, 13, 15, 19), 2 (UOM FK migration — touches
purchasing), 4 (MRN — depends on 1), 3 (batch/lot — depends on 1), 7 (GRN inspection — needs
purchasing/GRN owner), 11 (packaging BOM — needs dispatch owner), 12 (regrind conversion — depends
on 1), 13 (barcode — depends on 3), 15 (stock transfer — depends on 1 for RM side), 18 (reports —
better after 1 and 3), 20 (job-work — largest, cross-domain with GST/documents; plan separately).

Recommended build order: **17 → 6 → 1 → 2 → 4 → 3 → 15 → 12 → 7 → 5 → 13 → 18/19 → 8/9/10/14/16 as
capacity allows → 20 as a dedicated cross-team initiative.**
