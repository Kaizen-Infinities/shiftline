Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Regulatory & licence compliance beyond GST — research report

## 1. Inventory (what exists today)

### GST returns / filings gate

- `apps/api/src/modules/gst-returns/` — `gstr1.service.ts`, `gstr2b.service.ts`, `gstr3b.service.ts`,
  `gstr9.service.ts`, `gstr2b.parse.ts`, `gst-period.ts`, **`compliance.service.ts`** (the generic
  compliance calendar), `gst-returns.routes.ts`.
- `apps/api/src/modules/gst/` — `gst.service.ts`, `gst.calc.ts`, `gst.context.ts`, `gst.controller.ts`,
  `gst.routes.ts` (GST setoff/computation, not returns per se).
- Generic **filings registry**: `packages/shared/src/filings.ts` — `FILINGS: FilingDef[]`, each with
  `key, name, authority ("GST"|"INCOME_TAX"|"EPFO"|"ESIC"|"STATE"|"MCA"), cadence, perBusinessPlace`.
  Currently: GSTR1/1A/3B/9, IMS, ITC04, TDS 26Q/27Q/24Q/challan, MSME_1, PF_ECR, ESI_MONTHLY,
  PT_RETURN, PAYROLL_RUN.
- Generic **approval gate model**: `FilingApproval` (schema.prisma:219) — `companyId, filingType,
periodKey, businessPlaceId?, status (DRAFT|PENDING|APPROVED|REJECTED|SUBMITTED), payloadHash,
summary Json, notes, prepared/approved/submitted by+at, submissionRef, history Json`. Unique on
  `[companyId, filingType, periodKey, businessPlaceId]`. **This is the reusable model for any new
  statutory filing** (EPR return, licence renewal is a poor fit since it's not periodic-return
  shaped, but EPR quarterly/annual returns fit perfectly).
- **Compliance calendar**: `apps/api/src/modules/gst-returns/compliance.service.ts` — `DUE_RULES:
Record<filingKey, {day, monthsAfter}>` drives a rolling calendar (`calendar()`), matched against
  `FilingApproval` rows for status, and a daily nudge job (`warnUpcoming`, `sweepAllTenants`) that
  notifies 7 and 2 days before each due date via `notify()` (category `"filings"`, permission
  `filings.prepare`), deduped by an existing `Notification` with the same `link`.
  Scheduled via pg-boss: `apps/api/src/jobs/compliance.job.ts` → `QUEUES.COMPLIANCE_CALENDAR`,
  registered in `apps/api/src/jobs/index.ts`. Unit test: `test/unit/compliance-calendar.spec.ts`.
  **This is exactly the mechanism to extend for EPR returns and for a generic licence-expiry
  calendar** — either by adding EPR to `FILINGS`/`DUE_RULES` (return-shaped), or by building a
  parallel `LicenceRegister` + its own nudge job for non-periodic renewal-shaped items (CTE/CTO,
  Factory licence, Fire NOC, ISO, BIS, FSSAI, insurance, vehicle documents).

### MSME (43B(h))

- `apps/api/src/modules/msme/msme.service.ts`, `msme.routes.ts`. Migration
  `20260912160000_msme_43bh`. Job `apps/api/src/jobs/msme.job.ts` → daily sweep, same `notify()`
  pattern. Test: `test/integration/msme.spec.ts`. This module is about payment-date compliance for
  MSME suppliers (section 43B(h)), **not** Udyam registration/licence tracking itself — Udyam
  registration number/validity is not modelled anywhere (grep for "udyam" returns nothing).

### Retention

- `apps/api/src/modules/retention/` — `retention.policy.ts` (per-data-class rules: BOOKS, FILINGS,
  PAYROLL, AUDIT_LOGS, EOD_SNAPSHOTS, SESSIONS, LOGIN_ATTEMPTS, SYNC_TOMBSTONES, AGENT_POSITIONS —
  all 8-financial-year floor for books-adjacent classes, non-purgeable), `retention.service.ts`,
  `retention.controller.ts`, `retention.routes.ts`. Job `apps/api/src/jobs/retention.job.ts`. Test
  `test/integration/retention.spec.ts`. A new `LICENCE_DOCUMENTS` / `EPR_RETURNS` data class should
  be added here when those modules exist (statutory certificates should never be purged).

### Company / BusinessPlace (registration context)

- `Company` model (schema.prisma:535): `gstin, tan, pan, gstRegistrationType, stateCode`, address
  fields, `slug`, `isOnboarded`. No CIN, no factory licence no., no Udyam number, no IEC, no
  pollution-control consent fields — company master has zero fields for any of these registrations.
- `BusinessPlace` model (schema.prisma:766): `companyId, code, name, type (BusinessPlaceType),
gstPlaceCode, gstin, isHeadOffice, address Json`, and is the anchor for most transactional
  documents (`salesInvoices, grnInvoices, vouchers, expenses, ...` all relate to it). **This is the
  natural anchor for site-level licences** (a factory's CTE/CTO, fire NOC, factory licence are
  per-BusinessPlace/per-site, not per-company) — a new `Licence` model should FK to `BusinessPlace`
  (nullable, falling back to company-level for company-wide certs like ISO/IEC/Udyam).
- `apps/api/src/modules/company/` exists (company.controller/service/routes) for company master CRUD.
- No `businessPlace` module folder found separately from schema — BusinessPlace CRUD lives inline
  somewhere in company or a masters module (not fully explored; not load-bearing for this report).

### Documents module — NOT a file-storage module

- `apps/api/src/modules/documents/` = `document-number.service.ts`, `documents.controller.ts`,
  `documents.routes.ts` — this is a **document numbering sequence** service (invoice/voucher number
  series via `DocumentSequence` model, schema.prisma:3453), unrelated to file/certificate storage.
  Do not confuse with a document vault.

### File upload pattern (how uploads work today)

- `apps/api/src/middleware/upload.middleware.ts` — multer-based, three exports:
  - `uploadProductImage`: disk storage in dev (`uploads/products/` under cwd), **memory storage in
    production** (because prod runs on Vercel, read-only FS) — MIME allow-list
    `image/jpeg|png|webp`, 5 MB limit.
  - `uploadEmployeePhoto`: always memory storage (comment says "Cloudinary upload in controller" —
    implying photos are pushed to Cloudinary from the controller layer in prod).
  - `uploadInvoiceImage`: memory storage, allows images + `application/pdf`, 5 MB limit — **this is
    the closest existing pattern for uploading a certificate PDF** (CTE/CTO copy, EPR certificate,
    ISO cert).
  - No S3/blob storage helper found under `src/lib` (`find -iname "*storage*" -o -iname "*s3*"`
    returned nothing) — actual persistence target for memory-storage uploads in production was not
    found in this pass; likely Cloudinary (per the employee-photo comment) or a not-yet-committed
    storage lib. **A generic "document vault" module should reuse `uploadInvoiceImage`'s
    memory-storage + PDF-allowed pattern** and confirm/introduce a single storage abstraction
    (dev: disk under `uploads/<domain>/`, prod: Cloudinary or S3) rather than adding a fourth
    bespoke multer config.
- `apps/api/src/modules/product-image/` (`product-image.controller/service/routes/validation.ts`)
  is the canonical CRUD-around-an-uploaded-file example: `POST /` takes `multipart/form-data`
  (`uploadProductImage.single("image")` → `normalizeImageBody` → validate → controller stores
  `imageUrl` string on `ProductImage` row linked to `productId`, with an `isPrimary` flag pattern
  worth reusing for "primary/latest certificate version").

### Notifications

- `apps/api/src/modules/notifications/notify.ts` — generic `notify({category, title, body, link,
to: {permission} | {userId}, level})` used by both `compliance.service.ts` and `msme.job.ts`.
  This is the notification primitive any new expiry-reminder job should call directly — no new
  notification infrastructure needed.

### Gaps confirmed (nothing found)

- No EPR / CPCB / Plastic Waste Management model, module, route, job, or test anywhere in the repo
  (`grep -riE "epr|cpcb|plastic.?waste|pollution|consent|hazardous"` across `src/` and
  `prisma/schema.prisma` returns nothing beyond ordinary English word collisions).
- No licence/certificate register (Factory Act licence, fire NOC, Udyam number, IEC, ISO, BIS,
  FSSAI) anywhere.
- `Product` (schema.prisma:961) and `RawMaterial` (schema.prisma:1246) have no polymer/plastic
  fields at all — no `polymerType`, no `plasticCategory` (rigid/flexible/multilayer/compostable),
  no `recycledContentPct`. `Product.weightPerPiece` + `weightUom` exist (used for BOM/costing) and
  are directly reusable as the "weight per unit" input an EPR return needs.

---

## 2. Gaps — proposed features

Ranked roughly by value to a plastics SME owner/accountant/plant manager. S/M/L = rough size.

### EPR (Plastic Waste Management Rules)

1. **EPR product master fields** — S — rationale: EPR return math is per-SKU category × weight ×
   volume sold; without these fields on the product record every return is a manual spreadsheet.
   Data model: add to `Product` (and optionally `RawMaterial` for packaging inputs bought, not just
   sold): `plasticCategory` enum (`CAT_I_RIGID | CAT_II_FLEXIBLE | CAT_III_MULTILAYER |
CAT_IV_COMPOSTABLE | NOT_APPLICABLE`), `polymerType` String (PP/HDPE/LDPE/PVC/PET/multi...),
   `recycledContentPct` Decimal(5,2), `isPlasticPackaging` Boolean. Reuses existing
   `weightPerPiece`/`weightUom`. Touches: `product` module, `product.validation.ts`,
   product screen forms. Isolated (additive columns), no cross-domain dependency.

2. **EPR registration record** — S — CPCB producer/brand-owner/importer (PIBO) registration number,
   category, validity, state EPR registration where applicable. Model: `EprRegistration
{id, companyId, registrationNo, role (PRODUCER|BRAND_OWNER|IMPORTER|PWP), category[],
validFrom, validTo, cpcbPortalId, status, documentId (FK to vault)}`. Touches: new `epr` module,
   `company` module (display on company profile). Isolated.

3. **EPR obligation & return engine** — L — the core deliverable: compute the tenant's annual/
   quarterly extended producer responsibility target by category from actual sales dispatches
   (`GoodsDispatchItem`/`SalesInvoiceItem` × `Product.plasticCategory` × `weightPerPiece`),
   compare against `recycledContentPct` obligations (Cat I: 30%, Cat II: none by weight but
   recycling target, etc. — configurable via a rates table since CPCB revises these), and produce
   the return payload. Model: `EprReturn` reusing the `FilingApproval` pattern — add `EPR_ANNUAL`
   / `EPR_QUARTERLY` to `FILINGS` registry (`authority: "STATE"` or a new `"CPCB"` authority) and
   `DUE_RULES`, so it appears in the existing compliance calendar for free. A
   `EprReturnLine {returnId, category, polymerType, weightSoldKg, weightImportedKg,
recycledContentAchievedPct}` breakdown table computed from dispatch data, editable before
   submit. Endpoints: `GET /epr/returns/:period/preview` (compute from dispatches),
   `POST /epr/returns/:period/submit` (through the same approval gate as GST). Screens: EPR return
   preview/approve screen mirroring the GSTR1/3B screens. Touches: gst-returns' compliance
   calendar/`FilingApproval` pattern, `sales`/`goods-dispatch` modules (read-only), `product`
   module. Needs sequencing: depends on gap #1 (product fields) and ideally on a category-rate
   table (small seed data, low risk).

4. **EPR certificate (credit) purchase & retirement tracking** — M — many small producers meet
   recycling obligations by buying EPR certificates from registered recyclers/processors rather
   than recycling themselves; CPCB portal requires tracking certificate purchase and retirement
   against the category obligation. Model: `EprCertificatePurchase {id, companyId, category,
quantityKg, sellerName/PWPRegistrationNo, certificateNo, purchaseDate, retiredAgainstReturnId,
amount, documentId}`. Endpoints/screens: simple ledger + linkage into the return computation in
   #3 (reduces the shortfall). Touches: #3, document vault (#13). S/M.

5. **Registered plastic waste processor (PWP) linkage/master** — S — a lightweight supplier-like
   master of recyclers/processors the company sends waste to or buys certificates from, with their
   CPCB registration number and validity, so #4 and hazardous-waste manifests (#8) can reference a
   vetted entity rather than free text. Model: `WasteProcessor {id, companyId, name,
cpcbRegistrationNo, registrationValidTo, wasteTypesHandled[], address}`. Reuses the
   `Supplier`-style address/contact shape. Isolated, small.

6. **Automatic EPR data feed from production/sales** — M — rather than a one-off "preview" button,
   a scheduled/near-real-time aggregation job (pg-boss) that rolls up dispatched-quantity ×
   category × weight per period as sales post, keeping a running `EprPeriodAccrual` summary table
   so the annual return isn't a cold 12-month table scan at filing time. Optional; can ship #3
   without it and add later. Touches: `sales`/dispatch posting hooks, new job. Depends on #1, #3.

### Pollution control & hazardous waste

7. **PCB Consent (CTE/CTO) register with expiry reminders** — M — Consent to Establish / Consent
   to Operate from the State Pollution Control Board is the single most consequential recurring
   renewal for a plastics processor (extrusion/moulding is a "red/orange category" activity in most
   states) — lapse = production stoppage risk. Model: `PcbConsent {id, companyId,
businessPlaceId?, consentType (CTE|CTO|CONSOLIDATED), consentNo, category (RED|ORANGE|GREEN|
WHITE), validFrom, validTo, conditionsSummary, boardName, documentId, status}`. Reuses the
   generic **licence & certificate register** in #12 rather than being a bespoke model — see #12.
   Endpoints/screens: part of the generic register UI, filtered by type. Depends on #12 (or ships
   as the first concrete row-type of it).

8. **Hazardous waste (Form 4 / manifest) tracking** — M — plastics recycling/extrusion generates
   used oil, solvents, contaminated packaging tracked under Hazardous and Other Wastes (Management)
   Rules; Form 4 (annual return) and Form 10 (manifest for transport) are commonly missed. Model:
   `HazardousWasteEntry {id, companyId, businessPlaceId, wasteCategory (per HW Rules Schedule),
quantityGeneratedKg, quantityDisposedKg, disposalMode, transporterName, manifestNo,
processorId (FK WasteProcessor #5), entryDate}` + annual `Form4Return` folded into the
   `FilingApproval` pattern (`authority: "STATE"`, key `HAZWASTE_FORM4`, cadence ANNUAL). Touches:
   #5, #12/compliance calendar. Depends on #5, #12.

### Generic licence & certificate register

9. **Licence & Certificate register (core generic model)** — L, and **do this before/alongside
   #7, #8, #10** since they're all just row-types of it — rationale: a plastics SME juggles a dozen
   heterogeneous renewal-dated documents (Factory Act licence, Fire NOC, Udyam, IEC, ISO 9001/14001,
   BIS licence IS 14534/IS 10146, FSSAI, insurance policies, vehicle RC/permit/insurance/PUC, EPR
   registration, PCB consent) each on its own clock; today none are tracked anywhere and expiry is
   discovered when an auditor/inspector asks. Model:
   `Licence {id, companyId, businessPlaceId?, type (enum: FACTORY_LICENCE|FIRE_NOC|UDYAM|IEC|
ISO_9001|ISO_14001|ISO_45001|BIS_14534|BIS_10146|FSSAI|PCB_CTE|PCB_CTO|EPR_REGISTRATION|
INSURANCE|VEHICLE_RC|VEHICLE_PERMIT|VEHICLE_INSURANCE|VEHICLE_PUC|OTHER), customTypeLabel?,
issuingAuthority, registrationNo, issuedOn, validFrom, validTo?, renewalLeadDays (default per
type), status (ACTIVE|EXPIRING|EXPIRED|RENEWAL_IN_PROGRESS|LAPSED), responsibleUserId,
documentId (FK to vault #13), notes}`. `@@index([companyId, validTo])` for the reminder scan.
   Endpoints: `GET/POST/PUT /licences`, `GET /licences/expiring?withinDays=`. Screens: a register
   list (grouped by type, colour-coded by days-to-expiry) + a detail/renew form. Permission keys:
   `licences.view`, `licences.manage`. Touches: `company`/`business-place` (FK), document vault
   (#13), notifications. This is **isolated and buildable first** — everything else (#7, #8, #10)
   becomes "seed a Licence row of this type" rather than a new table.

10. **Licence expiry reminder job** — S — daily pg-boss job (mirrors `compliance.job.ts`/
    `msme.job.ts` exactly): scan `Licence` rows where `validTo` falls within `renewalLeadDays` (or
    fixed 60/30/7-day ladder like `WARN_DAYS`), `notify()` the `responsibleUserId` or a
    `licences.manage` permission holder, dedupe by an existing notification with the same link, one
    extra nudge into "overdue" state past `validTo`. Depends on #9. Trivial once #9 exists.

11. **Type-specific reference fields for BIS/FSSAI/ISO** — S — thin: BIS licences carry an IS
    standard number and product scope (IS 14534 recycled plastics, IS 10146 food-contact plastics),
    FSSAI carries a licence category (Basic/State/Central) and premises ID, ISO carries scope and
    certifying body/accreditation. Rather than a wide sparse table, a `Licence.details Json` field
    (typed per `type` in the validation schema) keeps #9 generic while still capturing these.
    Folds into #9, no separate migration.

### Compliance calendar unification

12. **Unify the compliance calendar across GST/TDS/PF/ESI/PT (existing) + EPR (#3) + licences (#9)
    - insurance/vehicle renewals** — M — today `compliance.service.ts` only reads `FILINGS` (return-
      shaped, periodic) and `FilingApproval`. Licences are renewal-shaped (a validity window, not a
      monthly/quarterly cycle) so they don't fit `DUE_RULES` cleanly. Extend `calendar()` to also pull
      from `Licence.validTo` (via #9) as a second due-item source, tagged `source: "FILING" |
"LICENCE"`, each carrying a `responsibleUserId`/`status`, merged and sorted with the existing
      statutory rows into one `GET /compliance/calendar` response and one screen. Depends on #9;
      additive to existing `compliance.service.ts`, so low risk of regressing GST calendar tests.

13. **Document vault for certificates (tenant-scoped storage)** — M — every gap above (#2, #4, #7,
    #8, #9) wants to attach a PDF/photo of the actual certificate. Reuse the `uploadInvoiceImage`
    multer config (memory storage, image+PDF, 5 MB) as the base, add a generic `Document`
    (careful: name collides with `DocumentSequence` — call it `VaultDocument` or `CertificateFile`)
    model: `{id, companyId, ownerType (LICENCE|EPR_REGISTRATION|EPR_CERTIFICATE|WASTE_MANIFEST|
OTHER), ownerId, fileUrl, fileName, mimeType, sizeBytes, version, uploadedBy, uploadedAt}`,
    versioned like `ProductImage.isPrimary` (latest version flagged). Confirm/establish the actual
    production storage backend (Cloudinary per the employee-photo comment, or S3) as part of this
    work rather than inventing a fourth ad hoc path — this was not conclusively found in this pass
    and should be checked (`grep -r cloudinary`, check env vars) before implementation. Touches:
    upload middleware, new `document-vault` module, `licence` module (#9), `epr` module. This is
    a dependency several other gaps want, but each can ship with a plain `documentId: String?`
    column and backfill once the vault exists — so it does **not** block #9/#2/#4/#7/#8, just
    completes them.

14. **Retention class for licences/EPR/vault documents** — S — add `LICENCES` / `EPR` (and maybe
    `VAULT_DOCUMENTS`) to `RETENTION_CLASSES` in `retention.policy.ts` — non-purgeable, 8-year floor
    like `FILINGS`/`BOOKS`, since these are exactly the records an inspector or CPCB audit will ask
    for after the fact. Trivial addition once #9/#3/#13 exist.

15. **Company/BusinessPlace registration fields** — S — add read-only reference fields so the
    company profile screen shows registration numbers at a glance without opening the register:
    `Company.cin`, `Company.udyamNumber`, `Company.iecCode` (company-wide), and
    `BusinessPlace.factoryLicenceNo`/`fireNocNo` as denormalized "current" pointers into `Licence`
    (or simply drop these — #9's register is the source of truth and a company-profile "summary"
    widget can just query `Licence` filtered by type, avoiding duplicate-source-of-truth risk).
    Recommend the query-based summary over new columns; listed only because the brief calls out
    "company/business places" — likely **not needed** as separate columns given #9 exists.

---

## 3. Sequencing

**Build in isolation, any order, low cross-domain risk:**

- #1 EPR product master fields (additive columns on `product`/`raw-material`)
- #9 Licence & certificate register (new module, FKs only to `company`/`business-place`)
- #5 Waste processor master (new module, `Supplier`-shaped)
- #13 Document vault (new module; needs the storage-backend question resolved first)
- #14 Retention classes (one-line additions to an existing config object)

**Needs sequencing (depends on something above):**

- #10 Licence expiry job → after #9 (same pattern as `compliance.job.ts`/`msme.job.ts`, trivial once #9 exists)
- #2 EPR registration record → can ship standalone, but is more useful once #13 (vault) exists for the certificate copy
- #3 EPR return engine → after #1 (product fields); reuses `FilingApproval`/`FILINGS` from gst-returns, so also implicitly depends on understanding that existing pattern (already inventoried above)
- #4 EPR certificate purchase/retirement → after #3 (feeds the return shortfall calc) and benefits from #5
- #6 Automatic EPR accrual feed → after #1 and #3; optional, can defer
- #7 PCB consent → best implemented as rows of #9 rather than a bespoke model; depends on #9
- #8 Hazardous waste Form 4 → depends on #5 and #9/#12 (compliance calendar) for the annual return
- #11 Type-specific detail fields (BIS/FSSAI/ISO) → fold into #9's `details Json`, no separate step
- #12 Unified compliance calendar → after #9 (extends `compliance.service.ts` to read `Licence` in addition to `FilingApproval`)
- #15 Company/BusinessPlace summary fields → after #9, and likely skippable (query-based instead)

**Recommended build order:** #9 (register) → #1 (product fields) → #10 (expiry job) → #12 (unify
calendar) → #13 (vault) → #3 (EPR engine, add to `FILINGS`) → #5 → #4 → #2 → #7/#8 (as register
rows) → #6, #11, #14, #15 as polish.
