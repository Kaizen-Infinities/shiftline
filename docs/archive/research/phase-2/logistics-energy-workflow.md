Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Domains: Logistics & Gate · Energy & Utilities · Approvals/Workflow/Alerts

## 1. Inventory

### A. Logistics & gate

**Prisma models**

- `GoodsDispatch` / `GoodsDispatchItem` (schema.prisma:1426-1524) — outward dispatch header with
  `vehicleNumber`, `driverName`, `driverMobile`, `transportName`, `loadingTime`, two-step
  `status` workflow (`PENDING_GATE_APPROVAL` → gate approved → store received), free-text
  `destinationStoreId`. No inbound/gate-entry counterpart, no gate-pass concept, no weight
  fields, no link to a `Vehicle`/`Transporter` master (vehicle/driver are plain strings, so no
  history, no repeat-trip reuse).
- `Transporter` (schema.prisma:3854) — code/name/`transporterId` (GSTIN-linked e-way bill id)/
  phone/email only. No vehicle list, no route, no freight rate, no billing relationship.
- `EwayBill` / `ConsolidatedEwayBill` (schema.prisma:3874-3945) — full e-way bill lifecycle
  (Part A/B, extend, cancel, consolidated trip sheet), vehicle number lives only inside this
  document's `vehicleNo` field, not on a master.
- `GrnInvoice` / `GrnInvoiceItem` / `GrnInvoicePayment` (schema.prisma:1838-1963) — inbound
  goods receipt against a PO/supplier invoice; `challanNo`, `transport` (free text), `eWayBill`
  (free text string, not FK to `EwayBill`), `invoiceImage`. No gate-in event, no weighbridge
  link, no driver/vehicle capture on the receiving side at all.
- No `Vehicle`, `WeighbridgeSlip`, `LorryReceipt`/`LR`, `FreightBill`, `ReturnablePackaging`,
  `GatePass`, `DeliveryProof`/POD model anywhere in the 5.7k-line schema (grepped).

**API modules**

- `apps/api/src/modules/goods-dispatch/*` — CRUD + `gate-approve`/`store-receive` actions
  (goods-dispatch.controller.ts, .service.ts 608 lines, .routes.ts). Tenant-scoped via
  `lib/prisma.ts` as usual.
- `apps/api/src/modules/eway-bill/*` — `eway-bill.service.ts` (584 lines, IRN-linked and
  standalone generation, Part B update, extend, cancel), `transporter.service.ts` (77 lines,
  thin CRUD), providers under `eway-bill/providers/` behind an `EwayBillProvider` interface
  (per CLAUDE.md convention).
- `apps/api/src/modules/grn-invoice/*` — `grn-invoice.service.ts` is large (1429 lines): GRN
  creation with GST calc, stock posting, purchase-return linkage, payments. No weighbridge or
  gate step.
- `apps/api/src/modules/mobile/*` — this is a **sales field-agent app** (WatermelonDB sync,
  `mobile.visit.service.ts`, `mobile.collection.service.ts`, `mobile.order.service.ts`), not a
  dispatch/driver app. `mobile.attachment.service.ts` handles photo uploads for
  `CASH_RECEIPT`/`CHEQUE_FRONT`/`CHEQUE_BACK`/`UPI_SCREENSHOT` — the attachment infrastructure
  (`mobile.attachment.service.ts`, `ATTACHMENT_KINDS` in `mobile.types.ts`) is reusable for POD
  photos but no POD kind exists and no driver role is modelled.

**Web**

- `apps/web/src/modules/goods-dispatch/pages/GoodsDispatchGateApproval.tsx` and
  `GoodsDispatchStoreApproval.tsx` — the only two-stage approval screen pair in the product;
  worth reusing as the template for the generic approval matrix (Domain C).
- No weighbridge, LR, freight, or packaging-tracking screens found under `apps/web/src/modules`
  or `apps/web/src/features`.

**Permissions**: `goods-dispatch` (view/create/edit/delete/export), `eway-bill`
(view/generate/update/cancel), `transporters` (view/create/edit/delete) in
`packages/shared/src/permissions.ts`. No `grn-invoice`, `weighbridge`, `freight`, or
`packaging` permission module keys yet (GRN likely rides on `purchase-order`/`inventory` keys —
verify before adding a new one; don't duplicate).

**Quality issues**

- No integration test file for goods-dispatch or GRN at all (`apps/api/test/integration/` has
  `eway-bill.spec.ts` and `mobile.spec.ts` but nothing named `goods-dispatch.spec.ts` or
  `grn-invoice.spec.ts`; goods-dispatch is only touched incidentally inside other specs).
- `GrnInvoice.eWayBill` and `.transport` are free-text strings, not linked to the real
  `EwayBill`/`Transporter` rows — a manual-entry drift risk and a gap for a proper e-way-bill
  reconciliation report.
- `GoodsDispatch.vehicleNumber`/`driverName` are plain strings with no master — the same
  driver/vehicle gets retyped every dispatch, no way to see "all dispatches for vehicle X" or
  catch a suspended driver.
- `GoodsDispatch.destinationStoreId` is a raw `String?`, not validated against `Store` the way
  other code refers to stores (`byCode`), per CLAUDE.md conventions — worth flagging to whoever
  owns that module, not this domain's job to fix.

### B. Energy & utilities

- **No model, module, screen, or permission exists for power/energy at all.** Confirmed by
  grepping the schema for `Meter`, `Electricity`, `Power`, `DG`, `Energy` — zero hits outside
  unrelated matches. `Machine` (schema.prisma:1145) has no power-rating or meter fields.
- The closest existing hooks: `MachineOeeSnapshot` (schema.prisma:2305) already aggregates
  per-machine-per-shift `plannedRunTime`/`actualRunTime`/`totalDowntime`/`goodQty` — the natural
  place to add a parallel per-shift energy reading rather than inventing a separate cadence.
  `apps/api/src/modules/oee/` computes these snapshots.
- `costing.service.ts` `buildCostSheet()` (costing.service.ts:294-360) takes `overheadCost` as a
  **manual number typed in per period** — this is exactly where a computed power cost per
  kg/period should feed in instead of being typed by hand; today there is no automated source
  for it.
- No `ElectricityBill`, `DG log`, or water tracking anywhere.

### C. Approvals, workflow engine & notifications

- `docs/specs/P1-04-approval-gates.md` — the only formal approval-gates spec, scoped
  deliberately narrow: **filings only** (`FilingApproval` model, DRAFT→PENDING→APPROVED→
  SUBMITTED/REJECTED, `filingApprovalService`, `/api/filings/approvals`,
  `apps/web/src/modules/compliance/pages/FilingApprovalsPage.tsx` +
  `ApprovalPanel.tsx` reusable component). Explicitly **out of scope**: "amount thresholds and
  multi-level approval; approval of documents other than filings." That gap is exactly what
  this domain should fill generically.
- `GoodsDispatch` has its own bespoke two-step approval (`gate-approve`/`store-receive`) baked
  into the goods-dispatch service/status enum rather than using a shared engine — a second,
  independent, non-reusable approval pattern already exists in the codebase, evidence a generic
  engine is overdue before a third domain reinvents it.
- `apps/api/src/modules/expense/` (per CLAUDE.md, "expense claims keep their own flow from
  P1-10d") is a third bespoke approval flow — not inspected in depth here, but its existence is
  further evidence of duplicated approval logic across modules.
- **Notifications module** (`apps/api/src/modules/notifications/`): `notify.ts` (78 lines) is a
  solid, reusable producer — `notify({ category, title, body, link, level, to })` where `to` is
  `{userIds}` / `{permission}` / `{all, exclude}`; writes `Notification` rows and emits
  `notification:created` via `lib/realtime.ts` `emitToUser`. `notifications.service.ts` (list,
  markRead, markAllRead) + `notifications.controller.ts`/`.routes.ts` back the bell UI
  (`apps/web/src/components/common/notifications/NotificationBell.tsx`,
  `useNotifications.ts`, `apps/web/src/modules/notifications/pages/NotificationsPage.tsx`,
  `apps/web/src/services/notificationsService.ts`). This is in-app only — no WhatsApp/SMS/email
  fan-out from `notify()` itself.
- **SMS** (`apps/api/src/modules/sms/sms.service.ts`): mature — DLT-compliant templates
  (`smsTemplateSchema`, category TRANSACTIONAL/SERVICE_IMPLICIT/SERVICE_EXPLICIT/PROMOTIONAL),
  encrypted credentials, provider abstraction (`sms/providers/`), daily cap. Ready to be a
  channel for alerts/nudges.
- **WhatsApp** (`apps/api/src/modules/whatsappservice/whatsapp.service.ts`): works
  (`WhatsappService.sendTextMessage` via Meta Graph API, encrypted `WhatsappConfig` per
  tenant) but is thinner than SMS — no template/category system, no send-log model visible in
  this pass, static methods rather than instance/provider abstraction. Worth noting as a
  smaller-quality module than SMS when building the alert fan-out on top of it.
- **Email** (`apps/api/src/modules/email-config/`, `apps/api/src/utils/mailer.ts`): nodemailer
  SMTP, per-tenant config, encrypted password, `sendEmail()`/`sendEmailWithAttachment()`. Note:
  `email-config.controller.ts` does `prisma.emailConfig.findFirst()` with no `where` — relies
  entirely on RLS/tenant middleware for scoping; works but is a thinner pattern than the
  `byCode`/explicit-`companyId` convention CLAUDE.md asks for elsewhere — flag, don't fix here.
- **pg-boss / jobs** (`apps/api/src/lib/jobs.ts`, `apps/api/src/jobs/*`): well-established
  fan-out pattern already used for threshold-style daily nudges —
  `compliance.job.ts`/`compliance.service.ts` `warnUpcoming()`/`sweepAllTenants()` (P1-13d) is
  the best template to copy: iterate active tenants under `runAsTenant`, compute a "due" list,
  de-duplicate by checking for an existing `Notification` with the same `link` before sending,
  call `notify()`. Similar patterns: `msme.job.ts` (P1-07, supplier payment clock),
  `ims.job.ts` (P1-13c), `job-work.job.ts` (P1-14 return deadline), `eway-bill.job.ts` (P1-12
  expiry warning). **No generic threshold/alert-rule engine** — each of these is a bespoke,
  hand-coded sweep; a config-driven alert-rules engine (stock/receivable/rejection%/downtime/
  cash) would replace the need to hand-write a new job per metric.
- `dashboard.tv.service.ts` (`apps/api/src/modules/dashboard/dashboard.tv.service.ts:321-340`)
  already computes CRITICAL/LOW stock buckets from `reorderLevel` for a TV wall display — logic
  to reuse/generalise for a stock-below-reorder alert rule rather than re-deriving it.
- No `ApprovalMatrix`/`ApprovalChain`/`Delegation`/`AlertRule` model, no daily-digest job, no
  approval inbox screen (only the filings-specific `FilingApprovalsPage`).

## 2. Gap proposals (ranked)

### Logistics & gate

1. **Vehicle & driver master** — stop retyping vehicle/driver strings on every dispatch/GRN;
   enables blacklists, RC/insurance/licence expiry tracking. Model: `Vehicle` (regNo, type,
   capacityTons, ownerType OWN/HIRED, transporterId?, rcExpiry, insuranceExpiry, permitExpiry,
   isActive), `Driver` (name, licenceNo, licenceExpiry, mobile, transporterId?). Endpoints:
   `/api/vehicles`, `/api/drivers` CRUD. Touches: goods-dispatch, eway-bill, GRN (switch their
   string fields to FKs, keep the string as a fallback for ad-hoc vehicles). Screens: masters
   list pages. Size: S. Isolated — no cross-domain deps, do first.
2. **Gate entry/exit register (inward + outward)** — the actual gate book every plant keeps;
   currently only outward `GoodsDispatch` exists and only after the fact, no true gate log, no
   inward gate-in event, no non-material gate passes (visitor/vehicle-only movements, returnable
   material without invoice). Model: `GateEntry` (direction IN/OUT, vehicleId?, driverName,
   purpose DELIVERY/DISPATCH/RETURNABLE_OUT/RETURNABLE_IN/VISITOR/OTHER, refDocType/refDocId
   nullable link to GRN/GoodsDispatch/JobWork, gateInAt, gateOutAt, securityGuardId, remarks,
   status). Endpoints: `/api/gate-entries` CRUD + `/check-in` `/check-out`. Screens: Gate
   register list + a kiosk-style quick-entry form for the security desk. Size: M. Needs vehicle
   master (#1) first for full value, but works standalone with free-text fallback.
3. **Weighbridge slip (gross/tare/net)** — plastics/recycling inbound material and scrap outward
   are commonly weighed; today weight isn't captured anywhere on GRN or dispatch. Model:
   `WeighbridgeSlip` (slipNo, vehicleId, grossWeight, tareWeight, netWeight, weighedAt,
   weighedBy, docType GRN/DISPATCH/JOB_WORK, docRef, photo). Endpoints:
   `/api/weighbridge-slips`. Touches: `GrnInvoice` (add optional link + net-weight-vs-invoice-qty
   variance flag), `GoodsDispatch` (same). Screens: weighbridge entry screen, variance report.
   Size: M. Needs #1/#2 loosely; can ship independently linked only by docRef.
4. **Gate pass for returnable/non-returnable material** — legally distinct from a sale (no GST
   document), used constantly for moulds sent for repair, tools sent to job-workers,
   demo/sample material, empty-container returns. Model: `GatePass` (passNo, type
   RETURNABLE/NON_RETURNABLE, direction OUT/IN, partyId (customer/supplier), itemDescription,
   qty, expectedReturnDate, returnedAt?, linkedGateEntryId, status OPEN/RETURNED/OVERDUE).
   Endpoints: `/api/gate-passes`, `/return`. Screens: gate-pass register + overdue list. Touches:
   job-work module (job-work-out already has its own return-deadline job — reuse the pattern,
   don't duplicate). Size: M.
5. **Vehicle/transporter freight-rate master by route** — needed to auto-price freight and
   compare quoted vs billed. Model: `FreightRate` (transporterId, fromPincode/City,
   toPincode/City, vehicleType, ratePerKm or ratePerTon or flatRate, effectiveFrom/To). Endpoints:
   `/api/freight-rates`. Touches: `Transporter`. Screens: rate card under transporter master.
   Size: S. Isolated.
6. **Freight bill & LR (lorry receipt) tracking** — inbound freight is a real, GST-bearing (RCM
   on GTA) cost that today has nowhere to live except a generic expense row. Model: `LorryReceipt`
   (lrNo, lrDate, transporterId, vehicleId, fromPlace, toPlace, consignor, consignee, goodsDesc,
   weight, freightAmount, paidBy CONSIGNOR/CONSIGNEE, linkedDocType/DocRef), `FreightBill`
   (billNo, transporterId, period, lrIds[], amount, gstApplicable, rcmApplicable, status,
   linkedExpenseId/voucherId). Endpoints: `/api/lorry-receipts`, `/api/freight-bills`. Touches:
   `expense` module or a new voucher type, RCM ledger (per CLAUDE.md `RCM-*` handling already
   exists for e-invoice reverse charge — reuse that convention). Screens: LR register, freight
   bill list with GST/RCM flag. Size: L. Needs #1 and ideally #5; sequence after those and after
   confirming RCM posting convention with the accounts/GST domain researcher.
7. **Delivery proof (POD) capture from mobile** — today the "mobile" app is sales-only; there is
   no driver-facing app or POD step, so dispatched goods have no signed proof of delivery. Model:
   extend `GoodsDispatch` with `podReceivedAt`, `podSignatoryName`, `podPhotoUrl`,
   `podRemarks`; reuse `mobile.attachment.service.ts` infra, add `POD_PHOTO`/`POD_SIGNATURE` to
   `ATTACHMENT_KINDS`. Endpoints: `/api/mobile/dispatches/:id/pod` (device-facing, append-only
   per the existing conflict policy). Screens: web dispatch detail shows POD; a lightweight
   driver view in the existing mobile app (or a new minimal driver role) to capture it. Touches:
   `mobile` module (needs a driver/device role — currently only sales-agent devices exist),
   `goods-dispatch`. Size: L — the mobile-side driver role/screen is the expensive part.
8. **Returnable packaging (crates, pallets, bags) ledger by customer** — plastics/FMCG-adjacent
   suppliers commonly lend/borrow crates and pallets; without a ledger, disputes over "how many
   crates does customer X owe us" are common and currently untracked. Model:
   `PackagingType` (code, name, unit), `PackagingLedgerEntry` (partyId, packagingTypeId,
   direction OUT/IN, qty, docType (linked to GoodsDispatch/GRN or standalone), date, balance
   running total per party+type). Endpoints: `/api/packaging-ledger`, balance report. Screens:
   packaging balance-by-customer report, entry screen. Size: M. Isolated (only loosely touches
   dispatch/GRN for linking, works standalone via manual entries too).
9. **Dispatch planning board** — a Kanban/calendar view of what's due to ship vs what vehicles
   are booked; currently dispatch is created ad hoc with no forward planning surface. Model: no
   new core model — a read view over `SalesOrder`/`ProductionOrder` due dates +
   `GoodsDispatch` + `Vehicle` bookings; optionally a light `DispatchPlan` row (date, vehicleId,
   plannedOrderIds[]) if the team wants to save a plan rather than compute it live. Endpoints:
   `/api/dispatch-planning/board`. Screens: new board page. Size: M. Needs #1 and sales-order
   due-date data; sequence after core masters exist.
10. **GRN ↔ e-way-bill / transporter reconciliation** — fix the existing data-quality gap: link
    `GrnInvoice.eWayBill`/`.transport` free-text to real `EwayBill`/`Transporter` rows instead of
    duplicating as strings; add a report of GRNs whose declared e-way bill doesn't match one on
    file. Touches: `grn-invoice`, `eway-bill`. Size: S. Isolated, low-risk cleanup with high audit
    value.
11. **Vehicle/driver document-expiry alerts** (RC, insurance, permit, driving licence) — feeds
    the alert-rules engine (Domain C, item below) once #1 exists. Size: S once #1 and the alert
    engine both exist; do last.

### Energy & utilities

12. **Machine power-rating master fields** — connected load (kW), rated voltage/phase, whether
    on grid/DG-capable — the prerequisite for any consumption-per-unit math. Add to `Machine`:
    `ratedPowerKw Decimal?`, `powerSource GRID/DG/BOTH`. Size: S. Isolated, do first.
13. **Shift-wise power meter reading capture** — the core feature: manual (later IoT) meter
    readings per machine (or per sub-meter/panel) per shift, mirroring how `HourlyProduction`/
    `MachineOeeSnapshot` already capture shift-wise production. Model: `PowerReading`
    (machineId? or `MeterId` if metering is per-panel not per-machine, shiftId, productionDate,
    readingType GRID/DG, openingUnits, closingUnits, unitsConsumed (computed), recordedBy,
    source MANUAL/IOT). Consider a `Meter` master (code, location, feedsMachineIds[]) since one
    meter often feeds several machines — don't force 1:1 with `Machine`. Endpoints:
    `/api/power-readings`, `/api/meters`. Screens: shift-end power-reading entry form (same
    operator flow as hourly production entry), consumption-by-machine report. Touches: `shift`,
    `machine`, `oee` (natural to show alongside OEE). Size: M. Sequence after #12.
14. **DG vs grid split & DG running-hours/fuel log** — DG power costs far more per unit (diesel)
    and SMEs need the blended cost; also DG hours feed maintenance scheduling. Model:
    `DgRunLog` (dgSetId or just a company-level asset ref via `Asset` module which already
    exists, startAt, endAt, fuelConsumedLitres, unitsGenerated). Endpoints:
    `/api/dg-runs`. Touches: `assets` module (DG set can be an `Asset` row — check before adding
    a new master). Size: M.
15. **Electricity bill tracking & reconciliation** — capture the monthly DISCOM bill (units
    billed, demand charges, fixed charges, penalties, subsidy) and reconcile against the sum of
    shift-wise readings to catch meter/theft/estimation discrepancies. Model: `ElectricityBill`
    (billMonth, connectionNo, unitsBilled, demandKva, fixedCharges, energyCharges, taxes,
    penalties, totalAmount, dueDate, paidVoucherId?). Endpoints: `/api/electricity-bills`.
    Touches: `expense`/voucher posting, `banking` for payment. Screens: bill entry + variance
    vs metered consumption. Size: M. Needs #13 for the variance report; the bill-only capture
    can ship alone (S) first.
16. **Unit cost per kg produced (energy) feeding costing** — the payoff feature: compute
    Rs/kWh (blended grid+DG) for the period and Rs/kg by dividing period consumption by period
    output, then feed it into `costing.service.ts buildCostSheet()`'s `overheadCost` instead of
    a manual number. Endpoints: extend costing service with an `energyOverhead(periodKey,
productId?)` helper; no new model, computed from #13/#15. Touches: `costing` module
    directly — coordinate with whoever owns costing/accounts domain. Size: M. Must sequence
    after #13 (and ideally #15); highest business value of this group (owner-visible Rs/kg cost
    that today nobody can compute).
17. **Water consumption tracking** — cooling towers, chillers (injection moulding) and washing
    lines (recycling) use meaningful water; simpler than power (single meter usually). Model:
    `WaterReading` mirroring `PowerReading` but simpler (dailyOpeningUnits/closingUnits, no
    grid/DG split). Endpoints: `/api/water-readings`. Size: S. Isolated, lower priority than
    power; do after #13 if time permits since the pattern is identical.

### Approvals workflow engine & notifications

18. **Generic approval matrix (doc type × amount threshold × role chain)** — the highest-value
    item in this whole report: replaces the three independent hand-built approval flows already
    in the codebase (`FilingApproval`, goods-dispatch's gate/store status fields, expense's own
    flow) with one configurable engine so the next ten document types (PO, freight bill, GRN
    over-value, packaging write-off, etc.) don't each reinvent it. Model: `ApprovalRule`
    (docType, minAmount, maxAmount?, businessPlaceId?, chain: ordered array of
    {roleId or specific userId, level}, requireAllOrAny), `ApprovalRequest` (docType, docRef,
    amount, status PENDING/APPROVED/REJECTED, currentLevel, history[] audited-by-trigger like
    `FilingApproval`), `ApprovalAction` (requestId, level, actorId, decision, comment, actedAt).
    Endpoints: `/api/approval-rules` CRUD (admin), `/api/approval-requests` list/`:id`/
    `approve`/`reject`/`delegate`. Reuse `ApprovalPanel.tsx` as the base component; genericise it
    to take a docType prop. Touches: eventually every module with a "send for approval" step —
    start by wiring goods-dispatch's existing gate/store approval onto it as the pilot migration
    (proves the engine before other modules adopt it), keep `FilingApproval` as-is (P1-04
    explicitly scoped it out, don't retrofit it in the same PR). Size: L. Foundational —
    sequence early since items 19-21 depend on the request/notification shape it establishes,
    but it can be built and tested in isolation first (own tables, own routes) before other
    modules are migrated onto it.
19. **Delegation** — "I'm on leave, route my approvals to X for N days." Model: `Delegation`
    (delegatorUserId, delegateUserId, fromDate, toDate, scope: all or specific docTypes,
    isActive). `approvalService.pendingFor(userId)` checks active delegations. Endpoints:
    `/api/delegations` CRUD. Touches: #18 only. Size: S. Sequence after #18.
20. **Approval inbox screen** — one place to see everything waiting on you (filings + the new
    generic approvals), instead of hunting per module. Screens:
    `apps/web/src/modules/approvals/pages/ApprovalInboxPage.tsx` pulling from both
    `/api/filings/approvals?status=PENDING&assignee=me` and
    `/api/approval-requests?status=PENDING`. Size: S once #18 exists (mostly a filtered list +
    the existing `ApprovalPanel`). Sequence after #18.
21. **WhatsApp/SMS/email approval nudges** — today `notify()` only writes an in-app row; a
    pending approval sitting unread for 2 days is a common SME pain point. Extend `notify()`
    (or add a sibling `notifyExternal()`) so high-priority notifications (approval pending > X
    hours) also fan out through the existing `sms.service.ts`/`whatsapp.service.ts`/`mailer.ts`
    channels, gated by a per-user notification-preference row (`NotificationPreference`:
    userId, category, channels[]). Endpoints: extend `/api/notifications` with a preferences
    sub-resource. Touches: `notifications`, `sms`, `whatsappservice`, `email-config`. Size: M.
    Depends on #18 for the approval-specific trigger but the channel plumbing itself
    (preferences + fan-out) is independently useful for #22/#23 too — worth building the fan-out
    as a standalone `notifyExternal()` utility first, then wire approvals into it.
22. **Alert rules engine (threshold-based)** — generalises the five bespoke pg-boss sweeps that
    already exist (`compliance.job.ts`, `msme.job.ts`, `ims.job.ts`, `job-work.job.ts`,
    `eway-bill.job.ts`) into one configurable engine so stock-below-reorder, receivable-overdue,
    rejection-%-over-X, machine-down-over-N-minutes and cash-below-X don't each need a
    hand-written job. Model: `AlertRule` (metricKey enum: STOCK_BELOW_REORDER /
    RECEIVABLE_OVERDUE / REJECTION_PCT / MACHINE_DOWNTIME / CASH_BALANCE, comparator, threshold,
    scope (storeId/machineId/customerId or company-wide), channels[], cooldownMinutes to avoid
    repeat spam — the compliance job's "check for an existing Notification with this link"
    trick generalises well here), `AlertEvent` (ruleId, firedAt, value, resolvedAt?). New queue
    `QUEUES.ALERT_RULES_SWEEP` in `lib/jobs.ts`, handler in `src/jobs/alert-rules.job.ts`
    following the `runAsTenant` fan-out pattern from `compliance.job.ts`. Metric sources: reuse
    `dashboard.tv.service.ts`'s reorder-bucket logic for stock, `accounts/ageing.ts` for
    receivables, `production-wastage`/OEE for rejection %, `MachineOeeSnapshot.totalDowntime`
    (note: today only a shift-end aggregate — true "down for N minutes right now" needs a
    live downtime-start event, which doesn't exist; either add one to the OEE/shift-execution
    module or scope this alert to "downtime exceeded N minutes in the shift so far" using the
    existing aggregate), `banking`/petty-cash for cash balance. Endpoints:
    `/api/alert-rules` CRUD, `/api/alert-events`. Screens: alert-rules admin page, alert history
    list. Size: L. Depends on #21's fan-out utility for multi-channel delivery; can be built and
    tested against in-app notifications alone first, then wired to #21.
23. **Owner daily digest job (WhatsApp/email)** — one evening message summarising the day
    (production vs plan, dispatches, collections, cash position, pending approvals, any alerts
    fired) — a strong differentiator for an owner who doesn't log into a dashboard. New queue
    `QUEUES.OWNER_DIGEST`, daily handler (`src/jobs/owner-digest.job.ts`) following the
    `runAsTenant` fan-out pattern, pulling summary numbers from `dashboard`/`insights` modules
    (`apps/api/src/modules/dashboard/`, `apps/api/src/modules/insights/` already exist and likely
    have most of the aggregation queries needed). Sends via `whatsappservice`/`mailer` to the
    company owner's contact (need an "owner recipient" concept — check `Company`/`User` for an
    existing owner flag before adding one). Size: M. Depends on #21's fan-out utility; the
    summary-query part can be prototyped independently by reusing `dashboard`/`insights`.

## 3. Isolation vs sequencing

**Buildable in isolation (few cross-domain deps):**
1 (vehicle/driver master), 5 (freight rates), 10 (GRN/e-way-bill reconciliation), 12 (machine
power fields), 17 (water readings, after 13's pattern exists), 19 (delegation, needs only 18's
tables), the fan-out/preferences plumbing half of 21, the metric-source-agnostic core of 22
(rule CRUD + sweep scaffolding, testable against in-app notifications alone).

**Need sequencing:**

- 2, 3, 4, 6, 9, 11 build on #1 (vehicle/driver master) — do #1 first.
- 7 (POD) needs a driver-facing mobile role that doesn't exist yet in the `mobile` module —
  coordinate with whoever owns mobile/field-app roadmap before sizing it as L.
- 13 → 14/15 → 16 is a strict chain (readings before bills before blended-cost-into-costing);
  16 also needs sign-off from whoever owns `costing.service.ts`.
- 18 (approval matrix) is foundational for 19, 20, and the approval-trigger half of 21/22/23 —
  build and test it standalone first (own tables/routes), then migrate goods-dispatch's
  existing bespoke gate/store approval onto it as the proof case before other modules adopt it.
  Do not touch `FilingApproval`/P1-04 in the same change — it was deliberately scoped out.
- 22's MACHINE_DOWNTIME metric depends on a live "downtime started" event that doesn't exist
  today (only shift-end aggregates in `MachineOeeSnapshot`) — either scope the alert to
  "cumulative downtime this shift" (no new capture needed) or flag a small OEE-module addition
  to whoever owns machine execution.
- 23 (owner digest) needs an "owner recipient" concept on `Company`/`User` — check before
  building; may already exist.
