# Commission: finish Phase 1 of Shiftline

You are taking over an in-progress remaster. Read this whole brief before touching code.

## The repository

- GitHub: `Kaizen-Infinities/shiftline`. Work only on branch `claude/peaceful-fermat-f8c0ex`; every
  push updates the open pull request #1. Never push to another branch and never open a new PR.
- Monorepo with npm workspaces: `apps/api` (Express 5, Prisma 6, PostgreSQL 16, pg-boss, pino,
  zod), `apps/web` (React 19, Vite, Redux Toolkit, Tailwind), `packages/shared` (permission
  registry, feature tiers, API paths, filings registry), `e2e` (Playwright). Runs on Docker
  compose locally; CI is `.github/workflows/ci.yml`. There is no hosting.
- The product is a multi-tenant ERP for Indian secondary-sector manufacturers. Phase 1 is the
  full finance and compliance scope. The approved plan with every package's scope is in the
  repository owner's hands; the packages below repeat what matters.

## Start of every session (non-negotiable)

1. Read `CLAUDE.md` in full. It is the rulebook: tenancy, audit, cancellation, GST, e-invoice,
   numbering, jobs, logging, auth. Every rule there was written after a real bug.
2. Read the newest three files in `docs/handoff/` and the spec in `docs/specs/` for the package
   you are about to build. `docs/handoff/2026-09-07-P1-13a-gstr1.md` is where the previous
   engineer stopped.
3. `npm install`, `npm run build -w @shiftline/shared`, `npm run typecheck` must be green
   before you change anything.

## What is finished (do not rebuild)

Phase 0 entirely. Phase 1: P1-00 tenant lifecycle, P1-01 plans and entitlements, P1-02 admin
console and device sessions, P1-03 account export, P1-04 approval gates on filings
(`modules/filings`, `filingApprovalService` with `upsertDraft`, `assertSubmittable`,
`markSubmitted`), P1-05 status page and insights API, P1-08 GST foundation, P1-09 audit trail,
period control, chart of accounts and year-end, P1-10 accounts hygiene and reports, P1-11
e-invoicing (`modules/e-invoice`, provider interface, fixture and GSP adapters), P1-12 e-way
bills (`modules/eway-bill`), and P1-13 part A: GSTR-1 from the books (`modules/gst-returns`,
`gstr1.service.ts`, routes under `/api/gst-returns`).

## What remains, in build order

Build them one at a time, in this order, each as its own commit and push.

1. **P1-13b GSTR-3B and the ITC ledger.** New `ItcLedger` model (audited): one row per inward
   document line-set from GRN invoices, expenses and petty cash with `eligible`, `ineligible`
   (section 17(5) by HSN or a flag on the document), `reversed` (rules 42/43 and the 180-day
   non-payment rule computed from payments on the bill), `reclaimed`. GSTR-3B tables from the
   books for one GSTIN and month: 3.1 (a taxable, b zero-rated, c nil/exempt, d inward
   reverse charge, e non-GST), 3.1.1, 3.2 inter-state supplies to unregistered, composition and
   UIN holders by place of supply, 4 (A available by source, B reversed, C net, D ineligible),
   5 exempt/nil/non-GST inward, 6.1 payment with the set-off order (IGST credit first against
   IGST then CGST then SGST; CGST against CGST then IGST; SGST against SGST then IGST) and the
   cash challan amount. Register the month on the filing gate as `GSTR3B` with the payload hash;
   `filed` only through `assertSubmittable`. Routes next to GSTR-1. Golden-file test: a fixed set
   of documents produces exact table values.
2. **P1-13c GSTR-2B and IMS.** `Gstr2bRecord` (imported from the portal JSON, one row per
   supplier invoice or note, with the 2B period) and `ImsAction` (accept, reject, pending, with
   reason and pushed-at). Import endpoint for the portal's 2B JSON; a fixture provider in the
   same shape as `modules/e-invoice/providers`, and a GSP adapter that pulls inward records and
   pushes IMS actions, sharing the encrypted credentials in `EInvoiceConfig`. Reconciliation
   against the purchase register: match on supplier GSTIN, normalised invoice number, date within
   a tolerance, and taxable value within a tolerance; statuses MATCHED, MISMATCH (with which
   fields), MISSING_IN_2B, MISSING_IN_BOOKS; bulk rules; supplier follow-up through the existing
   WhatsApp and email services. IMS actions must be pushed before the 14th; warn through
   `notify` from the compliance calendar. Matched and accepted records feed the ITC ledger.
3. **P1-13d GSTR-9 working papers, compliance calendar, web hub.** GSTR-9 tables 4 to 9 and
   17/18 as aggregates of the twelve months from the GSTR-1 and 3B builders; `ComplianceDue`
   registry derived from `FILINGS` in `packages/shared/src/filings.ts` (GSTR-1 11th, GSTR-3B
   20th, IMS 14th, TDS challan 7th, 26Q quarterly, PF ECR and ESI 15th, PT per state, MSME
   half-yearly, ITC-04) with a daily pg-boss job that notifies holders of the relevant
   permission 7 and 2 days before each due date. Web: `/compliance/gst` hub with period and
   GSTIN selectors, GSTR-1 tables with the JSON download and the approval panel
   (`apps/web/src/modules/compliance/components/ApprovalPanel.tsx` is reusable), GSTR-3B view,
   2B reconciliation workbench, IMS workbench, GSTR-9, and the calendar. Add every new screen
   to `e2e/smoke.spec.ts`.
4. **P1-14 exports, advances, job work.** Export invoices under LUT or with IGST, SEZ and
   deemed exports with shipping bill, port code and date (feed GSTR-1 EXP `sbnum`, `sbdt`,
   `sbpcode`); foreign-currency amounts with INR conversion (build the currency master and rate
   table here if P1-17 has not landed); receipt vouchers for advances with GST and adjustment on
   the invoice; refund vouchers; delivery challans for job work out and in with a job-worker
   master, material and scrap accounting, 1-year and 3-year return alerts, job-work register and
   ITC-04; delivery challans for other movements (own branches, exhibitions, line sales); a
   delivery challan PDF that carries the e-way bill number.
5. **P1-15 TDS and TCS.** `TdsSection` master keyed by Income-tax Act 2025 section 393 table
   items with the legacy 194C/194J/194H/194I/194Q codes; deductee master with PAN validation and
   the 206AB higher-rate flag; threshold tracking per financial year; deduction at bill or
   payment with TDS payable ledgers per section; challan register (ITNS 281) and challan-to-
   deduction mapping; Form 26Q/27Q export in the utility's format; Form 16A; TCS under section
   394 on scrap sales. Filings `TDS_26Q`, `TDS_27Q`, `TDS_CHALLAN` go through the filing gate.
6. **P1-06 Tally XML export.** Masters (groups, ledgers, stock items, units, parties) and all
   voucher types including notes, payroll, depreciation and stock journals; per period,
   incremental; ledger-name mapping; golden-file tests.
7. **P1-07 MSME 43B(h).** Udyam number, category, written-contract flag and agreed days on
   suppliers; 15/45-day clock per bill; day-30 and day-43 alerts; March-end disallowance report.
8. **P1-18 fixed assets.** Asset register with classes, capitalisation from GRN or expense,
   additions, revaluation, transfer between business places, disposal with profit or loss;
   Companies Act Schedule II depreciation (SLM and WDV, useful life) and Income-tax block
   depreciation; monthly depreciation voucher on pg-boss; register reports.
9. **P1-17 multi-currency.** Currency master, daily rate table (manual and RBI import),
   foreign-currency sales and purchase documents posting in INR, realised and unrealised FX
   gain/loss vouchers, import purchases with customs duty, IGST on imports and landed-cost
   apportionment to stock.
10. **P1-19 valuation, costing, cost centres, budgets.** Weighted-average valuation per item per
    store from GRN and landed cost; stock journal voucher and closing-stock posting at period
    close; WIP and scrap valuation from production orders and wastage; product cost sheet
    (material at average, labour from payroll hours, overhead allocation rules); cost centres on
    vouchers and expenses with a cost-centre P&L; budgets with variance.
11. **P1-20 bank reconciliation and PDC.** Statement import (CSV/XLS from HDFC, ICICI, SBI,
    Axis, Kotak, generic mapper), auto-matching to receipts, payments, charges and interest with
    rules, manual match, BRS report; cheque register received and issued, post-dated cheque
    scheduling, deposit, clearing, bounce with charges and reversal.
12. **P1-16 statutory payroll and filings.** Salary structure with the Labour Code wage check
    (basic at least 50% of gross); PF per EPF Scheme 2026 (EPF/EPS/EDLI split, admin charges,
    VPF), ESI, PT slabs for 22 states, LWF by state; TDS on salary (section 392) with old and new
    regime declarations, Form 24Q, Form 16; payroll journal and payment vouchers; EPFO ECR text
    file, ESIC monthly file, PT challan summary, bank salary transfer file; all behind the
    filing gate (`PF_ECR`, `ESI_MONTHLY`, `PT_RETURN`, `TDS_24Q`, `PAYROLL_RUN`); golden-file
    tests.
13. **P1-17b Labour Code rules, leave, gratuity, bonus, full and final.** Overtime at double
    wages with 9-hour/48-hour triggers and quarterly caps; leave ledger with accrual and holiday
    calendar; gratuity accrual (5 years, 1 year fixed-term); statutory bonus 8.33% to 20% with
    the ₹21,000 eligibility and ₹7,000 or minimum-wage ceiling; leave encashment; full and final
    settlement with notice recovery; digital registers (muster roll, wages, overtime, fines,
    deductions, advances).
14. **P1-21 payment links and subscription billing** and **P1-22 SMS/OTP** are built against
    sandboxes only when the owner supplies Razorpay and MSG91 accounts; otherwise build the
    provider interfaces and fixture adapters and stop.
15. **The frontend remake**, described in the next section.

## The frontend remake (a full package of its own, at your discretion)

The owner has commissioned a major remake of `apps/web`, and the design decisions are yours:
information architecture, navigation, visual system, component library, page layouts,
interaction patterns, motion, and the choice of state and data-fetching approach on top of
the existing API. Propose the direction first in `docs/specs/P1-UI-remake.md` (why, the
design system, the navigation model, the page inventory, the migration order) and then build
it in slices, each slice a shippable commit that leaves every screen usable.

What is fixed, whatever you choose:

- The API contracts stay as they are. `apps/web/src/api/apiClient.ts` (or the RTK `baseApi`)
  remains the only HTTP path; the 15-minute access token in memory and the rotating refresh
  cookie stay as they are; `POST /api/auth/refresh` on 401.
- Tailwind only. Remove Bootstrap and every Bootstrap-styled legacy screen as you rebuild it;
  no screen may end up half in one system and half in the other.
- Every screen is gated by the permission keys in `packages/shared/src/permissions.ts` through
  `ProtectedRoute`, and the sidebar or its replacement is gated the same way; plan features
  through `useEntitlement`. Platform admin screens stay behind `ProtectedRoute superAdmin`.
- Feature parity: nothing a user can do today may disappear. Keep an inventory in the spec
  and tick screens off as they are rebuilt. The existing panels
  (`modules/compliance/components/ApprovalPanel.tsx`, `EInvoicePanel.tsx`,
  `EwayBillPanel.tsx`) and the notification centre are behaviour to preserve, not markup.
- Socket updates through `useSocketSync` per tenant, as today.
- Responsive to 400 px, keyboard-operable, visible focus states, contrast at WCAG AA, dark and
  light themes (the app already has a theme toggle), Indian number and date formatting
  (`en-IN`, ₹, lakh and crore where the finance screens already do it).
- `e2e/smoke.spec.ts` must keep passing at every slice: update markers when headings change,
  add every new screen, never delete an entry for a screen that still exists.
- `npm run typecheck -w @shiftline/web`, lint and the web build stay green; no new
  dependencies without a one-line justification in the spec (icon set, headless UI primitives
  and a chart library are reasonable; a second CSS framework is not).
- "Sun Sea" and any origin-codebase branding must not survive the remake; company names,
  logos and colours come from the tenant record.

Sequence it as you see fit: either as one track after P1-13d, or interleaved so each
finance package lands on its new screens. State the choice in the spec and keep it.

## The loop for every package (follow it exactly)

1. Write the spec: half a page in `docs/specs/<id>-<name>.md` with Why, Scope, Out of scope,
   Acceptance. Look at `docs/specs/P1-12-eway-bill.md` for the shape.
2. Schema first. Add models to `apps/api/prisma/schema.prisma`; every tenant model has
   `companyId` with the `current_setting('app.company_id')` default and a `Company` relation.
   Generate the migration with `prisma migrate diff` against the migration database (see the
   commands below), append the RLS block and, for books, documents and masters, the audit
   trigger, exactly as `apps/api/prisma/migrations/20260907170000_eway_bills/migration.sql`
   does. Add audited models to `apps/api/src/lib/audited-models.ts`. Add every new tenant model
   without seed rows to `MODELS_WITHOUT_SEED_ROWS` in `apps/api/test/integration/leak.spec.ts`.
3. Register permission modules in `packages/shared/src/permissions.ts`, put them in a feature
   in `packages/shared/src/features.ts`, add paths to `packages/shared/src/api-paths.ts`, give
   the keys to the right roles in `ROLE_DEFS` in
   `apps/api/src/modules/platform/provisioning.service.ts`, rebuild shared.
4. Backend module under `apps/api/src/modules/<name>/` with `authMiddleware` and
   `requirePermission` on every route; mount in `apps/api/src/routes/index.routes.ts`.
   External portals only behind a provider interface with a fixture adapter; secrets encrypted
   with `encryptText`. Background work only on pg-boss (`lib/jobs.ts`, `src/jobs/`).
5. Integration tests in `apps/api/test/integration/<name>.spec.ts` covering the happy path,
   every validation rejection, permission refusal and, for anything on the filing gate, the
   refuse-until-approved and stale-hash paths. Use `authed("demo.owner")`,
   `authed("demo.accounts")`, `authed("demo.production")` from `test/helpers/app.ts` and the
   factories in `test/factories/index.ts`. The demo company GSTIN is `33AAAAA0000A1Z9`;
   `27AAPFU0939F1ZV` is a valid inter-state buyer GSTIN.
6. Web screens under `apps/web/src/modules/...` in Tailwind, service in
   `apps/web/src/services/`, route in `apps/web/src/routes/AppRoutes.tsx` behind
   `ProtectedRoute permission=...`, sidebar entry in
   `apps/web/src/components/common/sidebar/sidebar.data.ts`, and a line in `e2e/smoke.spec.ts`.
7. Hand-off note `docs/handoff/<date>-<id>-<name>.md` with Shipped, Half-done / known gaps,
   Next, Blocked on you, and a one-sentence Changelog sentence.
8. Verify everything (below), commit, push, confirm CI is green on GitHub Actions, fix anything
   red before starting the next package.

## Commands that must be green before every push

Run from the repository root unless noted.

```
npm run build -w @shiftline/shared
npm run typecheck
npm run typecheck -w @shiftline/web
npm run lint                      # warnings are tolerated, errors are not
npx prettier --check "packages/**/*.{ts,js,json}" "apps/api/test/**/*.ts" "apps/api/prisma/seed.ts" "*.{js,mjs,mts,json,yml}" ".github/**/*.yml"
npm run e2e:typecheck
cd apps/api && npx vitest run --no-file-parallelism     # the whole API suite, sequentially
```

Migrations, from `apps/api`:

```
MIG=postgresql://shiftline_migrator:shiftline_migrator@localhost:5432/shiftline_mig
SHADOW=postgresql://shiftline_migrator:shiftline_migrator@localhost:5432/shiftline_shadow
DATABASE_URL=$MIG npx prisma migrate diff --from-migrations prisma/migrations --shadow-database-url $SHADOW --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
# append the RLS and audit block, then
DATABASE_URL=$MIG npx prisma migrate deploy
DATABASE_URL=$MIG npx prisma migrate diff --from-migrations prisma/migrations --shadow-database-url $SHADOW --to-schema-datamodel prisma/schema.prisma --exit-code   # must print nothing
npx prisma generate
```

Route and leak snapshots update with `npx vitest run routes leak -u` after adding routes.
Playwright runs from the root against the `shiftline_e2e` database; after schema or permission
changes run `prisma migrate deploy` and `npm run db:seed` against it first (the seed adds new
permission keys to roles and new features to plans). Never run `prisma migrate reset`.

## Hard rules (a violation is a failed package)

- Never `prisma db push`, never `new PrismaClient()`, never `console.*` in the API, never
  `setInterval` or `node-cron`, never `getIO()` or `io.emit`.
- Never hard-delete books, documents or masters; cancel or reverse through
  `cancellationService`, and call `eInvoiceService.assertDocumentCancellable(docType, id, tx)`
  on every cancel path of a tax document. Inside a Prisma interactive transaction, read through
  the `tx` client: the outer client does not carry the tenant session settings there.
- Every filing package refuses to submit anything until `filingApprovalService.assertSubmittable`
  passes for that period and payload hash.
- No endpoint returns a raw error message; no secret in code or in a response body; env
  variables validated in `apps/api/src/config/env.ts` and documented in `apps/api/.env.example`
  and `docker/api.env`.
- "Sun Sea" must not appear in code or UI. Company names come from the tenant record.
- Commit messages: a subject line, a body explaining what and why, and end with exactly these
  two trailers:

  ```
  Co-Authored-By: <your model name> <noreply@<your vendor>.com>
  Claude-Session: https://claude.ai/code/session_01FMHrR3kG5b9jHHNcM1jdhL
  ```

  Replace the first with your own attribution; keep the second so the history of this branch
  stays traceable. No model identifiers in code, comments, PR text or docs.

- Push with `git push -u origin claude/peaceful-fermat-f8c0ex`; retry on network errors with
  backoff; never force-push.

## Known gaps to keep in mind

- The GSP adapters for e-invoice and e-way bill have not met a live sandbox; their paths and
  headers follow the common GSP layout and must be pinned in the first sandbox session. Until
  the owner supplies credentials, everything runs on the fixture providers.
- Credit and debit notes have no PDF template yet (the IRN QR prints only on invoices).
- Debit notes to customers are not modelled; CDNR carries credit notes only.
- The insights cache is per API process.

## Blocked on the repository owner (ask once, then keep building what does not need it)

GSP sandbox credentials (e-invoice, e-way bill, IMS and returns APIs); branch protection and
the named human approver for filing, payment, tenancy and auth changes; a pentest vendor; the
Anthropic API key decision for cheque OCR; the terms-of-service text; EPFO and ESIC portal
access and a Sandbox.co.in account for 24Q; sample bank statements for P1-20; Razorpay and
MSG91 accounts for P1-21 and P1-22; an accountant for one validation month.

## Reporting

After each package, report in this order: what shipped with file paths, what the tests cover,
the CI run link and result, what is half-done, what you need from the owner. If a suite fails,
say so with the output; never report a step as done that was skipped.
