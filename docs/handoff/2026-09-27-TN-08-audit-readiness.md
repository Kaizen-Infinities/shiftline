# TN-08 — Buyer social-compliance audit readiness

Spec: `docs/research/tamil-nadu/market-and-features.md`, "(d) Prioritised feature list", item 8
(Tiruppur garment and Ambur leather exporters facing BSCI / WRAP / SMETA / SA8000 audits).

## Shipped

- **Schema** (migration `20260927060000_buyer_audits`, RLS `tenant_isolation` + `platform_bypass`,
  audit triggers; all three models in `AUDITED_MODELS`):
  - `BuyerAudit`: `@@unique([companyId, auditNo])` (defaults to `<standard>-<scheduledDate>`),
    standard `BSCI | WRAP | SMETA | SA8000 | SEDEX | HIGG | CUSTOMER_COC | OTHER`, optional buyer
    (`Customer`, tenant-checked), auditor firm/name, scheduled and actual dates, status
    `PLANNED → IN_PROGRESS → COMPLETED` (forward only) or `CANCELLED` with a reason, rating text,
    next audit due, remarks.
  - `AuditFinding`: ordered per audit (`@@unique([auditId, seq])`), area `WORKING_HOURS | WAGES |
HEALTH_SAFETY | CHILD_LABOUR | DOCUMENTATION | ENVIRONMENT | OTHER`, severity `CRITICAL | MAJOR |
MINOR | OBSERVATION`, clause ref, description. Open until it has actions and all are VERIFIED.
  - `CorrectiveAction`: action, owner (a user **or** an employee, tenant-checked, name kept),
    due date, status `OPEN → IN_PROGRESS → DONE → VERIFIED` (forward only, steps may be skipped,
    VERIFIED is final), evidence note (required for DONE/VERIFIED), `closedOn`, `verifiedBy`.
    Deliberately lean and named to fold into P2-10 CAPA as `CapaAction` later.
- **Readiness calc** (`buyer-audits.calc.ts`, pure, unit-tested). Hours per attendance day =
  shift length (record shift, else the employee's shift, else `PayrollConfig.defaultWorkingHoursPerDay`)
  - OT for PRESENT, half + OT for HALF_DAY, OT only for off/leave days — the same rows the P2-03
    muster roll reads. Checks (PASS / WARN / FAIL / NOT_CONFIGURED, count, up to 50 listed rows):
    weekly hours (> 48 warn, > 60 fail — whole Mon–Sun weeks around the period), daily hours > 9
    (warn), OT against the 125-hour quarterly cap (≥ 80 % warn, over or a payroll-recorded
    `OvertimeQuarterPeriod.breached` fail), **minimum wage: NOT_CONFIGURED** (Shiftline stores no
    minimum wages; the calc takes a daily minimum when P2-17 adds one), registers (muster roll and
    wages register per month; an incomplete muster roll warns, a missing one or a missing wages
    register for a closed month fails), open critical (fail) / major (warn) findings, overdue
    corrective actions (fail; due within 7 days warns). Score = pass 1, warn ½, fail 0 over the
    checks that apply; band READY ≥ 85, AT_RISK ≥ 60, else NOT_READY.
- **API** `/api/buyer-audits` behind `authMiddleware`, `requireFeature("payroll")` and
  `buyer-audits.*`: `GET /readiness?from&to` (default last 90 days, max a year),
  `GET /readiness/export` (CSV, `export`), `GET /owners` (users + employees for the picker, `edit`),
  `GET /`, `POST /`, `GET|PATCH /:id`, `POST /:id/cancel` (no DELETE), `POST /:id/findings`,
  `PATCH /:id/findings/:findingId`, `POST /:id/findings/:findingId/actions`,
  `PATCH /:id/actions/:actionId`. A cancelled audit refuses every change (409).
- **Registries**: permission module `buyer-audits` (view/create/edit/export) in the `payroll`
  feature; OWNER holds all, AUDITOR holds view. `API_PATHS.buyerAudits`.
- **Web**: People → Compliance → Audit readiness (`/hr/audit-readiness`, hub chip, command
  palette with "Plan audit" → `?action=plan`): period chips + date range, readiness score ring with
  band and pass/warn/fail chips, next-audit tile, the checklist (expand a check to see who / which
  month), Export CSV, green "Plan audit" CTA with the form, buyer audits grouped by month with
  Upcoming / Completed / Cancelled / All chips and open / overdue / days-to-go chips. Detail
  `/hr/audit-readiness/:id`: start / complete (date, grade, next due) / cancel with reason, figures,
  findings with severity and area chips, corrective actions with overdue / due-soon chips and
  forward-only Start → Mark done (evidence) → Verify. Checked at 1440 and 390, light and dark.
- **Tests**: `test/unit/buyer-audits.spec.ts` (17: dates, shift hours, day hours, weekly/daily,
  OT cap, minimum wage incl. not-configured, registers, forward-only moves, overdue, findings,
  score), `test/integration/buyer-audits.spec.ts` (11: happy path, readiness from seeded Feb-2024
  attendance and payroll + CSV, forward-only audit and action status, evidence required, cancel
  instead of delete and locked after, every validation rejection, 403 for accounts and for
  auditor writes, cross-tenant: foreign company sees none and foreign buyer / employee ids 404).
  Routes and leak snapshots updated; the three models are seedless in `leak.spec`.

## Cut / later

- Minimum wages are not stored anywhere, so that check always reads "Not configured" (P2-17).
- Hours come from attendance status + OT; biometric punch spans (P2-11) will replace the shift
  length when they exist. Business-place filtering of the report is not built.
- No editing of a finding or of an action's due date / owner from the web (the API supports both);
  no attachments for evidence (text note only); no reminder job for overdue actions.
- Readiness export is CSV only (no PDF).

## Changelog

Exporters can now plan their BSCI, WRAP, SMETA and buyer audits, track each finding's corrective
actions to verification, and see an audit-readiness score built from their own attendance, overtime,
payroll and registers.
