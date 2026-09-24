# P2-10 — CAPA and non-conformance (Part Three, close-soon)

## Why

`ProductionWastage.correctiveAction` is a 255-character free-text box, and that is the whole of
corrective action in this system. A customer complaint, a failed inspection or a repeat breakdown
needs to become a recorded non-conformance, a root-cause analysis, an action with an owner and a
date, and a verification that it worked. Every OEM vendor audit and ISO 9001 surveillance visit asks
to see exactly that trail, and this is the last of the Part Three close-soon items.

Read `docs/specs/P2-00-shop-floor-foundation.md` first. Its sources are P2-05, P2-07 and P2-08, so
build it last.

## Scope

- **`NonConformance`** (NC, audited): the source — `INSPECTION` (a P2-07 rejection or an SPC
  out-of-control point), `CUSTOMER_COMPLAINT`, `SUPPLIER`, `INTERNAL_AUDIT`, `BREAKDOWN` (a P2-05
  work order), `PROCESS` — with the linked record, the product or material, the affected
  `MaterialLot` or `ProductLot` from P2-08, quantity, severity, the description, and the immediate
  containment action taken. Status `OPEN`, `CONTAINED`, `IN_CAPA`, `CLOSED`, `CANCELLED`.
- **`Capa`** (audited): raised from one or more NCs. Root-cause analysis recorded by method — five
  whys as an ordered list, or a fishbone category — the corrective action (fix this occurrence) and
  the preventive action (stop the class of occurrence), distinguished, because conflating them is
  the most common audit finding.
- **`CapaAction`**: one row per action with an owner, a due date, status and completion evidence.
  Overdue actions escalate through `notify` on a daily pg-boss job under `runAsTenant`, idempotent,
  once per action per escalation level.
- **Effectiveness verification.** A CAPA cannot be closed until a verification is recorded after a
  stated review date — the closure refuses, with a clear reason, before that date. Verification
  names what was checked and by whom.
- **Recurrence detection.** When a new NC matches a closed CAPA's product and rejection reason
  within a configurable window, flag it as a recurrence and link it — a CAPA that did not hold is
  the thing a quality system exists to surface.
- **8D as a report shape**, not a second model: the eight disciplines rendered from the NC, the
  CAPA, its actions and the verification, exportable as a PDF for a customer.
- Routes `/api/non-conformances` (CRUD, contain, raise-capa, close), `/api/capa` (CRUD, actions,
  verify, close, 8D export), `/api/capa/recurrences`. New permission modules `non-conformances`
  (`view, raise, contain, close`) and `capa` (`view, create, act, verify, close`) in
  `permissions.ts`, feature `quality`, paths in `api-paths.ts`, keys to OWNER, PRODUCTION and
  STORES; verify and close to OWNER in `ROLE_DEFS`.
- Web: an NC register, a CAPA board by status with overdue highlighted, a CAPA detail with the
  root-cause and action editors and the verification panel, the 8D export, and a recurrence view.
  Each into `e2e/smoke.spec.ts`.

**Anchor files:** `modules/production-wastage/` for the existing `correctiveAction` field this
supersedes (keep the column, link the NC alongside); `modules/filings/filing-approval.service.ts`
for gated closure; `src/jobs/eod-snapshot.job.ts` for the daily escalation sweep; `src/templates/`
for the 8D PDF.

## Out of scope

Supplier scorecarding from NC data (a schedule-later backlog item); customer complaint intake from a
portal or email; FMEA and control plans, which sit with the auto-components vertical pack; cost of
poor quality as a costed figure, which P1-19 can compute from the linked lots separately.

## Acceptance

- `capa.spec.ts`: an NC is raised from each of the six sources with the source record linked; a
  failed P2-07 inspection and an SPC out-of-control point each create one; containment is required
  before `CONTAINED`; a CAPA raised from two NCs links both; corrective and preventive actions are
  stored distinctly and a CAPA with neither cannot leave draft; an overdue action escalates once per
  level and the job re-run does not re-escalate; closure before the verification review date is
  refused with a reason, and succeeds after verification is recorded; a matching NC within the
  window is flagged as a recurrence and outside it is not; the 8D export renders every discipline
  from linked data; cancellation requires a reason and no row is deleted.
- Cross-tenant: tenant A cannot read or act on tenant B's NCs or CAPAs.
- New models into `AUDITED_MODELS` and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
