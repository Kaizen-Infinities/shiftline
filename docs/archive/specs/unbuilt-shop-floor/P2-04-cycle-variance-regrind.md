# P2-04 — Cycle-time variance and regrind ratio (M5)

## Why

The ideal cycle time is already on the machine and the actual is derivable the moment P2-01 lands;
the gap between them is where moulding money leaks. `modules/oee/oee.service.ts` currently defaults
performance to 100% when `cycleTime` is unset and computes it from typed hourly counts. Regrind —
the proportion of reprocessed material going back into a part — has no representation at all, and
it is both a cost lever and a quality constraint.

Read `docs/specs/P2-00-shop-floor-foundation.md` first. This package depends on P2-01's
`MachineCycle` and P2-02's `MachineStateSpan`.

## Scope

- **Cycle variance.** A derived view per production order, per shift and per machine: ideal cycle
  from `Machine.cycleTime` (overridable per product where a mould differs), actual from P2-01's
  `MachineCycle`, and the variance as both seconds and a percentage, with the distribution — median,
  p90, and the count of cycles beyond a tolerance — not just a mean, because a mean hides the jams.
  Slow-cycle minutes are converted into lost parts and lost rupees using P1-19's cost sheet.
- **OEE correction.** `modules/oee/oee.service.ts` takes its performance factor from real cycles
  where they exist and keeps its present behaviour where they do not. **`modules/oee/` has no
  integration suite today** — write `oee.spec.ts` covering the current behaviour first, prove it
  green, and only then change the service. Characterising before changing is the whole safety net
  here.
- **Regrind.** A regrind percentage on the BOM line and an actual regrind quantity captured against
  a production order, sourced from `ProductionWastage` rows already marked `isRecyclable` and from
  the wastage store. The ratio is actual regrind mass over total material mass, per order and per
  product, with a maximum-permitted percentage on the product that raises a warning when exceeded —
  regrind above spec is a quality defect, not just a saving.
- **Reports:** cycle-variance detail per order, a top-loss ranking by machine and by product, and a
  regrind ratio trend. Both feed the existing production dashboard rather than a new one.
- Routes on a new `/api/production-analytics` (cycle-variance, regrind, loss ranking). New
  permission module `production-analytics` (`view, export`) in `permissions.ts`, feature
  `shop-floor`, paths in `api-paths.ts`, keys to OWNER, PRODUCTION and AUDITOR (read-only) in
  `ROLE_DEFS`.
- Web: a cycle-variance panel on the production order detail, a regrind column on the wastage
  screens, and a loss-ranking card on the production dashboard. New screens into `e2e/smoke.spec.ts`.

**Anchor files:** `apps/api/src/modules/oee/oee.service.ts` — read it before changing it, the
performance formula lives at its top; `modules/insights/` for a read-only aggregation module with a
cache; `modules/production-wastage/` for the recyclable flag this reads.

## Out of scope

Scientific-molding parameters — cavity pressure, melt temperature profiles — which belong to the
plastics depth catalogue, not here; predicting a cycle deviation before it happens; automatic
adjustment of `Machine.cycleTime` from observed data, which must stay a human decision.

## Acceptance

- `cycle-variance.spec.ts`: a seeded simulator run produces a known cycle set and the median, p90
  and out-of-tolerance count match hand-computed values; a machine with no `cycleTime` yields no
  variance rather than a false 100%; lost minutes convert to lost parts at the ideal rate; the
  characterisation cases written for the pre-change OEE behaviour still pass, and a new case proves
  performance comes from real cycles when they exist.
- `regrind.spec.ts`: the ratio over a fixed set of wastage and consumption rows; regrind above the
  product maximum raises a warning and still records; an order with no recyclable wastage reports
  zero, not null.
- Cross-tenant: analytics for tenant B are invisible to tenant A.
- No new audited models if the package stays derived; anything persisted goes into `AUDITED_MODELS`
  and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
