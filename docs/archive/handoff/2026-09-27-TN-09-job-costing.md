# TN-09 — Job / project costing per body-building or fabrication job

Spec: `docs/research/tamil-nadu/market-and-features.md`, "(d) Prioritised feature list", item 9
(Namakkal / Tiruchengode truck body builders, Trichy fabricators).

## Shipped

- **Schema** (migration `20260927040000_job_costing`, RLS `tenant_isolation` + `platform_bypass`,
  audit triggers; all four models in `AUDITED_MODELS`):
  - `ProjectJob`: `@@unique([companyId, jobNo])`, FK `Customer`, title, description,
    `quotedAmount` Decimal, quote / target dates, customer-owned chassis in custody (chassis no.,
    make/model, received on, condition notes), status `QUOTED → IN_PROGRESS → COMPLETED →
DELIVERED` or `CANCELLED`.
  - `ProjectJobStage`: ordered plan (`@@unique([jobId, seq])`), weight, planned / actual dates,
    status `PENDING | IN_PROGRESS | DONE | SKIPPED`.
  - `ProjectJobCost`: `MATERIAL | LABOUR | SUBCONTRACT | OVERHEAD`, qty × rate = amount (labour:
    hours × rate/hour), optional `rawMaterialId` (uuid), `stockIssueId` (a `RawMaterialTransaction`
    whose type ends in `ISSUE`, costed once: `@@unique([companyId, stockIssueId])`), `employeeId`,
    vendor; status `DRAFT | POSTED`.
  - `ProjectJobBilling`: `ADVANCE | STAGE_INVOICE | FINAL`, amount, `advanceAdjusted`, optional
    stage and `salesInvoiceId` (tenant-checked, same customer).
- **Calc** (`project-jobs.calc.ts`, pure, summed in paise): cost by type, margin and margin % vs
  quote with a band (LOSS < 0, THIN < 10 %, HEALTHY), weighted % complete (SKIPPED drops out,
  IN_PROGRESS counts half, COMPLETED/DELIVERED = 100), billed, advances, advance balance, billed vs
  cost, left to bill, stage reorder check, allowed status moves (one step back; CANCELLED and
  DELIVERED are final). Stage plans `BODY_BUILDING` (chassis inward → fabrication → paneling →
  painting → electrical → finishing → delivery), `FABRICATION`, `NONE`.
- **API** `/api/project-jobs` (module `project-jobs`, not `job-work`), behind `authMiddleware`,
  `requireFeature("production")` and `project-jobs.*`: `GET /stage-plans`, `GET /` (status, customer,
  `q`), `POST /`, `GET|PATCH /:id`, `GET /:id/summary`, `DELETE /:id` (only while the job has no cost
  and no billing; otherwise 409 "cancel it instead"), `POST /:id/stages`, `PATCH /:id/stages/:stageId`
  (DONE needs the actual end; work on a stage moves a QUOTED job to IN_PROGRESS),
  `PUT /:id/stages/order`, `POST /:id/costs` (material rate/unit default from the raw material,
  qty from the stock issue), `POST /:id/costs/post` (lock drafts), `DELETE /:id/costs/:costId`
  (DRAFT only), `POST /:id/billings` (adjustment capped at the advance balance). A cancelled or
  delivered job refuses edits and new cost.
- **Registries**: permission module `project-jobs` (view/create/edit/delete/export), in the
  `production` feature and the PRODUCTION role; `API_PATHS.projectJobs`.
- **Web**: Production → Jobs (`/production/jobs`): status chips with counts, search, table with
  status chip, progress bar + current stage, quoted, cost to date and margin chip, green "New job"
  CTA with the create form (chassis custody fields, stage plan). Detail `/production/jobs/:id`
  (`?tab=costs|billing` deep-links): stat tiles (quoted, cost to date, margin, billed, advance
  balance), custody tile with progress, stage timeline (start / done / skip / reopen / move up-down /
  add), costs by type + add form + table (remove draft, post drafts), billing form + table.
  Sidebar entry and hub chip under Production, smoke line. Checked at 1440 / 390 and dark.
- **Tests**: `test/unit/project-jobs.spec.ts` (calc), `test/integration/project-jobs.spec.ts`
  (happy path, every validation rejection, duplicate 409, stock issue costed once, draft-only
  removal, cancel instead of delete + locked after cancel, foreign customer / raw material /
  invoice ids 404, 403 for the accounts role, foreign company sees no rows). Routes and leak
  snapshots updated; the four models are seedless in `leak.spec`.

## Cut / later

- No posting of job cost to the books (WIP / cost-of-job ledgers) — POSTED only locks the line.
- Stage invoices are recorded against an existing sales invoice id; raising the GST invoice from
  the job screen is not built. No receipt tracking beyond advances.
- No editing of a stage's planned dates, weight or remarks from the web (API supports it); no
  employee picker on the labour form (API accepts `employeeId`); export key registered, no export.
- Customer-material custody covers one chassis per job; a separate custody register (multiple
  items, return gate pass) is not built.

## Changelog

Body builders and fabricators can now open a job per chassis or order, book material, labour and
subcontract cost against it, bill advances and stages, and see the margin against the quote as the
work moves through its stages.
