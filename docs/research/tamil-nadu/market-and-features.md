Research note, 2026-09-24. Market research on Tamil Nadu manufacturing clusters, turned into a
prioritised feature list. It adds to `docs/research/phase-2/tamil-nadu.md` (statutory rules) and
the Phase 2 roadmap (`docs/handoff/2026-09-14-phase-2-roadmap.md`) and does not repeat them. All
rupee figures, rates and periods below are research-time figures. Treat them as seed data to be
checked with the tenant's CHA or consultant, and never hard-code them as constants.

# Tamil Nadu manufacturers: market profile and feature plan

## BUILD NOW: three self-contained packages

These three are not built, specified or on the roadmap (checked `apps/api/src/modules/`,
`docs/specs/`, the Phase 2 roadmap and backlog, and `grep` on the schema for
RoDTEP/drawback/EPCG/schedule/T&A). Each is a new backend module plus one web screen. None of them
touches payroll, auth or tenancy core. Each follows CLAUDE.md:
`<name>.{routes,controller,service,validation}.ts`, mounted in `routes/index.routes.ts`,
`authMiddleware` plus `requirePermission`, Prisma only from `lib/prisma.ts`, uuid ids, `companyId`
with the `dbgenerated(current_setting('app.company_id'))` default like `SalesInvoice`, `Decimal`
money, `@db.Date` for business dates and `Timestamptz` for `createdAt`/`updatedAt`. Every build
needs a migration made with `prisma migrate dev --name <change>`, an integration spec (happy path,
every validation rejection, and a cross-tenant test showing a foreign `companyId` returns nothing
and 404s on get/patch), an `e2e/smoke.spec.ts` entry, a nav item gated on `<module>.view`, and one
changelog sentence. No endpoint may return a raw error message.

### BUILD NOW 1: TN-01 Export incentive and authorisation tracker

**What it is.** A register of (a) duty incentives earned per shipping bill (RoDTEP, RoSCTL for
garments and made-ups, and Duty Drawback) from declaration to credit, and (b) EPCG and Advance
Authorisation licences with their export-obligation (EO) progress up to EODC or redemption.
Today the product stores `exportType`, `lutNumber`, `shippingBillNo`, `shippingBillDate` and
`portCode` on `SalesInvoice`, but nothing after the invoice.

**Why it wins deals.** Tiruppur supplies about 55% of India's knitwear exports, and about 90% of
its firms are MSMEs. Its association has repeatedly lobbied over drawback and RoSL money stuck for
months (Rs 450 cr at one point), because this money is working capital. Exporters in Ambur,
Vaniyambadi and Ranipet (leather and footwear, about 1,620 MSMEs), Karur (home textiles) and
Coimbatore (pumps) buy machines under EPCG. That scheme requires exports worth 6 times the duty
saved within 6 years, with 50% due in the first block of 4 years. A missed obligation means paying
the duty back with interest. Today units track all of this in an Excel sheet kept by their CHA.
RoDTEP e-scrips expire 12 months after generation, so a scrip left unused is money lost.

**Feature flag.** Add a new feature `{ key: "exports", name: "Exports", description: "Export
incentives, EPCG / Advance Authorisation obligations", modules: ["export-incentives"] }` to
`packages/shared/src/features.ts`. Add `"exports"` to the `GROWTH` plan's `features`. `ENTERPRISE`
picks it up automatically.

**Permission.** In `packages/shared/src/permissions.ts`, add `{ module: "export-incentives",
actions: ["view", "create", "edit", "delete", "export"], description: "Export incentives and
EPCG/AA authorisations" }`.

**Models** (`apps/api/prisma/schema.prisma`):

```prisma
enum ExportIncentiveScheme { RODTEP ROSCTL DRAWBACK }
enum ExportIncentiveStatus { DECLARED SCROLLED SCRIP_GENERATED UTILISED TRANSFERRED CREDITED REJECTED }

model ExportIncentiveClaim {
  id               String   @id @default(uuid()) @db.Uuid
  companyId        String   @default(dbgenerated(...)) @map("company_id") @db.Uuid
  scheme           ExportIncentiveScheme
  shippingBillNo   String   @map("shipping_bill_no") @db.VarChar(20)
  shippingBillDate DateTime @map("shipping_bill_date") @db.Date
  portCode         String?  @map("port_code") @db.VarChar(10)
  salesInvoiceId   String?  @map("sales_invoice_id") @db.Uuid     // optional FK SalesInvoice
  fobValueInr      Decimal  @map("fob_value_inr") @db.Decimal(16, 2)
  ratePercent      Decimal? @map("rate_percent") @db.Decimal(6, 3)
  expectedAmount   Decimal  @map("expected_amount") @db.Decimal(14, 2)  // = fob * rate / 100 if rate given, else entered
  scrolledAmount   Decimal? @map("scrolled_amount") @db.Decimal(14, 2)
  scrolledOn       DateTime? @map("scrolled_on") @db.Date
  scripNo          String?  @map("scrip_no") @db.VarChar(30)
  scripDate        DateTime? @map("scrip_date") @db.Date
  scripExpiresOn   DateTime? @map("scrip_expires_on") @db.Date   // server: scripDate + 12 months
  utilisedAmount   Decimal  @default(0) @map("utilised_amount") @db.Decimal(14, 2)
  transferredTo    String?  @map("transferred_to") @db.VarChar(120)  // buyer IEC / name of a sold scrip
  realisedInr      Decimal? @map("realised_inr") @db.Decimal(14, 2)  // sale proceeds or drawback credit
  creditedOn       DateTime? @map("credited_on") @db.Date
  status           ExportIncentiveStatus @default(DECLARED)
  notes            String?
  createdBy        String?
  createdAt / updatedAt Timestamptz
  @@unique([companyId, scheme, shippingBillNo])
  @@index([companyId, status])
}

enum ExportAuthorisationType { EPCG ADVANCE_AUTHORISATION }
enum ExportAuthorisationStatus { ACTIVE EO_FULFILLED REDEEMED EXPIRED CANCELLED }

model ExportAuthorisation {           // add to AUDITED_MODELS (legal obligation master)
  id                     String @id @default(uuid()) @db.Uuid
  companyId              ...
  authType               ExportAuthorisationType
  authNo                 String   @map("auth_no") @db.VarChar(30)
  issueDate              DateTime @map("issue_date") @db.Date
  rlaOffice              String?  @map("rla_office") @db.VarChar(60)   // e.g. "Chennai", "Coimbatore"
  dutySaved              Decimal  @map("duty_saved") @db.Decimal(16, 2)
  eoMultiple             Decimal  @default(6) @map("eo_multiple") @db.Decimal(5, 2)  // EPCG default 6
  exportObligationAmount Decimal  @map("eo_amount") @db.Decimal(16, 2)  // EPCG: dutySaved*eoMultiple unless overridden; AA: entered
  eoPeriodMonths         Int      @map("eo_period_months")   // default EPCG 72, AA 18
  eoDueDate              DateTime @map("eo_due_date") @db.Date   // server: issueDate + eoPeriodMonths
  block1DueDate          DateTime? @map("block1_due_date") @db.Date  // EPCG: issueDate + 48 months, 50% of EO
  status                 ExportAuthorisationStatus @default(ACTIVE)
  eodcNo                 String?  @map("eodc_no") @db.VarChar(30)
  eodcDate               DateTime? @map("eodc_date") @db.Date
  notes                  String?
  createdAt / updatedAt
  entries                ExportObligationEntry[]
  @@unique([companyId, authNo])
}

model ExportObligationEntry {
  id               String @id @default(uuid()) @db.Uuid
  companyId        ...
  authorisationId  String @db.Uuid          // FK ExportAuthorisation, onDelete Restrict
  shippingBillNo   String @db.VarChar(20)
  shippingBillDate DateTime @db.Date
  salesInvoiceId   String? @db.Uuid
  fobValueInr      Decimal @db.Decimal(16, 2)
  realisedOn       DateTime? @db.Date        // BRC / e-BRC date; EO counts on realised value
  brcNo            String? @db.VarChar(40)
  createdAt
  @@unique([companyId, authorisationId, shippingBillNo])
}
```

**Endpoints** (`/api/export-incentives`):

- `GET /claims?scheme&status&from&to` (view). `POST /claims` (create). `PATCH /claims/:id` (edit).
  The service moves `status` forward and fills `scripExpiresOn` from `scripDate`.
  `DELETE /claims/:id` (delete) is allowed only in `DECLARED` and returns 409 otherwise.
- `POST /claims/from-invoice/:salesInvoiceId` (create) pre-fills from a `SalesInvoice` with a
  non-null `exportType` and a `shippingBillNo`. It looks the invoice up tenant-scoped and returns 404
  for a foreign one.
- `GET /claims/summary` (view) returns totals by scheme × status, "scrolled but no scrip for more
  than 30 days", "scrips expiring within 60 days", and the total pending receivable.
- `GET/POST /authorisations`, `GET/PATCH /authorisations/:id` (the detail includes entries and
  progress: `shippedFob`, `realisedFob`, `eoPercent`, `block1Percent`, `daysToDue`).
  `POST /authorisations/:id/entries` and `DELETE /authorisations/:id/entries/:entryId`.
  Authorisations are never deleted. Their status becomes `CANCELLED`.

**Validation.** `shippingBillNo` is `^[0-9A-Z]{5,20}$`. `fobValueInr` is greater than 0.
`ratePercent` is between 0 and 25. `authNo` is `^[0-9A-Z]{6,30}$`. `scripDate` must be on or after
`shippingBillDate`. `eoPeriodMonths` is between 1 and 120. `utilisedAmount` must not exceed
`scrolledAmount`.

**Web.** `apps/web/src/modules/exports/pages/ExportIncentivesPage.tsx` at route `/exports/incentives`,
with two tabs:

- Claims: a table with status chips and a filter by scheme. Summary tiles show pending, scrips
  expiring in 60 days, and credited this FY. Add and edit use a modal with a "from invoice" picker.
- Authorisations: a list with an EO progress bar, the block-1 flag and days to due, and a detail
  drawer that lists the entries.

Build it in Tailwind and make HTTP calls through `baseApi`.

**Size:** M for the full scope. The BUILD NOW cut is claims plus authorisations CRUD and the summary;
the pg-boss expiry-alert job comes later.

### BUILD NOW 2: TN-02 OEM delivery schedules and schedule adherence

**What it is.** Tier-2 and Tier-3 auto-component suppliers in Chennai, Sriperumbudur, Oragadam,
Hosur and Coimbatore do not work from one-off sales orders. They receive a monthly or weekly
delivery schedule against an open PO (scheduling agreement) from customers such as Hyundai, Ashok
Leyland, TVS, Renault-Nissan, Daimler, Royal Enfield and their Tier-1s. Near-term lines are firm
and later lines are tentative. The customer rates the supplier on schedule adherence and OTIF.
Shiftline records each schedule, links dispatches to its lines, and computes adherence the way the
OEM does, so the supplier sees its rating before the OEM's portal shows it.

**Why it wins deals.** This is the first thing an auto-component buyer checks in a demo, and Tally
cannot model it (see [Terra Insight on Tally workarounds for Tier-2/3 suppliers](https://www.terra-insight.com/insights/tally-prime-auto-component-workarounds/)).
Schedule adherence is a vendor-rating KPI that decides share of business. It also applies to the
Coimbatore pump and motor, Trichy BHEL ancillary and Hosur electronics clusters, which all supply
large buyers on schedules.

**Feature flag.** Add the module `"delivery-schedules"` to the existing `sales` feature's `modules`
in `features.ts`, since every plan includes sales.

**Permission.** `{ module: "delivery-schedules", actions: ["view", "create", "edit", "delete",
"export"], description: "Customer delivery schedules and adherence" }`.

**Models:**

```prisma
enum CustomerScheduleStatus { OPEN CLOSED CANCELLED }
enum ScheduleFirmness { FIRM TENTATIVE }

model CustomerSchedule {
  id           String @id @default(uuid()) @db.Uuid
  companyId    ...
  scheduleNo   String   @map("schedule_no") @db.VarChar(40)   // customer's schedule / release no
  customerId   String   @map("customer_id") @db.Uuid           // FK Customer (uuid)
  customerPoNo String?  @map("customer_po_no") @db.VarChar(40) // scheduling agreement / open PO
  periodMonth  DateTime @map("period_month") @db.Date          // first day of the schedule month
  receivedOn   DateTime @map("received_on") @db.Date
  revision     Int      @default(0)
  status       CustomerScheduleStatus @default(OPEN)
  notes        String?
  createdBy / createdAt / updatedAt
  lines        CustomerScheduleLine[]
  @@unique([companyId, scheduleNo, revision])
  @@index([companyId, customerId, periodMonth])
}

model CustomerScheduleLine {
  id             String @id @default(uuid()) @db.Uuid
  companyId      ...
  scheduleId     String @db.Uuid              // FK CustomerSchedule, onDelete Cascade
  productId      BigInt? @map("product_id")   // Product.id is BigInt; optional
  customerPartNo String  @map("customer_part_no") @db.VarChar(40)
  description    String? @db.VarChar(120)
  dueDate        DateTime @map("due_date") @db.Date
  firmness       ScheduleFirmness @default(FIRM)
  scheduledQty   Decimal @map("scheduled_qty") @db.Decimal(14, 3)
  dispatches     CustomerScheduleDispatch[]
  @@index([companyId, dueDate])
}

model CustomerScheduleDispatch {
  id             String @id @default(uuid()) @db.Uuid
  companyId      ...
  lineId         String @db.Uuid              // FK CustomerScheduleLine, onDelete Restrict
  dispatchDate   DateTime @map("dispatch_date") @db.Date
  qty            Decimal @db.Decimal(14, 3)
  salesInvoiceId String? @map("sales_invoice_id") @db.Uuid
  invoiceNo      String? @map("invoice_no") @db.VarChar(30)
  asnNo          String? @map("asn_no") @db.VarChar(40)
  createdAt
}
```

**Adherence rules** (a pure function in `delivery-schedules.calc.ts` with unit tests):

- For each line: `dispatched = Σ qty`, `onTime = Σ qty where dispatchDate ≤ dueDate`,
  `late = dispatched − onTime`, and `short = max(0, scheduled − dispatched)`.
- A line's status is `PENDING` (nothing dispatched and not yet due), `MET` (onTime ≥ scheduled),
  `LATE` (the full quantity arrived but some of it late), `SHORT` (past due and under-delivered),
  or `EXCESS` (dispatched more than 110% of scheduled).
- Adherence % for a customer and month = `Σ min(onTime, scheduled) / Σ scheduled` over **FIRM**
  lines only, rounded to 1 decimal. OTIF % counts the lines with status `MET` over the FIRM lines
  that are due.

**Endpoints** (`/api/delivery-schedules`):

- `GET /?customerId&month&status`, `POST /` (header plus a `lines[]` array of up to 500),
  `GET /:id` (with line metrics), and `PATCH /:id` (header, status, revision).
- `POST /:id/lines` (bulk add, used by the web "paste from Excel" box), `PATCH /lines/:lineId`,
  and `DELETE /lines/:lineId` (409 if the line has dispatches).
- `POST /lines/:lineId/dispatches` and `DELETE /dispatches/:dispatchId`.
- `GET /due?days=7` gives the open FIRM lines due within N days with their remaining quantity, as
  the dispatch planner's list.
- `GET /adherence?from&to&customerId` gives rows per customer × month with scheduled, onTime, late,
  short, adherence % and OTIF %.

`customerId`, `productId` and `salesInvoiceId` are all verified tenant-scoped with `findFirst`
before a write.

**Validation.** Quantities are greater than 0. `dueDate` falls within `periodMonth` ± 45 days, so
spill-over lines are allowed. `customerPartNo` is 1 to 40 characters.

**Web.** `apps/web/src/modules/sales/pages/DeliverySchedulesPage.tsx` at route
`/sales/delivery-schedules`, with three tabs:

- Schedules: a list, plus a create form with a textarea that parses Excel paste in the column
  order `partNo \t dueDate \t qty \t F/T`.
- Due this week.
- Adherence: a table per customer and month, with % cells coloured ≥95 green, 85–95 amber and
  <85 red.

**Size:** M. The BUILD NOW cut is the whole of the above. EDI/ASN transmission and automatically
linking dispatches from `SalesInvoice` come later (TN-07).

### BUILD NOW 3: TN-03 Export order Time-and-Action (T&A) calendar

**What it is.** A "T&A" is how garment, home-textile and footwear exporters run every buyer order.
It is a milestone plan counted back from the ex-factory date: yarn booking, lab-dip approval, PP
sample, knitting, dyeing, printing, cutting, sewing, final inspection, ex-factory. The buyer's
merchandiser asks for it weekly. Shiftline generates the milestones from a template, records the
actual date of each one, and flags slippage on every open order.

**Why it wins deals.** Tiruppur has about 2,500 knitwear and garment units, Karur and Erode make
home textiles, and Ambur and Vaniyambadi make footwear. All of them run T&A on Excel and WhatsApp.
A missed ex-factory date means paying for air freight or taking a discount, which buyers pushed
hard during the 2025–26 US tariff squeeze. A merchandiser-facing T&A board is the screen that sells
an ERP to an export house. No module or roadmap item covers it.

**Feature flag.** Add the module `"order-tna"` to the existing `production` feature's `modules`.

**Permission.** `{ module: "order-tna", actions: ["view", "create", "edit", "delete", "export"],
description: "Export order time-and-action calendar" }`.

**Models:**

```prisma
enum OrderTnaStatus { ACTIVE SHIPPED CANCELLED }
enum TnaMilestoneStatus { PENDING DONE SKIPPED }

model OrderTna {
  id            String @id @default(uuid()) @db.Uuid
  companyId     ...
  tnaNo         String   @map("tna_no") @db.VarChar(30)       // user-entered or "<buyerPoNo>-<styleRef>"
  customerId    String   @map("customer_id") @db.Uuid         // buyer, FK Customer
  salesOrderId  Int?     @map("sales_order_id")               // SalesOrder.id is Int; optional
  buyerPoNo     String   @map("buyer_po_no") @db.VarChar(40)
  styleRef      String   @map("style_ref") @db.VarChar(60)
  description   String?  @db.VarChar(200)
  orderQty      Decimal  @map("order_qty") @db.Decimal(14, 3)
  uom           String?  @db.VarChar(10)                       // PCS / DOZ / PRS
  orderDate     DateTime @map("order_date") @db.Date
  exFactoryDate DateTime @map("ex_factory_date") @db.Date
  template      String   @db.VarChar(30)   // GARMENT_KNIT | HOME_TEXTILE | LEATHER_FOOTWEAR | GENERIC
  merchandiser  String?  @db.VarChar(80)
  status        OrderTnaStatus @default(ACTIVE)
  createdBy / createdAt / updatedAt
  milestones    OrderTnaMilestone[]
  @@unique([companyId, tnaNo])
  @@index([companyId, status, exFactoryDate])
}

model OrderTnaMilestone {
  id          String @id @default(uuid()) @db.Uuid
  companyId   ...
  tnaId       String @db.Uuid                  // FK OrderTna, onDelete Cascade
  seq         Int
  name        String @db.VarChar(80)
  plannedDate DateTime @map("planned_date") @db.Date
  actualDate  DateTime? @map("actual_date") @db.Date
  status      TnaMilestoneStatus @default(PENDING)
  owner       String? @db.VarChar(80)
  remarks     String? @db.VarChar(300)
  @@unique([tnaId, seq])
}
```

**Templates** live in `order-tna.templates.ts` as a code constant. Each entry is a milestone name
and its offset in days before ex-factory.

- `GARMENT_KNIT`: Yarn booked −60, Lab dip approved −55, Fit/proto sample approved −50,
  Knitting done −42, Dyeing/compacting done −35, PP sample approved −30, Printing/embroidery done
  −24, Cutting started −21, Sewing started −18, Sewing done −8, Finishing & packing done −5, Final
  inspection passed −3, Ex-factory 0.
- `HOME_TEXTILE`: Yarn booked −50, Strike-off approved −45, Weaving done −35, Processing done −25,
  Stitching done −15, Packing done −5, Final inspection −3, Ex-factory 0.
- `LEATHER_FOOTWEAR`: Leather booked −75, Sample approved −60, Cutting done −30, Closing done −22,
  Lasting done −15, Finishing & packing −6, Final inspection −3, Ex-factory 0.
- `GENERIC`: Material in −30, Production start −20, Production done −5, Inspection −2, Dispatch 0.

A milestone's planned date is `exFactoryDate − offset`, clamped so it is never before `orderDate`.

**Rules.**

- Changing `exFactoryDate` shifts every `PENDING` milestone by the same number of days in one
  transaction. `DONE` milestones keep their dates.
- Marking a milestone `DONE` requires `actualDate`, and `delayDays = actualDate − plannedDate`.
- An order goes red when any `PENDING` milestone is past its planned date. It goes amber when one
  is due within 3 days. Otherwise it is green.

**Endpoints** (`/api/order-tna`):

- `GET /templates`, `GET /?status&customerId&from&to` (list rows carry `rag`, the next milestone,
  and the count of overdue milestones), and `POST /` (header plus `template`, which creates the
  milestones).
- `GET /:id` and `PATCH /:id` (header; applies the ex-factory shift).
- `POST /:id/milestones` (custom milestone; `seq` is taken as the maximum + 1) and
  `PATCH /:id/milestones/:milestoneId`.
- `GET /alerts?days=3` lists overdue and due-soon milestones across ACTIVE orders.

The API has no DELETE for an order. Cancelling means setting `status CANCELLED`.

**Validation.** `exFactoryDate` must be on or after `orderDate`. `orderQty` is greater than 0.
`template` must be one of the keys. `customerId` and `salesOrderId` are checked tenant-scoped.

**Web.** `apps/web/src/modules/production/pages/OrderTnaPage.tsx` at route `/production/order-tna`.
The list shows RAG dots and supports filtering by buyer and month. The detail view shows the
milestones in an inline-editable table (actual date, status, owner, remarks) with delay days in red.
An "Alerts" strip at the top lists what is overdue today.

**Size:** S to M. The BUILD NOW cut is the whole of the above. A WhatsApp nudge for overdue
milestones goes through the existing `whatsappservice` later.

---

## (a) Cluster profiles

| Cluster                                                                     | Products                                                                                                         | Typical size                                                                                                                                                              | Top 3 pain points                                                                                                                                                                                                                | Must-have features                                                                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Tiruppur** knitwear and garments                                          | T-shirts, innerwear, kidswear, knit fabric; export (US/EU) and domestic                                          | About 2,500 units, 8–9 lakh workers, about Rs 40,000 cr/yr exports; about 90% MSME; many units do a single process (knitting, dyeing, printing, stitching) as job workers | 1. Working capital stuck in drawback/RoDTEP/RoSCTL and buyer credit; 2. ex-factory slippage across a multi-unit job-work chain; 3. buyer social-compliance audits (BSCI, WRAP, SMETA, SA8000) and migrant-labour hours and wages | T&A calendar (TN-03), incentive tracker (TN-01), multi-hop job-work chain (TN-06), piece-rate (spec P2-12), audit readiness (TN-08) |
| **Coimbatore** pumps, motors, wet grinders, foundry, textile machinery      | Agricultural and domestic pumps (about 40% of India's pump sets, about 600 pump units), castings, motors, spares | 535 foundries (15 large, 70 medium, the rest small and micro at 500–2,000 tpy); pump units of Rs 5–100 cr                                                                 | 1. Power cost (foundries are energy-heavy); 2. credit access and slow payment from large buyers; 3. foundry-to-machining job-work loss and yield                                                                                 | Energy costing (spec P2-03), job-work yield (P2-08 built), MSME delayed-payment claims (TN-05), EPCG for exporters (TN-01)          |
| **Chennai, Sriperumbudur, Oragadam, Hosur** auto components and electronics | Pressings, machined parts, plastics, wiring harness, rubber, castings for OEMs and Tier-1s                       | Tier-2/3 of Rs 10–250 cr, 50–500 workers                                                                                                                                  | 1. Monthly schedule churn and vendor rating (adherence, OTIF, PPM); 2. OEM quality systems (PPAP, IATF 16949, 8D); 3. ASN, barcode labels and EDI                                                                                | Delivery schedules and adherence (TN-02), ASN and labels (TN-07), quality/CAPA (specs P2-06/07/10)                                  |
| **Sivakasi** printing, fireworks, matches                                   | Offset printing (about 60% of India's), fireworks (about 90%), safety matches (about 80%)                        | About 2.5 lakh workers, highly specialised single-operation units, strong seasonality (Diwali)                                                                            | 1. Explosives licences (PESO) and safety incidents; 2. seasonal build-up with advance-funded dealers; 3. piece-rate and contract labour                                                                                          | Licence register (roadmap P2-14), piece-rate (spec P2-12), dealer advance/credit control                                            |
| **Karur, Erode, Salem** home textiles, powerloom, handloom                  | Bed and table linen, curtains, towels; yarn and fabric processing                                                | Export houses of Rs 20–300 cr plus hundreds of powerloom job workers                                                                                                      | 1. Export incentives and EPCG obligations; 2. job-work weaving and processing chain; 3. yarn price swings                                                                                                                        | TN-01, TN-03, TN-06                                                                                                                 |
| **Ambur, Vaniyambadi, Ranipet** leather and footwear                        | Finished leather, shoe uppers, footwear, leather garments                                                        | About 1,620 MSMEs plus 18 large firms, about 1.4 lakh workers, heavily export-oriented                                                                                    | 1. EPCG/AA obligations and incentive cash-flow; 2. buyer T&A and sample approvals; 3. effluent (TNPCB, CETP) compliance                                                                                                          | TN-01, TN-03, PCB consent (roadmap P2-14)                                                                                           |
| **Namakkal, Tiruchengode** truck body building                              | Lorry, tipper and tanker bodies on customer chassis                                                              | About 150 workshops plus 12 large houses                                                                                                                                  | 1. Customer-owned chassis in custody; 2. job costing per body; 3. stage billing and advances                                                                                                                                     | Project/job costing per body (TN-09), customer-material custody                                                                     |
| **Trichy** fabrication (BHEL ancillaries)                                   | Boiler parts, structurals, pressure parts                                                                        | Rs 5–100 cr, heavy on job work and PSU tenders                                                                                                                            | 1. PSU payment delays; 2. inspection and third-party QA; 3. BG/EMD tracking                                                                                                                                                      | TN-05 (MSME claims), TN-09, quality specs                                                                                           |
| **Madurai, Virudhunagar** (rubber, food processing, printing)               | Rubber goods, oil, dal, printing                                                                                 | Mostly micro and small                                                                                                                                                    | Price-sensitive, Tamil-first staff, cash and credit mix                                                                                                                                                                          | Tamil UI (TN-04), simple billing                                                                                                    |

## (b) Cross-cutting Tamil Nadu needs

- **Tamil language.** Supervisors, store keepers and accountants in tier-2 towns prefer Tamil.
  The web app has no i18n library and every string is English JSX (confirmed in
  `phase-2/tamil-nadu.md`). P2-17 plans bilingual _documents_, but no one has planned a Tamil _UI_.
  This affects every cluster (TN-04).
- **Power (TNPDCL/TANGEDCO).** TNERC Tariff Order 6 of 2025 applies from 1 July 2025. Peak hours
  06:00–10:00 and 18:00–22:00 carry a 25% surcharge for HT and LT-III-B consumers. Peak charges for
  MSMEs are deferred until smart meters are installed, with the state paying Rs 196 cr of subsidy.
  The LTPT subsidy is 20% of consumption charges for 36 months. **These are already covered** by
  spec P2-03 (energy metering) and roadmap P2-16 (energy and utilities). The only gap is ToD band
  costing and the LTPT subsidy reminder, which should be folded into P2-16 rather than a new package.
- **Statutory rules.** Half-yearly PT, LWF, minimum wages with VDA, the NFH holiday list and the
  Factories registers are covered by roadmap P2-17 and specs P2-03 (registers) and P2T-03.
- **State incentives.** Capital subsidy is 25% of plant and machinery up to Rs 150 lakh, plus 10%
  extra for micro units. Interest subvention is 3% back-ended up to Rs 10 lakh. NEEDS supports
  first-generation entrepreneurs. The roadmap backlog already lists "TN MSME incentives register"
  as depending on P2-14, and TN-10 below extends it.
- **Export incentives.** RoDTEP has been extended to 30 Sep 2026 at the 4R/4RE schedules, and its
  intent must be declared on the shipping bill. RoSCTL applies to apparel and made-ups. Drawback is
  credited to the bank. EPCG requires 6 times the duty saved in 6 years. None of this is in the
  product (TN-01).
- **Job-work chains.** Tiruppur runs knitting → dyeing/compacting → printing → stitching → checking,
  each often at a different unit. Coimbatore runs foundry → fettling → machining → painting.
  `job-work` (P1-14, P2-08) handles one-hop challans, ITC-04 and yield. The gap is a **process-route
  view** (TN-06).
- **OEM supply.** Scheduling agreements, adherence, ASN and labels (TN-02, TN-07).
  PPAP, IATF 16949 and 8D map onto specs P2-06, P2-07 and P2-10, which cover quality.
- **Payments culture.** MSMEs selling to large buyers and PSUs are owed payment within 45 days under
  the MSMED Act, with interest at 3 times the RBI bank rate and a MSME Samadhaan filing if unpaid.
  They also use TReDS. The existing `msme` module covers the _payable_ side (43B(h)). The
  _receivable_ claim pack is missing (TN-05).
- **WhatsApp.** Orders, schedules and payment follow-ups happen on WhatsApp. `whatsappservice` and
  `WhatsappConfig` exist. Roadmap P2-15 and the backlog cover the owner digest and document
  auto-send. Order intake from WhatsApp is not covered, but it is L-sized and risky, so it is not
  prioritised here.

## (c) Gap analysis

| Need                                          | Existing (built or specified)                                                                                 | Gap                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Export invoice (LUT, IGST, shipping bill, FX) | Built: `SalesInvoice.exportType/lutNumber/shippingBillNo/portCode`, multi-currency P1-17, FX settlement P2-06 | Everything after the invoice: incentives, EPCG/AA, BRC → **TN-01** |
| Piece-rate wages                              | Specified: `docs/specs/P2-12-piece-rate-incentive.md`                                                         | None (do not duplicate)                                            |
| Power tariff and energy cost                  | Specified: P2-03 energy metering; roadmap P2-16                                                               | ToD band costing and LTPT subsidy: fold into P2-16                 |
| TN PT, LWF, min wage, holidays                | Roadmap P2-17; `StatutoryRule`                                                                                | None new                                                           |
| Licences (Factories, PESO, TNPCB)             | Roadmap P2-14 (not yet built)                                                                                 | Add PESO/explosives and BIS types when P2-14 lands                 |
| Job work                                      | Built: `job-work` (challans, ITC-04, yield P2-08)                                                             | Multi-step process route per lot → **TN-06**                       |
| OEM schedules and adherence                   | Nothing                                                                                                       | **TN-02**; ASN and labels → **TN-07**                              |
| Buyer T&A                                     | Nothing                                                                                                       | **TN-03**                                                          |
| Tamil UI                                      | Nothing (P2-17 covers documents only)                                                                         | **TN-04**                                                          |
| MSME delayed-payment claim (receivable side)  | `msme` module (payable), `Customer.overdueInterestRate`, roadmap P2-08 dunning                                | Section 16 interest and Samadhaan claim pack → **TN-05**           |
| Social-compliance audit readiness             | Registers (spec P2-03), biometric attendance (P2-11), CAPA (P2-10)                                            | Buyer-audit calendar and findings → **TN-08**                      |
| Body or project job costing                   | Costing P1-19 (product-level)                                                                                 | Per-job/per-chassis costing → **TN-09**                            |
| TN subsidy claims                             | Backlog item (depends on P2-14)                                                                               | **TN-10**                                                          |

## (d) Prioritised feature list

1. **TN-01 Export incentive and authorisation tracker.** BUILD NOW; spec above. Size M.
2. **TN-02 OEM delivery schedules and adherence.** BUILD NOW; spec above. Size M.
3. **TN-03 Export order T&A calendar.** BUILD NOW; spec above. Size S to M.
4. **TN-04 Tamil UI (தமிழ்) for shop-floor and store screens.**
   - _What:_ A per-user language preference (`User.locale`, `en` or `ta`) and a small i18n layer in
     `apps/web`: either `react-i18next`, or a typed dictionary plus a `useT()` hook. Tamil strings
     cover the sidebar, login, hourly production entry, shift execution, GRN, goods dispatch and
     stock screens first. The Noto Sans Tamil font comes from Google Fonts. Numbers stay in
     Indian-English digits. Accounting screens stay in English at first.
   - _Why it wins:_ An operator or store keeper in Karur, Sivakasi or Madurai can use it without
     training, and no mainstream SME ERP offers it. It also makes the owner's "my staff can't use
     it" objection go away.
   - _Scope:_ one migration (`users.locale`), `PATCH /api/users/me/locale`, the i18n provider,
     a `ta.json` of about 400 strings, and a language switch in the profile menu.
   - _Size:_ M, rolled out as screens are touched.
5. **TN-05 MSME delayed-payment claim pack (receivable side).**
   - _What:_ For customers who are not MSMEs, or who are large buyers or PSUs, flag invoices unpaid
     after 45 days (or the agreed term, whichever is shorter). Compute compound interest at 3 times
     the RBI bank rate from the due date (MSMED Act Sections 15–16; the bank rate is a
     tenant-editable setting, VERIFY). Generate a claim statement PDF in the MSME Samadhaan and
     MSEFC format, and track claims (filed, hearing, settled). Show the invoice eligibility for
     TReDS discounting.
   - _Why it wins:_ Coimbatore and Trichy suppliers to large buyers are chronically paid late, and
     this turns the ERP into a cash tool.
   - _Scope:_ `MsmeRecoveryClaim` plus claim lines, `/api/msme/receivable-claims`, and a screen
     under Receivables. It uses P2-08's ageing.
   - _Size:_ M.
6. **TN-06 Multi-step job-work process route (knitting → dyeing → printing → stitching; foundry →
   machining).**
   - _What:_ A `ProcessRoute` per product or lot with ordered steps, each step in-house or at a job
     worker. Each outward challan (existing `DeliveryChallan`) is linked to a route step. A lot
     board shows where every lot is, the quantity or weight in and out per hop, and the process
     loss per step against a norm.
   - _Why it wins:_ This is how Tiruppur and Coimbatore actually work, and ITC-04 alone does not
     show it.
   - _Scope:_ `ProcessRoute`, `ProcessRouteStep` and `LotRouteProgress`, extending the `job-work`
     module. It must be coordinated with P2-08 and the roadmap's lot traceability, so it is not
     self-contained.
   - _Size:_ L.
7. **TN-07 OEM ASN, packing labels and part-number cross-reference.**
   - _What:_ A mapping from the customer's part number to the product. An ASN is generated from a
     sales invoice plus TN-02 schedule lines, with a CSV or Excel export in the OEM portal's upload
     format and bin or packing labels with QR codes. Adapters are provider-style, as with
     e-invoice.
   - _Scope:_ `CustomerPartMap`, `Asn` and `AsnLine`, `/api/asn`, and a label print.
   - _Size:_ M, and it depends on TN-02.
8. **TN-08 Buyer social-compliance audit readiness.**
   - _What:_ A calendar of buyer audits (BSCI, WRAP, SMETA, SA8000, Sedex, customer CoC) with
     findings and corrective actions. The corrective actions reuse spec P2-10 CAPA. A readiness
     report pulls working-hours breaches, OT above the limit, below-minimum-wage cases and missing
     registers from payroll, attendance and registers.
   - _Why it wins:_ A failed audit means a lost buyer for Tiruppur and Ambur exporters.
   - _Size:_ M, and it depends on P2-10 and P2-11.
9. **TN-09 Job/project costing per body or fabrication job.**
   - _What:_ A `Job` holds the customer, the customer-owned chassis or material, a stage plan,
     material issues and labour hours per job, stage invoices, and advances. Actual cost is compared
     with the quote.
   - _Why it wins:_ Namakkal body builders and Trichy fabricators price and track work per job,
     not per SKU.
   - _Size:_ L.
10. **TN-10 Tamil Nadu subsidy and scheme claim tracker.**
    - _What:_ Tracks capital subsidy (25% of plant and machinery, capped), the LTPT 20% power
      subsidy for 36 months (reminder by month), 3% interest subvention per loan (linked to the
      P2-09 loan register), and NEEDS. It records the sanction, the claim and the disbursement.
    - _Scope:_ It extends the roadmap P2-14 licence register as `licenceType = MSME_SCHEME` with
      extra fields.
    - _Size:_ S once P2-14 exists.

**Not prioritised.** WhatsApp order intake: it needs inbound Business API webhooks, message
parsing and SKU matching, so it is L-sized and error-prone. Revisit after P2-15. TANGEDCO ToD
costing: fold into P2-16.

## Sources

- [Business & Human Rights Centre: TN textile hubs and US tariffs](https://www.business-humanrights.org/en/latest-news/india-textile-hubs-in-tamil-nadu-face-export-slowdown-job-loss-risk-amid-us-tariff-hike-on-garments-home-textiles/)
- [The Federal: Tiruppur exporters under pressure](https://thefederal.com/category/states/south/tamil-nadu/trump-tariff-impact-tiruppur-export-msmes-25-textile-knitwear-199724)
- [Business Standard: knitwear exporters seek Rs 450 cr drawback](https://www.business-standard.com/article/pti-stories/knitwear-exporters-seek-release-of-rs-450-cr-duty-drawback-114032400697_1.html)
- [Global Living Wage Coalition: Tiruppur garment industry](https://globallivingwage.org/case-studies/garment-industry-in-tiruppur-tamil-nadu-india/)
- [Tirupur garment certifications guide 2026](https://rudraaexports.com/tirupur-garment-certifications-guide-2026/)
- [pwrnxt: TNERC tariff order 2026, ToD timings](https://pwrnxt.in/blog/tamil-nadu-ci-tariff-decoded)
- [inkl: Tangedco peak-hour charges deferred for MSMEs](https://www.inkl.com/news/tangedco-to-not-collect-peak-hour-charges-from-msmes-till-installation-of-smart-meters)
- [YourStory: TN MSMEs and revised tariffs](https://yourstory.com/smbstory/msmes-tamil-nadu-unite-revised-electricity-tariffs)
- [SAMEEEKSHA: Coimbatore foundry cluster](https://www.sameeeksha.org/index.php?option=com_content&view=article&id=162&Itemid=502) and [pump cluster](https://sameeeksha.org/index.php?Itemid=502&id=189&option=com_content&view=article)
- [Zenodo: Coimbatore MSME creditworthiness](https://zenodo.org/records/20095167)
- [Terra Insight: Tally workarounds for auto-component Tier-2/3](https://www.terra-insight.com/insights/tally-prime-auto-component-workarounds/)
- [Autocar Pro: Chennai component suppliers](https://www.autocarpro.in/news-national/chennai-component-suppliers-production-lines-start-humming-9887)
- [Ashok Leyland suppliers world](https://www.ashokleyland.com/en/suppliers-world)
- [DGFT EPCG](https://www.dgft.gov.in/CP/?opt=epcg), [CLE: EPCG](https://leatherindia.org/epcg/), [DGFT Guru: export obligation](https://www.dgftguru.com/export-obligation-extension/)
- [Xflow: RoDTEP 2026](https://www.xflowpay.com/blog/rodtep-scheme), [Razorpay: duty credit scrips](https://razorpay.com/blog/duty-credit-scrip-meaning-types-benefits/), [ConsultEase: RoDTEP in customs system](https://consultease.com/blog/implementation-rodtep-scheme-customs-automated-system-declarations-shipping-bill-processing)
- [Zenodo: Ambur and Vaniyambadi leather MSMEs and GST](https://zenodo.org/records/20713140)
- [Wikipedia: Sivakasi](https://en.wikipedia.org/wiki/Sivakasi); [MSME-DI: Namakkal lorry body cluster](https://msmedi-chennai.gov.in/GARMS_Admin/basictools/images/tender/TenderNoticeLorrybodybuildingclusterNamakkal.pdf)
- [MSME Tamil Nadu: capital subsidy](https://www.msmetamilnadu.tn.gov.in/capital-subsidy.php), [LTPT subsidy guidelines](https://msmeonline.tn.gov.in/incentives/html_cye_ltpt.php), [ICAI: TN incentive framework](https://startup.icai.org/wp-content/uploads/2025/10/Tamil-Nadu-State-Specific-Policies.pdf)
