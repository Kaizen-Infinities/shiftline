# P2-02 — Machine state timeline, downtime reasons and live andon (M4)

## Why

`Machine.machineStatus` is one mutable column: the current state is knowable, the last four hours
are not. Downtime reasons are free text typed at the end of an hour. Andon is the shop-floor habit
of making a stoppage visible the moment it happens, to the people who can clear it — which needs a
state timeline underneath it, not a status column.

Read `docs/specs/P2-00-shop-floor-foundation.md` first.

## Scope

- **`MachineStateSpan`** (audited): machine, state, start, end (null while open), duration, the
  reason code, the production order and shift in force, and the source — `TELEMETRY` from P2-01's
  signals or `MANUAL` from an operator. Exactly one open span per machine, enforced in the service
  and by a partial unique index. Closing a span opens the next: the timeline has no gaps and no
  overlaps.
- **`DowntimeReason`** master in the P2-00 reason-code shape, categorised `PLANNED`, `BREAKDOWN`,
  `SETUP`, `MATERIAL`, `QUALITY`, `OTHER`, with a starter set seeded through the provisioning
  service. `HourlyProduction.downtimeReason` (free text) is kept and backfilled where a label
  matches; a nullable `downtimeReasonId` is added alongside.
- **State derivation** from P2-01: a telemetry `STATE` signal or an absence of `CYCLE_COMPLETE`
  beyond a per-machine threshold closes the running span and opens a stopped one. A machine with no
  gateway keeps working exactly as today through manual transitions — the module must be fully
  usable without telemetry.
- **`AndonCall`** (audited): machine, raised-by, category (`MAINTENANCE`, `MATERIAL`, `QUALITY`,
  `SUPERVISOR`), the linked state span, raised-at, acknowledged-at and by, cleared-at and by, and
  the resolution note. Escalation: unacknowledged past a configurable threshold notifies the next
  level through `notify`, once per level per call, on a pg-boss sweep.
- **Realtime:** `machineState:changed`, `andon:raised`, `andon:cleared` through `emitToTenant`.
- Routes `/api/machine-states` (timeline, current, transition), `/api/downtime-reasons` CRUD,
  `/api/andon` (raise, acknowledge, clear, open list). New permission modules `machine-states`
  (`view, transition`), `downtime-reasons` (CRUD) and `andon` (`view, raise, acknowledge, clear`)
  in `permissions.ts`, feature `shop-floor`, paths in `api-paths.ts`, keys to OWNER and PRODUCTION
  in `ROLE_DEFS`.
- Web: a **sixth TV scene** in `apps/web/src/modules/dashboard/tv/scenes/` — `SceneAndon` — showing the
  machine-status wall with live state, elapsed stop time and open andon calls, wired into the
  rotation and using the existing `tv/components/TvPrimitives.tsx`. A raise/acknowledge/clear panel on the shift
  execution board, a downtime Pareto on the production dashboard, and `/settings/downtime-reasons`.
  New screens into `e2e/smoke.spec.ts`.

**Anchor files:** `apps/web/src/modules/dashboard/tv/scenes/SceneProduction.tsx` and `apps/web/src/modules/dashboard/tv/components/TvPrimitives.tsx` for
the scene; `apps/api/src/modules/machine/` for the master; `src/jobs/eway-bill.job.ts` plus its
`QUEUES` entry for the escalation sweep; `modules/notifications/notify.ts` for escalation.

## Out of scope

Assigning the job that should run next (MES1, Phase 3); maintenance work orders (P2-05 — an andon
call may _create_ one there, not here); the OEE calculation itself; andon hardware towers.

## Acceptance

- `machine-state.spec.ts`: a transition closes the open span and opens exactly one new one;
  concurrent transitions cannot produce two open spans; the timeline over a day has no gaps or
  overlaps and durations sum to the elapsed period; a telemetry-derived stop and a manual stop
  produce the same shape with different `source`; a machine with no gateway is fully operable.
- `andon.spec.ts`: raise, acknowledge, clear with the state transitions and timestamps; clearing an
  unacknowledged call is refused; escalation notifies once per level and a sweep re-run does not
  re-notify; the realtime events fire with the tenant scoped.
- Reason master: retirement instead of deletion; a retired reason stays readable on historical spans.
- New models into `AUDITED_MODELS` and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
