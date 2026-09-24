# P2-05 — Preventive maintenance and breakdown tickets (M3)

## Why

A press that stops unexpectedly costs a shift; a mould that runs past its service interval costs the
mould. Today maintenance exists as one `MachineStatus.MAINTENANCE` enum value and a free-text
downtime reason. P2-02 makes a breakdown visible; this package is what happens next, and it is where
run hours and shot counts from P2-01 finally earn their keep.

Read `docs/specs/P2-00-shop-floor-foundation.md` first. **There is no mould module to copy** — the
backlog's instruction to reuse one refers to the origin codebase. Define the pattern here.

## Scope

- **`MaintenancePlan`** (audited): the asset it covers — a `Machine`, and a `FixedAsset` from P1-18
  where one is linked — task description, and the interval expressed three ways, any or all of
  which may be set: calendar days, run hours (from P2-02's `MachineStateSpan` `RUNNING` duration)
  and shot count (from P2-01's `MachineCycle`). **Whichever threshold is reached first is due** —
  that is the rule the whole module turns on, and it must be stated in the service, not inferred.
- **`MaintenanceSchedule`**: the computed next-due per plan with the reading at last service, so due
  dates recompute from actuals rather than drifting off a fixed calendar.
- **`MaintenanceWorkOrder`** (audited): `PREVENTIVE` from a schedule or `BREAKDOWN` raised directly
  or from a P2-02 andon call; status `OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED`; assigned employee,
  the downtime it caused (linked to the state span), findings and the work done. Cancelled with a
  reason, never deleted.
- **Spares consumption** on a work order: raw-material issues from the stores through the existing
  `RawMaterialTransaction` path, valued at the weighted average from P1-19 — so maintenance cost is
  a real number on the machine, not a guess. Do not create a second stock-movement path.
- **Due and overdue sweep** on pg-boss: a daily job per tenant under `runAsTenant` recomputing
  schedules from current run hours and shot counts, raising the work order when a plan comes due,
  and notifying holders of `maintenance.view` — once per plan per due occurrence, idempotent.
- **Machine history:** every work order, its downtime and its spares cost on the machine detail,
  with mean time between failures and mean time to repair derived from the state spans.
- Routes `/api/maintenance` (plans, schedules, work orders, complete, cancel, history). New
  permission module `maintenance` (`view, plan, execute, cancel`) in `permissions.ts`, feature
  `shop-floor`, paths in `api-paths.ts`, keys to OWNER, PRODUCTION and STORES in `ROLE_DEFS`.
- Web: a maintenance board grouped by due state, a work-order detail with spares issue, plan
  configuration under settings, and a maintenance panel on the machine detail. Into
  `e2e/smoke.spec.ts`.

**Anchor files:** `apps/api/src/modules/production-order/` for a document with a status machine and
history; `modules/raw-material-transaction/` for issuing stock; `src/jobs/eod-snapshot.job.ts` for
the daily per-tenant sweep; `modules/machine/` for the master.

## Out of scope

Predictive maintenance from telemetry trends; a mould or tooling master with cavity-level life
tracking — that is a plastics depth-catalogue item and this package covers machines and linked
assets only; external contractor scheduling and their invoices (a purchase bill as usual);
condition-monitoring hardware.

## Acceptance

- `maintenance.spec.ts`: a plan with all three intervals set comes due on whichever is reached
  first, proved three times — once by days, once by run hours, once by shots; the next-due
  recomputes from the reading at last service, not from the original date; the sweep raises exactly
  one work order per due occurrence and a re-run raises none; a breakdown work order created from an
  andon call carries the state span and its downtime; spares issue moves stock once and values it at
  the weighted average; completing a work order resets the schedule; cancelling requires a reason
  and leaves the row; MTBF and MTTR over a fixed span set match hand-computed values.
- Posting a spares issue into a closed period is refused.
- New models into `AUDITED_MODELS` and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
