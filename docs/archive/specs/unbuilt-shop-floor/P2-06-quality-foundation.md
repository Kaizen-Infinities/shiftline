# P2-06 — Quality foundation: characteristics, plans and the rejection master (M6 part A)

## Why

Quality in this codebase is one OEE factor and a free-text `rejectReason`. Before any inspection can
be recorded, three things have to exist: what is measured, how often and against what limits, and a
controlled vocabulary for why something failed. Splitting the foundation from the inspections
(P2-07) keeps both packages shippable and keeps the masters stable while the transactional side
grows.

Read `docs/specs/P2-00-shop-floor-foundation.md` first.

## Scope

- **`QualityCharacteristic`** master (audited): code unique per tenant, name, the product or raw
  material it applies to (or none, for a general characteristic), type `VARIABLE` (measured, with
  unit, nominal, upper and lower specification limits) or `ATTRIBUTE` (pass/fail or a count),
  criticality `CRITICAL`, `MAJOR`, `MINOR`, and the measurement method and instrument. Critical
  characteristics are the ones an OEM PPAP packet will later key off, so the flag matters now.
- **`InspectionPlan`** (audited): the stage it applies to — `INCOMING`, `IN_PROCESS`, `FINAL`,
  `PRE_DISPATCH` — the product or material, the characteristics it covers with the sample size and
  frequency for each (every piece, every nth, once per hour, once per lot), and the acceptance rule.
  Versioned: a plan in use is never edited in place; a new version supersedes it and inspections
  record which version they ran against. This is what makes a result defensible a year later.
- **`RejectionReason`** master in the P2-00 reason-code shape, categorised by defect family
  (`DIMENSIONAL`, `VISUAL`, `MATERIAL`, `PROCESS`, `CONTAMINATION`, `OTHER`), with a starter set
  seeded through the provisioning service. The existing free-text `HourlyProduction.rejectReason`
  and `ProductionWastage.reason` are kept and backfilled where a label matches; nullable foreign
  keys are added alongside so no historical row is lost.
- **Sampling rules** as a small pure module (`quality.sampling.ts`) so P2-07 and any later AQL work
  share one implementation: fixed sample size, percentage of lot, and every-nth.
- Routes `/api/quality-characteristics` CRUD, `/api/inspection-plans` (CRUD, new-version,
  supersede), `/api/rejection-reasons` CRUD. New permission modules `quality-characteristics`,
  `inspection-plans` and `rejection-reasons` (all `view, create, edit, delete`) in `permissions.ts`,
  feature **`quality`** in `features.ts` — a new feature key, Enterprise-only — paths in
  `api-paths.ts`, keys to OWNER, PRODUCTION and STORES in `ROLE_DEFS`, read-only to AUDITOR.
- Web: `/quality/characteristics`, `/quality/inspection-plans` with the version history, and
  `/settings/rejection-reasons`. Each into `e2e/smoke.spec.ts`.

**Anchor files:** `apps/api/src/modules/gst/` for a seeded master set with a starter file
(`hsn-starter.ts` is the shape for the rejection-reason starter set);
`modules/bill-of-material/` for a per-product child-row master; `modules/uom/` for plain CRUD.

## Out of scope

Recording any inspection result — that is P2-07, and this package must not create a results table;
SPC charts; certificates of analysis; HACCP and other non-discrete quality templates (G5, a later
generalisation item); calibration of the instruments named here, which is the Legal Metrology
register (U3).

## Acceptance

- `quality-foundation.spec.ts`: characteristic CRUD with spec limits validated (lower below
  nominal below upper, and a variable characteristic refused without a unit); an attribute
  characteristic refused when given spec limits; plan versioning — editing a plan in use is refused,
  a new version supersedes and the old version stays readable; the sampling module returns the
  expected sample size for each of the three rules at their boundaries; retirement instead of
  deletion for all three masters, and a retired reason still renders on a historical row.
- Seeded starter reasons appear for a newly provisioned tenant.
- Feature gating: a tenant on the `GROWTH` plan gets 403 `FEATURE_NOT_IN_PLAN` on these routes and
  an Enterprise tenant does not.
- New models into `AUDITED_MODELS` and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
