Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Quality Management (QMS), Plant Maintenance (CMMS) & Tooling/Mould Management — Domain Research

## 1. Inventory (existing)

This domain is **almost entirely absent**. There is no `quality`, `maintenance`, `mould`/`die`/`tool`,
`calibration`, `ncr`/`capa`, or `inspection` model, module, screen, or permission anywhere in the repo.
What exists is scattered production/asset/purchasing data that a real QMS/CMMS/mould register would sit
on top of.

### Prisma models that touch this domain (apps/api/prisma/schema.prisma)

- `Machine` (L1145) — `machineId`, `machineName`, `technologyType`, `machineType`, `targetTemperature`,
  `targetLoadPercent`, `manufacturer`, `modelNumber`, `cycleTime` (sec/piece), `machineStatus`
  (`IDLE`/etc.), `businessPlaceId`. **No tonnage field, no mould/tooling compatibility, no
  maintenance/breakdown history, no meter/run-hour counter, no spare-parts link.** `machineStatus`
  enum has no `BREAKDOWN`/`UNDER_MAINTENANCE` state (check `enum MachineStatus`, ~L2500s).
- `ProductionWastage` (L1972) + `WastageType` enum (L2536) — the closest thing to a rejection-reason
  master today. Enum values: `STARTUP, MACHINE_SETUP, QUALITY_REJECTION, RAW_MATERIAL_WASTE, SCRAP,
REWORK, MACHINE_BREAKDOWN, POWER_FAILURE, MOULD_CHANGE, COLOR_CHANGE, OTHER` — a flat, hard-coded
  enum (not a tenant-editable master), mixing quality reasons, mould/tooling reasons and machine
  downtime reasons in one bucket. Fields: `quantity`, `estimatedValue`, `reason` (free text),
  `correctiveAction` (free text, no workflow/owner/due-date), `isRecyclable`, `sentForRework`,
  `approvedBy/At`, `status` (`WastageStatus`: DRAFT/etc.). No sampling data, no defect
  classification (critical/major/minor), no Pareto-ready structured reason codes beyond the enum.
  `MOULD_CHANGE` sitting as a wastage type is itself evidence mould changeover is only tracked as a
  scrap cause, not as an event with its own record (no mould entity to point `MOULD_CHANGE` at).
- `HourlyProduction` (L1575) — `rejectQty`, `scrapQty`, `downtime` (minutes), `downtimeReason`
  (free-text VarChar(100)), `rejectReason` (free-text VarChar(100)), `scrapReason` (free text).
  This is the only place "downtime reason" and "reject reason" are captured, and both are unstructured
  strings, not FKs to a reason master — no Pareto/rollup is possible without text-matching.
- `MachineOeeSnapshot` (L2305) — `totalDowntime`, availability/performance/quality percentages,
  computed and stored per machine/shift (`oee.service.ts`). Downtime is a single aggregate number;
  no breakdown-vs-planned-vs-changeover split, no link to a breakdown/work-order record.
- `GrnInvoice`/`GrnInvoiceItem` (L1838/1915) — goods receipt. **No accept/reject/QC-hold quantity
  fields at all**: `GrnInvoiceItem` has `quantity`, price/tax fields, and a raw `updateStock` boolean
  on the header that posts the full received quantity straight to stock. No sampling plan, no
  inspection result, no quarantine store, no COA-from-supplier reference, no batch/lot linkage for
  traceability.
- `Product` (L961) — item master has only `weightPerPiece`/`weightUom` and `capacityLitres` as
  quasi-spec fields, plus a free `gradeRates` Json blob. No dimensional tolerances, colour/Delta-E
  spec, MFI (melt flow index) range, shrinkage %, moisture spec, or any structured QC-parameter set;
  nothing a QC inspector could pull up as "what to check and against what limit" for a product.
- `ProductCapacityHistory` (L2397) — records `previousCapacity`/`newCapacity` per
  machine/shift/production-order with `achievementPct`; an output-rate log, not a quality record.
- `AssetClass`/`FixedAsset`/`AssetEvent` (L4679+) — this is **fixed-asset accounting** (Schedule II
  depreciation, GL posting, disposal), not plant/machine maintenance. `AssetEventKind` covers
  capitalisation/revaluation/disposal-type events, not breakdowns or PM. Confirms machines are known
  to the books but not to a CMMS.
- No models at all for: mould/die/tool master, mould-machine compatibility, mould maintenance/shot
  counters, breakdown log, work order, PM schedule, spare part, calibration register, NCR/CAPA,
  customer complaint, COA, document control, sampling plan, instrument master.

### API modules touching the domain (apps/api/src/modules/)

- `machine/` — plain CRUD (`machine.controller/service/routes/validation.ts`); no maintenance,
  no meter/run-hour tracking, no status-transition workflow beyond `isActive`/`machineStatus`.
- `production-wastage/` — create/list/approve wastage entries; doubles as the "quality rejection"
  capture point today, but with a flat enum reason and no CAPA/trend workflow.
- `hourly-production/` — captures `rejectQty`/`downtime` per hour with free-text reasons.
- `oee/` — `oee.service.ts` computes Availability/Performance/Quality/OEE from the above; a good
  foundation for a downtime-Pareto and MTBF/MTTR feature once breakdown data is structured.
- `grn-invoice/` — goods receipt; posts stock with no inspection gate.
- `assets/` — fixed-asset register/depreciation; not extensible to CMMS without a new domain.
- `product/`, `product-capacity-history/`, `bill-of-material/` — product master, no QC-parameter
  concept.
- No `quality/`, `maintenance/`, `mould/`, `calibration/`, `document-control/`, `complaint/`, `capa/`
  modules exist; none are mounted in `apps/api/src/routes/index.routes.ts`.

### Web (apps/web/src/modules, apps/web/src/features)

- `machines/` (list/form only), `production-wastage/` (`WastageCreate.tsx`), `hourly-work-reports/`,
  `daily-machine-planning/`, `dashboard/pages/OeeDashboard.tsx` +
  `dashboard/components/DashboardMachineOverview.tsx` (read-only OEE view), `product/` (basic item
  master form, no QC-parameter tab).
- No screens for inspection, NCR/CAPA, COA, calibration, PM calendar, work orders, breakdown log,
  mould register, mould history card, or a rejection-reason master admin screen.

### Permissions (packages/shared/src/permissions.ts)

- Only `oee-dashboard` (`view`, `export`, L331) touches this domain. No `quality.*`, `maintenance.*`,
  `mould.*`, `calibration.*`, `capa.*`, `machine.*`, `wastage.*` permission keys exist — `machine` and
  `production-wastage` modules are presumably gated by generic/other keys; worth confirming they are
  gated at all before extending them.

### Tests

- `apps/api/test/integration/` has **no spec file** for `machine`, `production-wastage`, `oee`,
  `hourly-production`, `grn-invoice`, or `product` (59 spec files total, none of these). This whole
  shop-floor/quality/receiving surface is currently untested at the integration level — a pre-existing
  gap the brief asked to be flagged, independent of new features.

### Quality issues observed

- `WastageType` mixes quality-rejection causes, machine-downtime causes and mould-changeover causes
  in one non-extensible enum; a real Pareto needs a tenant-editable reason master with a category
  (quality/downtime/changeover) and severity, not a Prisma enum.
- `downtimeReason`/`rejectReason`/`scrapReason` on `HourlyProduction` are free-text `VarChar(100)`
  columns — no FK to any reason master, so no reliable Pareto/trend reporting is possible without
  fuzzy text grouping.
- `GrnInvoiceItem` has zero QC fields; `updateStock` posts the full received quantity to stock with
  no inspection or quarantine step — a supplier's off-spec material can enter production stock with
  no gate.
- `Machine.machineStatus` enum (verify exact members) appears to lack a `BREAKDOWN`/`UNDER_MAINTENANCE`
  state distinct from `IDLE`, so a stopped-for-repair machine cannot be told apart from an idle one in
  planning screens.
- No integration tests for any of the modules this domain would extend (`machine`, `production-wastage`,
  `oee`, `hourly-production`, `grn-invoice`).

## 2. Gaps — proposed feature set

Ranked by value to a plastics SME owner/accountant/plant manager. Sizes: S = few days, M = 1-2 weeks,
L = 2-4+ weeks (rough, one engineer).

1. **Rejection/downtime reason master (tenant-editable)** — Rationale: replaces the hard-coded
   `WastageType` enum and free-text reason columns with a real Pareto foundation; everything else in
   this domain depends on it. Data model: `ReasonCode { id, companyId, code, name, category
(QUALITY|DOWNTIME|CHANGEOVER|MOULD), isActive }`. Endpoints: CRUD under `modules/reason-code`.
   Screens: admin list/form. Touches: `production-wastage`, `hourly-production`, `oee`. Size: S.
   Isolation: **standalone**, but blocks/feeds several items below (sequence first).

2. **Incoming inspection at GRN (accept/reject/quarantine)** — Rationale: today `GrnInvoiceItem`
   posts 100% of received qty to stock with no QC gate; off-spec raw material/masterbatch enters
   production silently. Data model: `IncomingInspection { id, companyId, grnInvoiceItemId,
sampledQty, acceptedQty, rejectedQty, quarantineQty, samplingPlanId?, result (PASS|FAIL|CONDITIONAL),
inspectedBy, inspectedAt, coaFileUrl?, remarks }`; `Store.storeCategory` gains `QUARANTINE`.
   Endpoints: `POST /api/quality/incoming-inspections`, list/get, `POST /:id/disposition`. Screens:
   inspection queue off pending GRNs, disposition form. Touches: `grn-invoice`, `store`,
   `raw-material-stock`. Size: M. Sequencing: needs reason master (#1) for rejection reasons.

3. **QC parameters per product (spec master)** — Rationale: SME needs one place to define what
   "good" means per SKU (weight, dimensions, colour, MFI, shrinkage) instead of tribal knowledge.
   Data model: `ProductQcParameter { id, companyId, productId, parameterName, uom, targetValue,
minValue, maxValue, method (VISUAL|MEASURED|INSTRUMENT), instrumentTypeId?, isCritical }`.
   Endpoints: CRUD under `modules/product-qc-parameter`, nested under product. Screens: new "QC
   Parameters" tab on `ProductForm.tsx`. Touches: `product`. Size: S. Isolation: standalone.

4. **In-process & final inspection with sampling plans** — Rationale: turns ad-hoc rejection entry
   into a structured inspection record tied to a sampling plan (e.g. AQL-style), the backbone of any
   plastics QMS. Data model: `SamplingPlan { id, companyId, name, lotSizeFrom, lotSizeTo, sampleSize,
acceptNo, rejectNo }`; `Inspection { id, companyId, type (IN_PROCESS|FINAL), productionOrderId,
machineId, shiftId, productId, samplingPlanId?, lotQty, sampleQty, result, defects
InspectionDefect[] }`; `InspectionDefect { id, inspectionId, parameterId?, reasonCodeId, qty,
severity }`. Endpoints: `modules/inspection` CRUD, `GET /api/quality/pareto`. Screens: inspection
   entry (shift-side), Pareto chart dashboard. Touches: `production-wastage` (record links to/replaces
   wastage entry), `hourly-production`, `product`. Size: L. Sequencing: needs #1 and #3.

5. **Rejection Pareto dashboard** — Rationale: owner/plant manager wants "what's costing us most"
   at a glance; currently no rollup exists across the free-text reason fields. Data model: read model
   over `ProductionWastage`/`Inspection`/`HourlyProduction` grouped by `ReasonCode`. Endpoints:
   `GET /api/quality/pareto?groupBy=reason|machine|product&range=`. Screens: new Quality dashboard
   page (mirrors `OeeDashboard.tsx`). Touches: `production-wastage`, `hourly-production`, `oee`. Size: M.
   Sequencing: needs #1.

6. **NCR (Non-Conformance Report) & CAPA workflow** — Rationale: formalises "what do we do about it"
   beyond a free-text `correctiveAction` string; ISO 9001 customers will ask for evidence of this.
   Data model: `Ncr { id, companyId, ncrNo, source (INCOMING|IN_PROCESS|FINAL|COMPLAINT), refType,
refId, description, severity, status }`; `Capa { id, companyId, ncrId?, complaintId?, rootCause,
correctiveAction, preventiveAction, ownerId, dueDate, status (OPEN|IN_PROGRESS|VERIFIED|CLOSED),
verifiedBy, verifiedAt }`. Endpoints: `modules/ncr`, `modules/capa`, with document-number series
   via `documentNumberService`. Screens: NCR list/form, CAPA board (kanban by status). Touches:
   `inspection`, `production-wastage`, future `complaint`. Size: L. Sequencing: after #4.

7. **Customer complaint → CAPA linkage** — Rationale: closes the loop from field failure back to
   root cause, a common customer audit requirement (esp. for auto-ancillary/FMCG plastics buyers).
   Data model: `CustomerComplaint { id, companyId, complaintNo, customerId, salesInvoiceId?,
productId, description, receivedDate, severity, status }`, linked 1:1/1:many to `Capa`.
   Endpoints: `modules/customer-complaint` CRUD + `POST /:id/raise-capa`. Screens: complaint list/form
   on customer detail page. Touches: `customer`, `sales-invoice`, `ncr`/`capa` (#6). Size: M.
   Sequencing: needs #6.

8. **COA (Certificate of Analysis) generation for customers** — Rationale: many plastics buyers
   (esp. export, auto, pharma-packaging) require a COA per dispatch batch; currently no document
   exists. Data model: `CertificateOfAnalysis { id, companyId, coaNo, goodsDispatchId or
salesInvoiceId, productId, batchNo, parameters Json (snapshot of ProductQcParameter + measured
values), issuedBy, issuedAt }`, numbered via `documentNumberService`. Endpoints:
   `modules/coa`, `POST /api/quality/coa/generate`, PDF render (reuse existing invoice-PDF pattern).
   Screens: "Generate COA" action from Goods Dispatch / Sales Invoice detail. Touches:
   `goods-dispatch`, `sales-invoice`, `product-qc-parameter` (#3), `inspection` (#4) for measured
   values. Size: M. Sequencing: needs #3, ideally #4.

9. **Calibration register for instruments** — Rationale: ISO 9001/IATF clause requires traceable
   calibration of measuring instruments (verniers, weighing scales, MFI testers); currently no
   instrument master exists at all. Data model: `Instrument { id, companyId, code, name, type,
location, calibrationFrequencyDays }`; `CalibrationRecord { id, companyId, instrumentId,
calibratedOn, dueOn, result (PASS|FAIL), certificateFileUrl, calibratedBy (internal/external
agency) }`. PM reminder via pg-boss (due-soon notification). Endpoints: `modules/instrument`,
   `modules/calibration`. Screens: instrument list, calibration due list/calendar. Touches: none
   existing (new domain root) — feeds #10. Size: S. Isolation: standalone.

10. **ISO 9001 document control lite** — Rationale: SME pursuing/maintaining ISO 9001 certification
    needs a controlled-document register (SOPs, work instructions, quality manual) with
    version/approval trail; currently nothing. Data model: `ControlledDocument { id, companyId,
docNo, title, category, currentVersion, ownerId, status (DRAFT|APPROVED|OBSOLETE) }`;
    `DocumentVersion { id, documentId, version, fileUrl, approvedBy, approvedAt, effectiveDate,
changeNote }`. Endpoints: `modules/document-control`. Screens: document register, version
    history, "due for review" list (pg-boss reminder by review-cycle date). Touches: none. Size: M.
    Isolation: standalone.

11. **Machine/asset master extensions for maintenance** — Rationale: `Machine` today has no
    maintenance-relevant fields; CMMS needs asset criticality, install date, warranty, tonnage
    (also needed by mould compatibility, #16). Data model: add to `Machine`: `tonnage Decimal?`,
    `installedOn Date?`, `warrantyUpto Date?`, `criticality (LOW|MEDIUM|HIGH)`,
    `runHourMeter Decimal @default(0)` (cumulative, updated from `HourlyProduction.runtimeMinutes`).
    New `MachineStatus` value `UNDER_MAINTENANCE`/`BREAKDOWN`. Endpoints: extend `machine.service.ts`.
    Screens: extend `MachineForm.tsx`. Touches: `machine`, `oee`. Size: S. Sequencing: do before
    #12-#15 (they depend on the extended fields).

12. **Breakdown log with downtime reasons** — Rationale: today "downtime" is one free-text field on
    `HourlyProduction`; a plant manager needs a proper breakdown ticket with start/end/reason/who-
    fixed-it to compute MTTR. Data model: `Breakdown { id, companyId, machineId, reportedAt,
reportedBy, reasonCodeId, description, startedAt, endedAt?, resolvedBy?, downtimeMinutes,
status (OPEN|IN_PROGRESS|RESOLVED) }`. Auto-creates/links a `WorkOrder` (#14) when resolution
    needs a technician. Endpoints: `modules/breakdown`. Screens: "Report Breakdown" quick action from
    machine list/shift board, breakdown log list. Touches: `machine`, `hourly-production` (reconcile
    `downtime` minutes), `reason-code` (#1). Size: M. Sequencing: needs #1, #11.

13. **Preventive maintenance (PM) schedules — calendar/run-hour based** — Rationale: proactive
    maintenance is the core CMMS value prop; nothing like it exists. Data model: `PmSchedule { id,
companyId, machineId or mouldId, name, basis (CALENDAR|RUN_HOURS|SHOT_COUNT), intervalDays?,
intervalHours?, intervalShots?, lastDoneAt/lastDoneMeter, nextDueAt/nextDueMeter,
checklistItems Json }`. pg-boss recurring job (`jobs/pmDue.job.ts`, one per tenant via
    `runAsTenant`) evaluates due schedules daily and creates a `WorkOrder` + notification. Endpoints:
    `modules/pm-schedule`. Screens: PM calendar view, checklist execution form. Touches: `machine`
    (#11), future `mould` (#17), `notifications`. Size: L. Sequencing: needs #11, #14; pairs with #17
    for mould-side PM.

14. **Work orders (maintenance)** — Rationale: the actual unit of maintenance work (breakdown fix,
    PM task, mould repair) needs a trackable record with labour/spares/cost, not just a log line.
    Data model: `WorkOrder { id, companyId, woNo, type (BREAKDOWN|PM|MOULD_MAINT|OTHER), machineId?,
mouldId?, breakdownId?, pmScheduleId?, assignedTo, priority, status (OPEN|IN_PROGRESS|DONE|
CLOSED), openedAt, closedAt, laborHours, partsUsed WorkOrderPart[], totalCost }`;
    `WorkOrderPart { id, workOrderId, sparePartId, qty, unitCost }`. Endpoints: `modules/work-order`.
    Screens: work order board/list, detail with parts consumption. Touches: `breakdown` (#12),
    `pm-schedule` (#13), spare parts (#15), `machine`, future `mould`. Size: L. Sequencing: needs #11;
    is the hub #12/#13/#15 plug into.

15. **Spare parts inventory link** — Rationale: maintenance without linking to stock means parts
    consumption isn't costed or reordered; plastics plants stock heater bands, thermocouples,
    hydraulic seals etc. Data model: reuse `RawMaterial`/`Store` with a new `itemType SPARE_PART`
    (or a light `SparePart { id, companyId, code, name, minStock, reorderLevel, storeId }` if
    `RawMaterial`'s GST/HSN-heavy shape is a poor fit — recommend reusing `RawMaterial` with
    `itemType` filter, since stock ledger/valuation already exists there). Endpoints: extend
    `raw-material` filters; `WorkOrderPart` posts a `RawMaterialTransaction` (issue) on save.
    Screens: parts picker inside Work Order detail; low-stock spares report. Touches: `raw-material`,
    `raw-material-transaction`, `work-order` (#14). Size: S (given reuse). Sequencing: needs #14.

16. **MTBF/MTTR reporting** — Rationale: standard maintenance KPIs an owner/manager expects next to
    OEE; currently no downtime is structured enough to compute them. Data model: none new — computed
    from `Breakdown` (#12) + `Machine.runHourMeter`/production hours. Endpoints: `GET
/api/maintenance/mtbf-mttr?machineId=&range=`. Screens: card on `OeeDashboard.tsx` or new
    Maintenance dashboard. Touches: `breakdown` (#12), `oee`. Size: S. Sequencing: needs #12.

17. **Mould/die master (cavities, cycle time, shot life, ownership, location)** — Rationale: the
    single highest-value missing entity for an injection/blow moulding SME — moulds are a distinct,
    high-value, trackable asset today folded invisibly into `MOULD_CHANGE` wastage reason. Data
    model: `Mould { id, companyId, mouldCode, name, productId? (FK to primary product it makes),
cavities Int, cycleTimeSeconds Decimal, shotLifeRated Long (design shot life), shotLifeUsed Long
@default(0), ownership (OWN|CUSTOMER_OWNED|JOB_WORK), customerId? (FK when customer-owned),
tonnageMin/tonnageMax Decimal (machine compatibility range), currentLocation (IN_STORE|
ON_MACHINE|AT_VENDOR_FOR_REPAIR), currentMachineId?, status (ACTIVE|UNDER_REPAIR|RETIRED),
weight/dimensions }`. Endpoints: `modules/mould` CRUD. Screens: mould register list/form.
    Touches: `product`, `customer`, `machine`. Size: M. Isolation: mostly **standalone**; feeds
    everything below.

18. **Shot counter from production records** — Rationale: `shotLifeUsed` must auto-increment from
    actual production, not manual entry, or the register goes stale immediately. Data model: add
    `mouldId` FK to `HourlyProduction` (and/or `ProductionWastage`); a trigger/service increments
    `Mould.shotLifeUsed` by `qtyProduced / cavities`-equivalent shots on each hourly record save (or
    a nightly pg-boss reconciliation job for correctness). Endpoints: none new; extend
    `hourly-production.service.ts`. Screens: shot count/remaining-life shown on mould detail page.
    Touches: `hourly-production`, `mould` (#17). Size: S. Sequencing: needs #17.

19. **Mould maintenance/cleaning schedule** — Rationale: mould-side PM (cleaning, greasing, vent
    cleaning) is distinct from machine PM and usually shot-count-triggered. Data model: reuse
    `PmSchedule` (#13) with `mouldId` populated and `basis = SHOT_COUNT`. Endpoints: none new (reuse
    #13's). Screens: mould-filtered PM calendar. Touches: `pm-schedule` (#13), `mould` (#17). Size:
    S. Sequencing: needs #13 and #17.

20. **Mould-to-machine compatibility (tonnage) check** — Rationale: prevents planners from
    scheduling a mould on a machine whose tonnage/platen size can't take it — a real shop-floor
    error today with no guard-rail. Data model: uses `Mould.tonnageMin/Max` (#17) vs new
    `Machine.tonnage` (#11); a `MouldMachineCompatibility { mouldId, machineId, isPreferred }`
    override table for exceptions (e.g. tie-bar spacing beyond tonnage). Endpoints: validation hook
    in `daily-production-plan`/`weekly-machine-program` create/update. Screens: warning banner in
    `DailyPlanCreate.tsx`/`WeeklyMachineScheduleEdit.tsx` when mould/machine mismatch. Touches:
    `daily-production-plan`, `weekly-machine-program`, `mould` (#17), `machine` (#11). Size: S.
    Sequencing: needs #11, #17.

21. **Mould change log** — Rationale: today `MOULD_CHANGE` is only a wastage _reason_, not an event
    with who/when/which-mould/how-long (changeover time is itself a cost the owner wants to reduce).
    Data model: `MouldChangeLog { id, companyId, machineId, outgoingMouldId?, incomingMouldId,
startedAt, endedAt, changedBy, downtimeMinutes, productionOrderId? }`. Endpoints:
    `modules/mould-change-log`. Screens: quick-log action from shift execution board, changeover
    time report. Touches: `mould` (#17), `machine`, `shift-execution`, `reason-code` (#1, category
    CHANGEOVER). Size: S. Sequencing: needs #17.

22. **Mould history card** — Rationale: a single "life story" view per mould (production runs, shot
    count trend, maintenance events, repairs, changeovers) is the standard mould-room document buyers
    and auditors ask to see. Data model: no new table — a read/aggregation endpoint over `Mould`
    (#17) + `HourlyProduction`/shot data (#18) + `WorkOrder` (#14, `mouldId` filter) +
    `MouldChangeLog` (#21). Endpoints: `GET /api/moulds/:id/history-card`. Screens: mould detail
    "History" tab, printable card. Touches: #17, #18, #14, #21. Size: M. Sequencing: last — needs
    #14, #17, #18, #21.

23. **Customer-owned mould register (job work)** — Rationale: job-work SMEs routinely run customer-
    supplied moulds and must account for them separately from owned assets (no depreciation, but
    location/condition tracking and return obligations matter, and disputes over mould condition are
    common). Data model: reuse `Mould.ownership = CUSTOMER_OWNED` + `customerId` (#17); add
    `MouldReturnableChallan { id, companyId, mouldId, customerId, direction (RECEIVED|RETURNED),
challanNo, date, conditionNotes }` mirroring the existing job-work challan pattern. Endpoints:
    `modules/mould` filter by ownership; `modules/mould-returnable-challan`. Screens: "Customer-owned
    Moulds" filtered list, receive/return challan form (reuse `job-work` challan UI pattern).
    Touches: `mould` (#17), `job-work`, `customer`. Size: S. Sequencing: needs #17.

24. **Machine downtime state machine (IDLE/RUNNING/BREAKDOWN/UNDER_MAINTENANCE/CHANGEOVER)** —
    Rationale: today `Machine.machineStatus` and shift-board views can't distinguish "stopped for
    repair" from "idle/no plan," which breaks planning and OEE attribution. Data model: extend
    `MachineStatus` enum; status transitions driven by `Breakdown` (#12) open/close and
    `MouldChangeLog` (#21) start/end. Endpoints: status-transition guard in `machine.service.ts`.
    Screens: colour-coded status on `DashboardMachineOverview.tsx`/`ShiftExecutionBoard.tsx`. Touches:
    `machine`, `breakdown` (#12), `mould-change-log` (#21). Size: S. Sequencing: needs #12, #21.

25. **Quality cost dashboard (COPQ)** — Rationale: ties QC data to money — owner/accountant-level
    view of cost of poor quality (scrap value + rework labour + customer returns) that the ERP
    already half-computes via `ProductionWastage.estimatedValue`/`costing`. Data model: none new —
    aggregation across `ProductionWastage`, `Inspection` (#4), `CustomerComplaint` (#7),
    `costing`/`ProductCostSheet`. Endpoints: `GET /api/quality/copq?range=`. Screens: new
    dashboard card/page. Touches: #4, #7, `costing`, `production-wastage`. Size: M. Sequencing:
    needs #4 and #7 (do last).

26. **Instrument/gauge check on shift start (poka-yoke lite)** — Rationale: cheap guard-rail so
    operators can't log measurements from an overdue-calibration instrument. Data model: none new —
    validation in `inspection.service.ts` checks `CalibrationRecord.dueOn` (#9) before accepting a
    measured-parameter entry. Endpoints: validation only. Screens: warning in inspection entry form.
    Touches: #4, #9. Size: S. Sequencing: needs #4, #9.

## 3. Isolation vs sequencing

**Buildable standalone (no/minimal cross-domain deps), good starting points:**

- #1 Reason-code master
- #3 QC parameters per product
- #9 Calibration register
- #10 Document control lite
- #11 Machine/asset master extensions
- #17 Mould/die master

**Need sequencing (depend on the standalone items above, roughly in this order):**

1. #1, #3, #9, #10, #11, #17 (foundations, any order, mostly parallel)
2. #2 Incoming inspection (needs #1), #12 Breakdown log (needs #1, #11), #18 Shot counter (needs #17)
3. #4 In-process/final inspection (needs #1, #3), #13 PM schedules (needs #11, #14 — see below),
   #19 Mould maintenance schedule (needs #13, #17), #20 Mould-machine compatibility (needs #11, #17),
   #21 Mould change log (needs #17)
4. #14 Work orders (needs #11; is itself a hub for #12, #13, #15) — note #13 and #14 have a
   circular-looking dependency in the write-up above; recommend building a minimal #14 (work order
   shell) before #13 so PM can create work orders into it, then iterate
5. #5 Pareto dashboard (needs #1), #6 NCR/CAPA (needs #4), #15 Spare parts link (needs #14),
   #16 MTBF/MTTR (needs #12), #24 Machine downtime state machine (needs #12, #21)
6. #7 Complaint→CAPA (needs #6), #8 COA generation (needs #3, ideally #4), #22 Mould history card
   (needs #14, #17, #18, #21), #23 Customer-owned mould register (needs #17)
7. #25 COPQ dashboard (needs #4, #7), #26 Calibration guard-rail (needs #4, #9)

Recommended build order for a plastics SME's highest-value wins first: #17 (mould master) and #1
(reason master) immediately unlock #21 (mould change log) and #5 (Pareto) with small effort; #11
(machine extensions) + #12 (breakdown log) unlock #16 (MTTR) cheaply; #2 (incoming inspection) closes
the biggest real risk (off-spec material entering stock unchecked).
