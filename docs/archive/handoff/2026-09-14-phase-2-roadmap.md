# Phase 2 roadmap — the plan, not a status report

Phase 1 closed out in `2026-09-12-phase-1-complete.md`. Eleven domain research reports were
commissioned against the Phase 1 codebase to find what a plastics-sector ERP still needs; they
live unchanged in `docs/research/phase-2/`. This note turns them into a build plan.

## a) Product thesis

Shiftline is the complete system of record for an Indian secondary-sector manufacturer, starting
with plastics processors in Tamil Nadu — one login that replaces the notebook, the WhatsApp
group and three spreadsheets a shop-floor owner currently runs the business on. Every rupee,
every shift, every mould and every filing is recorded once and stays recorded: production,
stock, sales, purchase, payroll and statutory compliance all post to the same books. The product
wins by making compliance the easy path — GST, e-invoice, EPR, labour law and TNPCB obligations
computed from data already entered, not re-keyed at deadline panic — so the owner's incentive is
to keep using it, not to work around it. Tamil Nadu goes first because its professional tax,
labour welfare fund, minimum wages and factory registers are concrete enough to build against
today; the regulatory engine (P2-17) is written so a second state is a data pack, not a rewrite.
The long-run bet is that a plastics SME run on Shiftline is more bankable, more auditable and
faster to inspect than one run on paper, and that this — not evasion — is what an SME owner will
pay a monthly subscription for.

## b) Phase 2 packages

Sizes: S ≤ 2 days, M ≈ 3–5 days, L ≈ 1–2 weeks of one build agent's time, matching the P0/P1
convention. "Wave" groups packages that can be built in parallel; a package in a later wave
depends on something a wave-1 (or earlier) package produces. Wave 1 packages are being built now.

### Wave 1 (in progress)

| id    | name                                      | domain     | scope                                                                                                                                                                                                                                                                                                                                           | size | depends on                                | wave |
| ----- | ----------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------- | ---- |
| P2-01 | Multi-store stock ledger                  | Materials  | Multi-store raw-material stock ledger, inter-store transfers, UOM conversion table wired everywhere UOM is a free string, and the `store-type` module fix (dead/broken end-to-end, no tenant scoping today).                                                                                                                                    | L    | none                                      | 1    |
| P2-02 | Consumables, packaging & BOM versioning   | Materials  | Consumables/spares register distinct from `RawMaterial`, packaging materials as a first-class item type with FG-side BOM, BOM versioning with effective-dating and nested BOM/scrap %, and barcode/QR label generation for bag-level stock moves.                                                                                               | M    | P2-01 (store/UOM model)                   | 1    |
| P2-03 | Moulds & tooling                          | Production | Mould/die master (cavities, shot life, ownership), shot counter fed from production records, mould change log, mould maintenance/cleaning schedule, customer-owned mould register for job work.                                                                                                                                                 | L    | none                                      | 1    |
| P2-04 | Machine maintenance                       | Production | Maintenance schedules and breakdown tickets, downtime-reason master, preventive-maintenance work orders, MTBF/MTTR reporting, and the permission fixes on `production-wastages.*` and `dashboard` routes flagged as bugs in the production report.                                                                                              | L    | none                                      | 1    |
| P2-05 | Quality                                   | Quality    | QC parameter master per product, inspections including incoming-goods (GRN) gate, NCR/CAPA workflow, customer-complaint linkage, Certificate of Analysis generation, instrument calibration register, rejection Pareto and cost-of-poor-quality dashboard.                                                                                      | L    | P2-04 (shared reason/defect codes)        | 1    |
| P2-06 | Payroll statutory wiring                  | HRMS       | Wire the existing PF/ESI/PT/LWF calculators into the live payroll run, reconcile the Labour Code overtime-ceiling engine with the payroll run, leave-application/approval workflow, and the automatic monthly leave-accrual job.                                                                                                                | M    | none                                      | 1    |
| P2-07 | Workforce registers                       | HRMS       | Tamil Nadu Factories Rules inspector registers (muster roll, wages, OT, fines, deductions, advances), contract-labour/contractor master with licence tracking, safety-incident register, employee document vault, skills/training register, department hierarchy, and employee self-service (view-only) portal.                                 | L    | P2-06                                     | 1    |
| P2-08 | Receivables & credit control              | Finance    | UPI/QR on invoice and payment-voucher print, automated dunning with scheduled reminders, credit-check enforcement extended to invoice and dispatch (not just sales order), balance-confirmation letters, supplier-side advance payments, interest on delayed customer payments.                                                                 | M    | none                                      | 1    |
| P2-09 | Treasury                                  | Finance    | 13-week cash-flow forecast, loan/EMI register with amortisation and BRS auto-match, generic bank-statement column-mapping importer, recurring/standing vouchers, cheque printing, cash-denomination register, multi-bank cash-position and ratio-analysis dashboards.                                                                           | M    | none                                      | 1    |
| P2-10 | Procurement                               | Purchase   | GRN permission-gate and status-enum fix, purchase requisition/indent, RFQ and quotation comparison, blanket/rate contracts with call-off tracking, supplier kinds (broker/DCA, scrap-RCM unregistered-dealer purchases), multi-level PO approval with amendment history, three-way match (PO/GRN/invoice), supplier rating and spend analytics. | L    | none                                      | 1    |
| P2-11 | Logistics & gate                          | Logistics  | Vehicle/driver master, gate entry/exit register and gate passes, weighbridge slip capture, freight-rate master and LR/freight-bill tracking, returnable-packaging ledger, mobile proof-of-delivery capture, dispatch-planning board.                                                                                                            | M    | none                                      | 1    |
| P2-12 | CRM                                       | Sales      | Leads/enquiry pipeline, first-class Quotation entity split from `SalesOrder`, price lists and customer/grade-specific pricing with discount schemes, sales commission/brokerage tracking for agents, sample-request tracking, customer 360 ledger view.                                                                                         | M    | none                                      | 1    |
| P2-13 | Order-to-cash                             | Sales      | Sales-linked delivery notes, proforma invoice as a first-class flow, packing-list carton breakdown, order-status board, cash-sales/B2C counter mode, customer order-status visibility link.                                                                                                                                                     | M    | P2-12                                     | 1    |
| P2-14 | Licences & EPR                            | Compliance | Generic licence/registration register with expiry alerts, unified compliance calendar (GST/TDS/PF/ESI/PT/EPR/licences), EPR product fields + CPCB registration + obligation/return engine + certificate tracking, PCB consent register, hazardous-waste manifest tracking.                                                                      | L    | none                                      | 1    |
| P2-15 | Approvals, alerts & digest                | Platform   | Generic approval-matrix engine (doc type × amount × role chain), delegation, one approval inbox, notification-channel preferences, threshold-based alert-rules engine, owner daily digest (WhatsApp/email).                                                                                                                                     | M    | none                                      | 1    |
| P2-16 | Energy & utilities                        | Logistics  | Meter master and shift-wise reading capture, DG-vs-grid split and DG running-hours/fuel log, electricity-bill tracking with TANGEDCO tariff concepts, cost-per-kg-produced feed into costing, power-factor/demand alerting.                                                                                                                     | M    | none                                      | 1    |
| P2-17 | Regulatory rules engine, Tamil Nadu first | Compliance | The effective-dated rules engine every TN statutory item hangs off: Professional Tax (half-yearly, local-body scoped), Labour Welfare Fund, Minimum Wages + VDA for the plastics schedule, state/district NFH holiday master, intra-state e-way-bill threshold, bilingual Tamil document rendering.                                             | L    | none (foundation; P2-06/07/13 consume it) | 1    |
| P2-18 | Integration-test backfill, legacy A       | Platform   | Backfill `test/integration/<module>.spec.ts` (happy path + validation rejections + cross-tenant isolation) for legacy modules with zero or thin coverage: `machine`, `production-order`, `hourly-production`, `production-wastage`, `oee`, `weekly-machine-program`, `daily-production-plan`, `store-type`.                                     | M    | none                                      | 1    |
| P2-19 | Integration-test backfill, legacy B       | Platform   | Same backfill for the remaining legacy modules flagged thin across the other ten reports (dashboard, reports, supplier, GRN, sales-order edge cases, employee/payroll edge cases) — split from P2-18 so it can run in parallel.                                                                                                                 | M    | none                                      | 1    |

### Wave 2 (planned, not yet built)

| id    | name                                                | domain            | scope                                                                                                                                                                                                                                   | size | depends on                                      | wave |
| ----- | --------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------- | ---- |
| P2-20 | Owner dashboard & daily brief                       | Platform          | The "needs attention" list, cash position with forecast, production-vs-plan, machine status board, rejection %, receivables ageing, GST dues this week, attendance-today, power cost, owner-settable KPI targets, mobile-friendly view. | L    | P2-04, P2-05, P2-08, P2-09, P2-15, P2-16, P2-17 | 2    |
| P2-21 | Batch/lot tracking & inventory operations           | Materials         | Batch/lot tracking with expiry for raw materials, first-class Material Requisition & Issue document, physical/cycle-count workflow, reorder-suggestion job, standard inventory reports (valuation, ageing, slow/non-moving).            | L    | P2-01                                           | 2    |
| P2-22 | MRP, capacity planning & WIP ledger                 | Production        | Formal MRP run (BOM explosion net of stock and open POs) with purchase suggestions, machine-load capacity planning/what-if scheduler, WIP stage ledger replacing the free-text production-step fields.                                  | L    | P2-01, P2-03, P2-04                             | 2    |
| P2-23 | Scrap/regrind conversion & job-work reconciliation  | Materials         | Scrap/regrind store with automatic regrind-to-raw-material conversion, job-work-out yield/wastage reconciliation report per job worker.                                                                                                 | M    | P2-01                                           | 2    |
| P2-24 | ESS write actions, biometric attendance & rostering | HRMS              | Employee self-service write actions (apply leave, expense claims), biometric/device attendance import, shift roster/rotation planner, overtime-authorisation workflow.                                                                  | M    | P2-06, P2-07                                    | 2    |
| P2-25 | Report builder & scheduled exports                  | Platform          | Generic report builder, scheduled report delivery, Excel export wired into every existing report screen.                                                                                                                                | M    | none                                            | 2    |
| P2-26 | Mobile field apps                                   | Platform          | Driver proof-of-delivery app, supervisor shift-entry app, owner mobile app — native shells over the existing mobile sync foundation (P0-11).                                                                                            | L    | P2-11, P2-20                                    | 2    |
| P2-27 | Customer/supplier portals                           | Sales/Purchase    | External-facing portal: customers see order/invoice/payment status, suppliers see PO/GRN/payment status.                                                                                                                                | L    | P2-12, P2-13, P2-10                             | 2    |
| P2-28 | Multi-branch consolidation                          | Materials/Finance | Inter-branch stock transfer with e-way bill, consolidated multi-branch/godown reporting.                                                                                                                                                | M    | P2-01                                           | 2    |
| P2-29 | IoT machine connectivity                            | Production        | OPC-UA/Modbus gateway for automatic shot-count and energy capture, replacing manual entry in P2-03/P2-04/P2-16.                                                                                                                         | L    | P2-03, P2-04, P2-16                             | 2    |
| P2-30 | AI assistant over tenant data                       | Platform          | Natural-language questions over a tenant's own data and anomaly flags, using the existing `@anthropic-ai/sdk` dependency; answers are read-only and tenant-scoped like every other query.                                               | M    | P2-20 (shares its data model)                   | 2    |

### Backlog (not yet scheduled — grouped by domain, one line each)

Everything below is a gap item from the research reports not folded into a Phase 2 package above.
Sizes are as estimated in the source report; pull items into a wave when their dependencies land.

**Finance** (`docs/research/phase-2/finance.md`)

- E-invoice bulk generation / bulk cancel across documents (S)
- E-way bill auto-generation on dispatch threshold, if not already triggered (S)
- GST rate change effective-dating for `GstRate`/`HsnCode.gstRate` (S)
- Cash sales / cash purchase quick-entry workflows (S)
- Financial-year lock hard-stop audit across all posting paths (S)
- MSME payment-prioritisation queue on top of `msme.service.ts` (S)
- Document retention/archival for finance documents beyond DB rows (S)
- Profitability by customer and by product, beyond `ProductCostSheet` (M)

**HRMS** (`docs/research/phase-2/hrms.md`)

- Employee↔User account link (server-side foundation for P2-24's biometric import) (M)
- Full-and-final settlement → payroll/advances reconciliation UI (M)
- Salary-advance repayment schedule (instalments) (S)
- Recruitment/onboarding pipeline for shopfloor hires (M)
- PF/ESI/PT/LWF employee master-data completeness pre-run gate (S)
- Multi-state professional tax by employee work-state, not company-state (M)
- Form 16 Part B generation + 24Q file writer wiring (M)
- Payroll cost dashboard by department/machine-line (S)
- Fixed-term/contract employee type distinctions surfaced in UI (S)
- Notice-period / exit workflow before settlement (S)

**Materials** (`docs/research/phase-2/materials.md`)

- Bin/location putaway for finished goods and products (S)
- Negative-stock guardrail enforcement (`Store.allowNegative` actually used) (S)
- Non-moving/expiry alert job for batched materials (S, depends on P2-21)

**Production** (`docs/research/phase-2/production.md`)

- Changeover/setup-time (SMED) tracking, actual vs planned (M)
- Cycle-time standards & actual-vs-standard variance, replacing the static `Machine.cycleTime` (M)
- Downtime-driven maintenance auto-ticket + machine availability calendar (S, depends on P2-04)
- Operator productivity report (output/reject per operator per shift) (S)
- Rejection-reason & downtime Pareto / top-5 loss report (S, depends on P2-04's reason master)
- Shift handover note / shift log (S)
- Cost-per-piece production costing bridge (standard vs actual, RM + labour + energy) (M)

**Purchase** (`docs/research/phase-2/purchase.md`)

- Approved Supplier List / supplier status & category (S)
- Landed-cost allocation beyond imports (freight/duty apportionment to stock) (M)
- Bill of Entry web screens for the existing import backend (S)
- Job worker ↔ Supplier unification or linkage (S)
- Capital-goods purchase register with ITC tracking, GRN→asset auto-draft (S–M)
- Payment-terms/due-date dashboard extended to all suppliers, not just MSME (S)
- Supplier document management (certificates, agreements, bank-change proof) (S)
- Supplier bank-account change control (maker-checker) — fraud-prevention fix (S)
- Purchase of services/expenses vendor rate card (S)
- PO/GRN delivery-performance & short-close report (S)
- Debit-note numbering & GSTR-2B-style reconciliation for purchase returns (S)
- Multi-currency PO/GRN for import purchases beyond Bill of Entry (M)
- Supplier segmentation / spend analytics (ABC/Pareto) — folded partly into P2-10, remainder here (S)

**Quality & maintenance** (`docs/research/phase-2/quality-maintenance.md`)

- ISO 9001 document-control lite (M)
- Spare-parts inventory link from maintenance work orders (M, depends on P2-04 + P2-01)
- Mould-to-machine compatibility (tonnage) check (S, depends on P2-03)
- Mould history card (single life-story view per mould) (S, depends on P2-03)
- Machine downtime state machine (IDLE/RUNNING/BREAKDOWN/UNDER_MAINTENANCE/CHANGEOVER) (M)
- Instrument/gauge check on shift start (poka-yoke lite) (S)

**Sales** (`docs/research/phase-2/sales.md`)

- Export sales workflow polish (shipping bill / LUT / FOB terms UI) (S)
- Sales-order → production linkage / make-to-order visibility (M)
- Delivery-challan "SALE" kind for challan-before-invoice trade flow (S)
- Notification digest / in-app read/unread centre wiring for sales events (S)
- Discount/commission GST-compliance guardrails on P2-12's schemes (S)
- Transporter FK cleanup + dispatch-vehicle/transporter master usage (S)
- WhatsApp/SMS/email template + auto-send hooks for sales documents (S/M)

**Logistics & energy** (`docs/research/phase-2/logistics-energy-workflow.md`)

- GRN ↔ e-way-bill / transporter reconciliation data-quality fix (S)
- Vehicle/driver document-expiry alerts (RC, insurance, permit, licence) (S)
- Machine power-rating master fields (connected load, voltage, phase) (S, feeds P2-16)
- Water-consumption tracking (cooling towers, chillers, washing) (S)
- WhatsApp/SMS/email approval nudges beyond the in-app row (S, depends on P2-15)

**Compliance** (`docs/research/phase-2/compliance.md`)

- Type-specific reference fields for BIS/FSSAI/ISO licences (S, depends on P2-14)
- Document vault for certificates, tenant-scoped storage (M, depends on P2-14)
- Retention class for licences/EPR/vault documents (S, depends on P2-14)
- Company/BusinessPlace registration read-only reference fields (S)

**Tamil Nadu** (`docs/research/phase-2/tamil-nadu.md`)

- TN Shops & Establishments registration for offices/sales depots (S, depends on P2-14's register)
- TN MSME incentives / single-window scheme register (S, depends on P2-14's register)

**Platform** (`docs/research/phase-2/platform.md`)

- Dashboard query cost/pagination fix (`dashboard.controller.ts getSummary` over-fetches) (S)
- Reports permission granularity — single `reports.view` gates all 5 reports today (S)
- Notification digest/grouping in-app for high-volume tenants (S)
- Exception dashboard for the accountant persona (unposted vouchers, open NCRs, etc.) (M)

## c) Cross-cutting rules for Phase 2

Everything CLAUDE.md already states applies without exception to every package above; the points
worth restating because every Phase 2 package touches them:

- **Tenant scoping.** Every new model and query goes through `lib/prisma.ts`; jobs and seeds use
  `runAsTenant`. Every package's integration suite proves a foreign `companyId` sees nothing.
- **Audit.** Books, documents, payroll and master tables (all of P2-03, P2-04's tickets, P2-05's
  NCRs, P2-08/09's vouchers, P2-10's POs, P2-14's licences) go on `AUDITED_MODELS` with a
  generated migration — never a hand-written `audit_log` insert.
- **Jobs.** Every scheduled or background action (P2-06's leave accrual, P2-08's dunning, P2-11's
  document-expiry alerts, P2-15's digest, P2-16's alerts) is a pg-boss job under `runAsTenant`,
  idempotent — never `node-cron` or `setInterval`.
- **Permissions.** New permission keys are registered in `packages/shared` before the route ships;
  nav is gated on them. P2-04 and P2-18/19 close out the permission bugs the research reports
  found in already-shipped modules (`production-wastages`, `dashboard`).
- **Tests.** Definition of done from CLAUDE.md applies as written: happy path + every validation
  rejection + a cross-tenant test, and a new screen goes into `e2e/smoke.spec.ts`.
- **Tamil Nadu first.** P2-17 is the foundation every TN-specific number (PT slabs, LWF amount,
  minimum wage + VDA, e-way threshold) reads from. Nothing hard-codes a TN figure outside it, so
  a second state is a rules data pack, not a code change.
- **Legal values as editable, flagged settings.** Any number sourced from a statute, a government
  notification or a tariff schedule (PT slabs, LWF contribution, minimum wages/VDA, TANGEDCO
  tariff, EPR obligation rates, e-way threshold) is stored as an editable, effective-dated setting
  with a "source and last-verified date" field — never a compiled-in constant — because the
  research reports' own values are researcher-derived and each one is marked for accountant or
  consultant sign-off before it governs a live posting (see Open questions below).

## d) What Shiftline will not build

No package in this roadmap, in wave 1, wave 2 or the backlog, may implement:

- A parallel or hidden set of books, or any storage path for a transaction that bypasses the
  audited ledger.
- Off-record sales, or any document flow whose output is not itself a recorded, numbered document
  (`documentNumberService`) feeding the same books as every other sale.
- A purgeable or hard-deletable transaction. Books are never deleted (P1-09's rule carries forward
  unchanged); the only ways a posted entry stops counting are cancellation with a reversal journal
  and year-end closing, both already built and both fully audited.
- Any feature whose purpose, stated or implied, is to conceal revenue, understate liability or
  otherwise mislead a tax authority, a lender or an auditor.

Cash workflows are first-class, not a concession: P2-08's cash-sales counter mode and P2-09's
cash-denomination register are being built because plastics SMEs run real cash tills, not to give
those tills a way to disappear. Every cash entry gets a voucher, a party (or a recorded cash-sale
counter-party), a number and an audit row exactly like a bank entry.

The reasoning: the audit trail Shiftline keeps is the owner's protection in a GST assessment, a
labour inspection or a bank loan review, not a liability to be managed around. A feature that let
an owner hide a transaction today would be the first thing an assessing officer or auditor asks
about tomorrow, and it would make every other number in the system suspect by association. The
product's competitive edge over a notebook-and-spreadsheet shop is that compliance is
effortless — UPI/QR collection reconciled automatically, e-invoice and e-way bill raised from data
already on the sales order, EPR returns computed instead of estimated — not that it offers a
back door. An SME that wants Shiftline because it can hide things is a customer this roadmap does
not build for.

## e) Open questions for the owner

- **Accounts.** Phase 1's closeout listed a GSP account, a Razorpay account (tenant + platform
  subscriptions), an MSG91 account with DLT registration, and now P2-16 adds a TANGEDCO/DISCOM
  billing-data source (manual entry works without it, but automated bill import does not) and
  P2-14 adds a CPCB EPR-portal login for GRC filing. Which of these does the owner want opened
  before or during Phase 2, and by when?
- **Accountant validation month.** Phase 1 asked for one real month's output to be reviewed by
  someone who files for a living; that review has not been reported as done. Phase 2 adds payroll
  statutory wiring (P2-06), TN Professional Tax/LWF/minimum-wage numbers (P2-17) and EPR return
  math (P2-14) — all legal-value-dependent. Which month, and which accountant/consultant, signs
  off before these numbers govern a live posting?
- **Tamil Nadu legal-value verification.** The `tamil-nadu.md` report's PT slabs, LWF amount,
  minimum-wage/VDA figures and NFH holiday list are researcher-derived from public sources as of
  the report date, not confirmed against a current government notification. Who verifies each
  value in P2-17 before it goes live — the same accountant, a labour-law consultant, or both — and
  is that a one-time check or a recurring one tied to the notification cycle?
- **Human approver for filing, payment, tenancy and auth PRs.** CLAUDE.md and the Phase 1 closeout
  both flag this as still open. Phase 2 adds filing-adjacent PRs in P2-06, P2-14 and P2-17, and
  payment-adjacent PRs in P2-08 and P2-09. Who is that approver, and is the branch-protection rule
  that enforces it in place yet?
