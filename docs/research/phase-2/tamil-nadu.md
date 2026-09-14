Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Tamil Nadu & Local Regulatory Rules — Research Report

Domain: state/district-level statutory and regulatory logic the ERP must model, with Tamil Nadu (state
code 33) as the first-customer state for plastics manufacturers (injection/blow moulding, extrusion,
recycling/granulation).

**Everything numeric below (slabs, thresholds, dates, amounts) is a seed assumption from general
knowledge, current to my training and NOT re-verified against a live government source. Every item is
flagged "VERIFY WITH ACCOUNTANT" before it ships as a default — these change by notification and the
app must never silently apply a stale number.**

## 1. Inventory: what exists today

### Prisma models (apps/api/prisma/schema.prisma)

- `StatutoryRule` (line ~5193): per-company, per-`stateCode` PT slabs (`ptSlabs` JSON with
  `{upTo, amount, month?}`), `ptEnabled`, `lwfEmployee`, `lwfEmployer`, `lwfFrequency`
  (MONTHLY/HALF_YEARLY/ANNUAL), `lwfMonths` JSON array, `isActive`. Unique on `(companyId, stateCode)`.
  **No `effectiveFrom`/`effectiveTo` — a slab revision overwrites history, so a payroll re-run for a
  past period after the state raises PT will use today's slab, not the one in force then.** No country
  or district dimension. No seed data ships it into the DB (only a hardcoded TS table, see below).
- `PayrollStatutory` (~5222): per-employee-per-run statutory split (PF/ESI/PT/LWF/TDS), `stateCode`
  captured per row so history stays correct even if the rule later changes — good practice, but only
  works if the rule was correct at calc time.
- `EmployeeTaxDeclaration` (~5271): income-tax regime declarations, not state-specific.
- `Holiday` (~5312): `companyId`, `holidayOn`, `name`, `kind` (NATIONAL/FESTIVAL/COMPANY), `stateCode`
  (nullable), `isPaid`. Unique `(companyId, holidayOn, name)`. **No `district` field, no "scheduled
  employment" concept, no source/notification reference.**
- `Company` / `BusinessPlace` (~535, ~766): `stateCode VARCHAR(2)` present on both (and on
  `Customer`, `Supplier`, `CustomerAddress`, `SupplierAddress`, `EwayBill.fromStateCode/toStateCode`,
  `AdvanceReceipt`). GST place-of-supply plumbing is solid; **no district, taluk, or local-body
  (corporation/municipality/panchayat) field anywhere** — needed for PT jurisdiction (TN PT is levied
  by the local body, not the state government directly) and for trade licence/property tax.
- No model at all for: licences/registrations (Factories Act licence, Shops & Establishments
  registration, PCB consent, trade licence, TANGEDCO connection), pollution consent, TN minimum-wage
  schedules, MSME schemes/subsidies, VDA/DA index points.

### API (apps/api/src/modules)

- `payroll/statutory.calc.ts`: pure functions — `pfSplit`, `esiSplit`, `professionalTax(wage, slabs,
month)`, `wageCheck` (Code on Wages 50% basic+DA floor), income-tax slabs. Contains
  `DEFAULT_STATUTORY_RULES`, a **hardcoded in-code array** (not DB-seeded) covering 6 states:
  - **Tamil Nadu (33)**: PT slabs — ≤21,000: 0; ≤30,000: 135; ≤45,000: 315; ≤60,000: 690; ≤75,000:
    1,025; above: 1,250 (these read as **half-yearly** amounts per the code comment "Tamil Nadu levies
    half-yearly; the monthly figure is the half-yearly one divided by six" — **VERIFY**: the calc
    function itself takes a `month` and returns per-month, so it's unclear from this file alone whether
    the division by 6 actually happens in the caller). LWF: employee ₹20, employer ₹40, ANNUAL, month 12. **VERIFY**: TN LWF Act due date is 31 January for the preceding calendar year, not December —
    this looks like an off-by-one on frequency/month and should be checked with an accountant/the TN
    LWF Act text before going live.
  - Maharashtra (27), Karnataka (29), Gujarat (24), Telangana (36), Delhi (07 — explicitly zero PT).
  - This is a good foundation but has the same effective-dating gap as the DB model, plus it privileges
    TN/5 other states only — no generic "add a new state" data path without a code change beyond the
    `/rules` POST endpoint (which does let a company override via `StatutoryRule`, good).
- `payroll/statutory.routes.ts`, `statutory.service.ts`, `statutory.files.ts`: `/payroll-statutory/rules`
  (GET list, POST upsert one state's rule; `requirePermission("payroll-settings.edit")`),
  `/declarations`, `/runs`, plus statutory return file generators (ECR, ESI, ...). No PT/LWF **return**
  file generator seen (TN Form return for LWF, PT). VERIFY exact file naming.
- `eway-bill/*`: `eway-bill.service.ts`, `.payload.ts`, `.routes.ts`, `.types.ts`. Generates e-way bills
  via a portal payload; `distanceKm` capped 0–4000; `fromPincode`/`toPincode` are 6-digit validated
  (the `p >= 100000 ? p : 999999` in `.payload.ts:19` is pincode-format normalization, **not** the
  GST ₹1-lakh e-way bill value threshold — I found **no code anywhere that checks invoice value against
  the intra-state e-way bill threshold** before offering/requiring generation; it looks like eway bill
  generation is manual/on-demand from the document rather than threshold-gated).
- `labour/*` (via `labourService.ts` on the web, backed by some API module) exposes `/labour/holidays`
  (list + add) — company-wide, not state/district aware in the UI even though the DB column exists.
- No module for licences, PCB consent, or TANGEDCO tariff/energy costing.

### Web (apps/web/src)

- `modules/payroll/pages/StatutoryPayrollPage.tsx`: shows PT/LWF **"by state"** tables, with copy
  explicitly telling the user "Neither is a national rate. Professional tax has its own slabs in each
  state that levies it..." — good UX honesty already built in.
- `modules/payroll/pages/PayrollSettings.tsx`: **has a separate, competing "Professional Tax" toggle**
  with a single flat `professionalTaxAmount` (₹/month, default 200) — this looks like an older/simpler
  PT model that coexists with the proper `StatutoryRule` slab engine. **Quality issue**: two sources of
  truth for PT (flat monthly figure in `PayrollConfig`/`PayrollSettings` vs. slab-based
  `StatutoryRule` used by `statutory.calc.ts`) — worth flagging to whoever owns payroll; a TN company
  using the flat toggle would compute a materially wrong (monthly, not half-yearly) PT.
- `modules/payroll/pages/LabourEntitlementsPage.tsx`: holidays tab, add-holiday by date+name only (no
  state/district picker in the UI even though `Holiday.stateCode` exists in the DB).
- `modules/compliance/pages/EwayBillsPage.tsx`, `EwayBillPanel.tsx`: e-way bill register/generation UI,
  manual trigger, no threshold-based auto-suggestion seen.
- **No i18n library anywhere** — `grep` for `i18n|react-intl|react-i18next|intl-messageformat` across
  `apps/web/package.json` and `apps/web/src` returns nothing. All UI strings are hardcoded English JSX.
  No Tamil font/bilingual invoice support of any kind.
- `modules/onboarding/steps/GstStep.tsx`, `services/gstService.ts`, `services/gstReturnsService.ts`:
  GST state-code plumbing for registration/returns; state code 33 flows through GSTIN parsing
  (`gstin.slice(0,2)`) consistently across customer/supplier/e-invoice modules — this part is solid and
  state-code-correct already.

### packages/shared

- `api-paths.ts`: `/payroll-statutory/rules`, `/labour/holidays`, `/eway-bills` — no licence/PCB paths.
- `permissions.ts`, `features.ts`: `payroll.view`, `payroll-settings.edit`, `eway-bill.*` permission
  keys exist; **no permission keys for a licence/compliance-calendar/regulatory-rules module** yet.

### Tests

- No test file found under `apps/api/test/integration` for statutory rules, PT/LWF calc, or holidays
  specifically (only implied via broader payroll tests, not confirmed — did not find a dedicated
  `statutory.spec.ts`). **Gap**: no automated test pinning the TN PT slab table or the half-yearly
  behaviour, so a future edit could silently break it.

## 2. Gaps — proposed items (ranked)

For each: name · rationale · data model · endpoints/screens · touches · size (S/M/L) · isolation.

### 1. Regulatory Rules Engine (foundation) — **rank 1, size L, needs sequencing (blocks #2–#7)**

Rationale: every item below needs a place to live; without a generic engine, TN becomes another
hardcoded array like `DEFAULT_STATUTORY_RULES`, and a second state means another code change.
Data model:

```
model RegulatoryJurisdiction {
  id, countryCode ("IN"), stateCode?, districtCode?, localBodyType? (CORPORATION|MUNICIPALITY|
  TOWN_PANCHAYAT|VILLAGE_PANCHAYAT), localBodyName?
}
model RegulatoryRule {
  id, tenantId? (null = platform default, seeded), jurisdictionId, domain (PT|LWF|MIN_WAGE|
  NFH_HOLIDAY|EWAY_THRESHOLD|PCB_CONSENT|TRADE_LICENCE|...), ruleKey, valueJson, effectiveFrom,
  effectiveTo?, sourceRef (notification/GO number), createdBy, supersedesId?
}
```

Resolution: `resolve(domain, jurisdiction, asOfDate, tenantId)` — tenant override row wins over
platform default row, most specific jurisdiction wins (district > state > country), latest
`effectiveFrom <= asOfDate` wins. Consumers: payroll statutory calc, holiday calendar, e-way bill
threshold check, compliance calendar/licence reminders. This replaces `StatutoryRule` (or
`StatutoryRule` becomes a materialized/typed view over `RegulatoryRule` for the PT/LWF domain to avoid
a risky rewrite of the working payroll calc — recommend the latter to limit blast radius).
Migration note: seed TN (33), then re-seed the 5 existing states from `DEFAULT_STATUTORY_RULES` as
`RegulatoryRule` rows with `effectiveFrom` = a documented notification date, not `now()`.

### 2. Effective-dated TN Professional Tax with local-body scoping — rank 2, size M, depends on #1

Rationale: TN PT is levied by the **local body** (corporation/municipality/panchayat) under the Tamil
Nadu Panchayats Act / District Municipalities Act / City Municipal Corporation Acts, half-yearly
(Apr–Sep due Sep, Oct–Mar due Mar), capped at ₹1,250/half-year — **materially different mechanics**
from monthly-PT states like Karnataka/Telangana where the employer remits every month to the
commercial-tax department. **VERIFY** current slab table and due dates with the accountant; the ₹1,250
half-yearly cap (₹2,500/year) is a longstanding structural fact (Article 276 caps annual PT at ₹2,500)
but exact band boundaries move by state notification.
Data model: `RegulatoryRule` rows, domain=PT, `valueJson = {slabs:[{upTo,amount}], frequency:
"HALF_YEARLY", dueDayOffset, remittanceAuthority: "LOCAL_BODY"}`; add `localBodyId` to `Company`/
`BusinessPlace` so the correct corporation/municipality is selectable (a plastics unit in Guindy vs.
one in a panchayat industrial estate remits to different offices).
Endpoints: extend existing `/payroll-statutory/rules` to accept jurisdiction+effectiveFrom instead of
just `stateCode`; `GET /payroll-statutory/rules?asOf=` for point-in-time resolution.
Screens: `StatutoryPayrollPage` gains a jurisdiction column and an "as of" history view; `PayrollSettings`
flat-PT toggle should be **deprecated/removed or reconciled** with the slab engine (quality fix, not a
new feature — flag prominently).

### 3. TN Labour Welfare Fund (LWF) contribution + annual return — rank 3, size S, depends on #1

Rationale: annual, due 31 January, employee ₹20/employer ₹40 **VERIFY** (figures used in code today
match this but the `lwfMonths: [12]` looks off — should likely be month 1 for the Jan 31 due date, or
December if the deduction happens in December's payroll for remittance by Jan 31; needs accountant
sign-off on which month the _deduction_ vs. the _remittance_ falls in).
Data model: reuse `RegulatoryRule` (domain=LWF) instead of `StatutoryRule.lwfEmployee/lwfEmployer`
columns going forward; add a `StatutoryReturn` model (state, domain, periodKey, dueDate, filedOn?,
ackNo?, fileRef) shared across PT/LWF/PF/ESI returns so the compliance calendar has one table to query
— currently `statutory.files.ts` generates files but I found no due-date/filed-tracking model.
Endpoints: `/payroll-statutory/returns` (list, mark filed, download form). Isolated: can build the
`StatutoryReturn` tracking table without touching the calc engine.

### 4. TN Minimum Wages (Plastic Industry schedule) + VDA revision — rank 4, size M, depends on #1

Rationale: TN Minimum Wages notifications define a scheduled employment for "Plastic Goods
Manufacturing" (or the applicable schedule the government has notified) with skill categories
(unskilled/semi-skilled/skilled/highly-skilled) and periodic VDA (variable dearness allowance, tied to
Consumer Price Index points) revisions, typically twice a year. **VERIFY**: exact schedule name/number
and current basic+VDA figures — these change frequently and must never be a code constant.
Data model:

```
model MinimumWageSchedule { id, jurisdictionId, scheduledEmployment ("Plastic Goods Mfg"),
  skillCategory (UNSKILLED|SEMI_SKILLED|SKILLED|HIGHLY_SKILLED), basicWage, vdaPerPoint?,
  vdaBaseIndex?, effectiveFrom, sourceRef }
```

Feeds the existing Code-on-Wages `wageCheck()` in `statutory.calc.ts` (basic+DA ≥ 50% of gross) and a
new "is this employee's basic below the notified minimum for their skill category" validator on
`EmployeePayrollConfig`/`Employee`. Add `skillCategory` field to `Employee` if absent (not confirmed
present — worth checking `Employee` model, not fully inspected here). Screens: alert in
`PayrollRun`/`PayrollSettings` when an employee's configured wage is below the current notified minimum.
Touches: payroll module, `Employee` master.

### 5. Holiday master: state + district + scheduled-employment scope — rank 5, size S, depends on #1 (light)

Rationale: TN Industrial Establishments (National and Festival Holidays) Act mandates a fixed set of
National Holidays (Republic Day, Independence Day, Gandhi Jayanti — 3, not the "9+4" figure in the
brief which likely conflates NFH count with total paid holidays a TN establishment must give,
**VERIFY exact statutory count** — commonly cited as 3 national + a state-notified list of ~9-12
festival holidays depending on the year's calendar and the establishment's declared list) plus
local variation (Pongal/Tamil New Year are TN-specific and must not appear in a Karnataka company's
default calendar).
Data model: extend `Holiday` with `jurisdictionId` (replacing/augmenting the existing nullable
`stateCode`) and `districtCode?`; add `sourceRef` for the government order. Seed a **TN default holiday
set** (platform-level, tenant can copy-and-edit) distinct from company-added ones — current model only
supports per-company rows with no "copy the state default" seed flow.
Endpoints: `POST /labour/holidays/import-defaults?jurisdictionId=` . Screens: `LabourEntitlementsPage`
holiday tab gets a jurisdiction filter and an "import TN 2027 holidays" action. Isolated — can ship
without the full rules engine by just adding the two columns and a seed script; only the "as of" history
semantics need #1.

### 6. TN Factories Act registers, licence + renewal (Form 2) — rank 6, size M, isolated-ish (needs #9)

Rationale: any plastics unit with power + 10/20 workers needs a Factories Act licence (TN Factories
Rules, Form 2), renewed annually/multi-year, plus statutory registers (Form 25 accident register, leave
register, etc.) the inspector checks. Owners currently track this on paper/Excel; a licence-expiry miss
is a real shutdown risk. **VERIFY**: current worker-count/power thresholds and renewal periodicity with
the factory's own licence copy — these are unit-specific facts, not lookup-table constants.
Data model: generic `LicenceRegister` (see item 9) with `licenceType = "FACTORIES_ACT_LICENCE"`,
`formType = "FORM_2"`, `renewalPeriodMonths`, `workerCountAtIssue`, `powerConnectedLoad`. A separate
lightweight `StatutoryRegister` model (registerType, periodKey, maintainedInApp boolean, fileRef) is
optional — many registers are physical books; the ERP's job is mainly the licence _reminder_, not
reproducing the register.
Screens: `Compliance` module gains a "Licences & Registers" page with expiry countdown, matches the
existing `EwayBillsPage`/`EInvoicePanel` compliance-module pattern.

### 7. TN Shops & Establishments registration (for offices/sales depots) — rank 9, size S, isolated

Rationale: distinct from the Factories Act licence — covers admin offices, godowns, sales offices.
Same `LicenceRegister` shape, `licenceType = "SHOPS_ESTABLISHMENTS"`. Cheap add once #9 exists.

### 8. TN NFH holiday list content — folded into #5 above (not separately ranked).

### 9. Generic Licence/Registration Register (trade licence, property tax, building licence, S&E,

Factories licence, MSME Udyam, GST — cross-reference) — **rank 7, size M, buildable in isolation now**
Rationale: this is the single highest-leverage isolated item — a plastics SME owner's single biggest
unmet need is "what renews when, who owns it, did we pay the property tax." Doesn't require the rules
engine; can ship as a flat compliance-calendar table today and be reclassified against jurisdictions
once #1 lands.
Data model:

```
model LicenceRegistration {
  id, companyId, businessPlaceId?, licenceType (TRADE_LICENCE|PROPERTY_TAX|BUILDING_LICENCE|
  FACTORIES_ACT|SHOPS_ESTABLISHMENTS|PCB_CONSENT|MSME_UDYAM|FIRE_NOC|ELECTRICAL_INSPECTORATE|...),
  issuingAuthority (local body / district / state dept name, free text + jurisdictionId once #1 lands),
  licenceNumber, issuedOn, validFrom, validTo, renewalPeriodMonths, renewalReminderDays[],
  status (ACTIVE|EXPIRING|EXPIRED|SURRENDERED), feeAmount?, lastRenewedOn?, documentUrl?, notes
}
```

Endpoints: CRUD + `/compliance/licences/expiring?withinDays=`. Screens: new `LicencesPage` under
`modules/compliance`, dashboard widget for licences expiring in 30/60/90 days (mirrors the existing
`EwayBillsPage` "about to lapse" pattern). Audit: licence register is a master, so it needs the same
audit-trigger treatment the brief mandates for masters. Permission keys: `licence.view`,
`licence.manage` to add in `packages/shared/permissions.ts`.

### 10. TN Pollution Control Board (TNPCB) consent register — rank 8, size S, depends on #9 (reuses model)

Rationale: plastics processing (injection/blow moulding, extrusion) is typically **Orange category**
(recycling/granulation units can be Red depending on process, virgin-material moulding often Green/
White in the current classification) under CPCB's categorisation adopted by TNPCB; every unit needs
Consent to Establish (CTE, one-time) and Consent to Operate (CTO, renewed every 1–5 years by category).
**VERIFY category and renewal period per the unit's actual TNPCB consent letter** — category
assignment depends on process and effluent/emission profile, not just "plastics," so this must never be
hardcoded as a single answer for all customers.
Data model: `LicenceRegistration` with `licenceType = "PCB_CONSENT_CTE"` / `"PCB_CONSENT_CTO"`, extra
fields `category` (RED|ORANGE|GREEN|WHITE), `consentValidUpTo`, `conditionsJson` (effluent/emission
limits worth tracking as compliance line items). Screens: same licences page, filterable by type.

### 11. TANGEDCO HT/LT tariff & energy-cost data model — rank 10, size M, isolated

Rationale: TANGEDCO's tariff structure (demand charges ₹/kVA, energy charges ₹/unit with time-of-day
peak/off-peak slabs, power factor surcharge/rebate, HT vs LT connection) is material for a plastics
SME's product costing (moulding machines are the dominant power draw) but the ERP has no energy-cost
capture at all today (checked `MachineOeeSnapshot`, `ProductCostSheet` — no power/kWh field found in
this pass, worth re-confirming with the production/finance researchers). **VERIFY current tariff
schedule with the unit's TANGEDCO bill** — tariff orders revise periodically (TNERC orders).
Data model:

```
model EnergyTariffSchedule { id, jurisdictionId, connectionType (HT|LT), category (e.g. HT-IB
  Industry), demandChargePerKva, energyChargeSlabsJson (time-of-day bands), powerFactorPenaltyJson,
  effectiveFrom }
model MachineEnergyReading { id, companyId, machineId, shiftId, kwhConsumed, demandKva?, powerFactor?,
  recordedAt }
```

Feeds `ProductCostSheet` (energy cost per kg/per shot) and a TANGEDCO bill-reconciliation screen.
Touches: production (Machine, Shift), finance (ProductCostSheet). Larger effort because it needs a
metering/reading capture UI on the shop floor, not just a tariff table — size L if the reading capture
is included, M if just the tariff table + manual monthly bill entry.

### 12. GST TN specifics: intra-state e-way bill threshold + state notifications — rank 6 (tie), size S,

isolated, depends loosely on #1
Rationale: confirmed via code search that **no threshold check exists today** — e-way bill generation
is manual regardless of invoice value. TN's intra-state e-way bill threshold (commonly cited at
₹1,00,000 for most goods movement within the state, separate from the pan-India ₹50,000 inter-state
threshold) should drive a **soft prompt/warning** on the sales invoice/delivery challan screen ("this
dispatch is above the TN intra-state e-way bill threshold — generate one"), not a hard block (the
brief's no-hidden-transactions rule cuts the other way too — never suppress the option below
threshold). **VERIFY current ₹ figure and the list of exempted goods/distance with the accountant** —
CBIC/TN commercial-tax department notifications revise this.
Data model: `RegulatoryRule` domain=EWAY_THRESHOLD, `valueJson={intraStateThreshold, interStateThreshold,
exemptHsnCodes[]}`. Endpoint: extend `eway-bill.service.ts` with a `shouldPrompt(invoiceValue,
fromState, toState)` helper consumed by `SalesInvoiceCreate.tsx`/`EwayBillPanel.tsx`. Small, mostly UI.

### 13. TN MSME incentives / single-window scheme register — rank 11, size S, isolated

Rationale: TN offers capital subsidy, interest subvention, and single-window clearance (Guidance TN /
TNIFMC) for MSME plastics units; tracking scheme applications and disbursement status is a light
addition to the licence register concept, useful to the owner even if it never touches statutory
compliance risk. **VERIFY current scheme names/rates** — these change with each Industrial Policy.
Data model: `LicenceRegistration` with `licenceType = "MSME_SCHEME"`, extra `schemeName`,
`sanctionedAmount`, `disbursedAmount`, `applicationStatus`. Reuses #9's model — near-zero marginal cost
once #9 ships.

### 14. Bilingual (Tamil + English) invoice/document rendering — rank 12, size M, mostly isolated

Rationale: many TN plastics buyers/vendors and factory-floor documents (wage slips, notices, the NFH
holiday list itself, safety notices) are expected or preferred in Tamil; **no i18n library exists in
`apps/web` at all today** — this is a from-scratch addition, not a config change.
Two separable pieces:
(a) **Bilingual document _content_** (invoice/payslip PDF shows Tamil labels alongside English) —
lower effort: a label-translation map consumed by the existing PDF/document renderers
(`PayslipDocument.tsx` and sales-invoice PDF generation), no UI framework change. Needs a Tamil-
capable font embedded in the PDF pipeline (verify current PDF lib supports non-Latin glyphs).
(b) **Full UI i18n readiness** (menus, forms, validation messages in Tamil) — real effort: introduce
`react-i18next` or similar, externalize strings module-by-module. Given zero current
infrastructure, recommend starting with (a) only for MVP; (b) is a multi-quarter effort better
scoped as its own initiative, not a TN-launch blocker.
Data model: none required for (a) beyond a static translation dictionary; for (b), eventually a
`translations` JSON resource per locale, out of scope for a data-model sketch here.

## 3. Sequencing summary

**Build first, no dependencies:**

- #9 Generic Licence/Registration Register (unblocks #6, #7, #10, #13)
- #12 E-way bill threshold prompt (small, standalone)
- #14a Bilingual document labels (standalone, no rules engine needed)
- Fix the PT double-source-of-truth quality issue (`PayrollSettings` flat toggle vs. `StatutoryRule`
  slabs) — not a new feature, but should be scheduled before TN customers hit it.

**Foundation, blocks several others:**

- #1 Regulatory Rules Engine — do this before #2, #3, #4, #5's jurisdiction fields, #10's category
  rules, #11's tariff schedule, #12's threshold rule storage. Recommend building #1 as an additive layer
  beside the working `StatutoryRule`/`statutory.calc.ts` (don't rewrite payroll calc in the same PR).

**Depend on #1:**

- #2 TN PT effective-dating + local-body scoping
- #3 TN LWF (mostly independent of #1 if shipped as a `StatutoryReturn` tracker only)
- #4 TN Minimum Wages + VDA
- #5 Holiday jurisdiction scoping (light dependency — can ship district/jurisdiction columns without
  full engine, then wire resolution later)

**Depend on #9:**

- #6 Factories Act licence, #7 Shops & Establishments, #10 PCB consent, #13 MSME schemes — all thin
  wrappers over the licence register once it exists.

**Standalone, larger:**

- #11 TANGEDCO tariff/energy costing — needs production-module coordination (machine readings), size L
  if shop-floor capture is included.
- #14b Full UI i18n — multi-quarter, not a TN-launch blocker.

## 4. Cross-cutting notes for whoever prioritizes

- Every rupee figure, date, and category cited above is an assumption to be confirmed by the owner's
  accountant/compliance consultant against the current live notification before it becomes a shipped
  default — this report deliberately does not present any of them as verified fact.
- The existing `DEFAULT_STATUTORY_RULES` TN entry is a good starting point but has two things worth a
  direct accountant check before the first TN customer's live payroll run: (a) the half-yearly-to-
  monthly conversion logic location, and (b) the LWF `lwfMonths: [12]` vs. the Jan-31 due date.
- Nothing proposed here creates a parallel/hidden ledger; licence, holiday, and tariff data are all
  reference/master tables that inform compliance reminders and costing — no transaction visibility is
  reduced or made conditional on them.
