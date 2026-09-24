# P2-01 — Machine telemetry ingestion and protocol adapters (M1)

## Why

Every shop-floor number in Shiftline today is typed by a person at the end of an hour. Machine
connectivity is the largest item in the backlog and the one the whole plastics differentiation rests
on: real cycle counts, real downtime, real state. It is also the item with no hardware yet, so it is
built adapter-first with a simulator and pinned against a press later.

Read `docs/specs/P2-00-shop-floor-foundation.md` first — the write path and the adapter pattern are
defined there and this spec assumes them.

## Scope

- **`MachineGateway`** master (audited): code unique per tenant, the machine it serves, adapter kind,
  connection settings, encrypted credentials, poll interval, `isActive`, last-seen timestamp and
  last error. **`MachineSignalMap`**: the per-gateway mapping from a vendor tag or address to a
  canonical signal name, so the ingestion service never learns a vendor's vocabulary.
- **Canonical signals** in `machine-telemetry.types.ts` — `STATE`, `CYCLE_COMPLETE`, `SHOT_COUNT`,
  `PART_COUNT`, `CYCLE_TIME`, `BARREL_TEMP`, `MOULD_TEMP`, `INJECTION_PRESSURE`, `ALARM` — with unit
  and datatype. Every adapter maps into these; nothing downstream reads a vendor tag.
- **`MachineProtocolAdapter`** interface (`connect`, `poll`, `subscribe`, `disconnect`, `describe`)
  behind `providers/` with `index.ts` exporting `PROVIDERS` and `providerFor(name)`:
  - `SIMULATOR` — deterministic, seeded, drives a machine through realistic state and cycle
    sequences including a jam and a recovery. This is what every test runs against.
  - `OPCUA_EUROMAP77`, `EUROMAP63_FILE`, `MODBUS_MQTT` — written, **unpinned**, and documented as
    never having met hardware, exactly as the GSP adapters are.
- **`MachineSignal`** raw samples: machine, signal, timestamp, numeric and text value. Written in
  batches per the P2-00 write path — one interactive transaction per flush interval, never one per
  sample. **Not** audited. New `RetentionDataClass` enum value plus a `RETENTION_CLASSES` spec with a
  short floor and `purgeable: true`.
- **`MachineCycle`** roll-up: one row per completed cycle with start, end, actual cycle seconds,
  parts produced and the production order in force. This is the table P2-04 and the OEE service read;
  nothing outside this module reads `MachineSignal`.
- **Ingestion service** on pg-boss: a poll job per active gateway under `runAsTenant`, idempotent
  (a re-delivered batch de-duplicates on machine, signal and timestamp), with a `QUEUES` entry in
  `lib/jobs.ts`, a handler in `src/jobs/`, and a schedule in `src/jobs/index.ts`. A gateway that
  errors marks `lastError` and notifies holders of `machine-telemetry.view` once, not every poll.
- Routes `/api/machine-gateways` (CRUD, test-connection, signal map) and `/api/machine-telemetry`
  (recent signals, cycles, gateway health). New permission module `machine-telemetry`
  (`view, configure, ingest`) in `permissions.ts`, feature `shop-floor`, paths in `api-paths.ts`,
  keys to OWNER and PRODUCTION in `ROLE_DEFS`.
- Web: `/settings/machine-gateways` with the gateway list, the signal-map editor and a live
  test-connection panel; a telemetry health strip on the machine detail. Both into
  `e2e/smoke.spec.ts`.

**Anchor files:** `apps/api/src/modules/e-invoice/providers/` for the adapter registry and the
fixture posture; `apps/api/src/modules/e-invoice/e-invoice.config.service.ts` for encrypted
per-tenant credentials; `apps/api/src/jobs/eod-snapshot.job.ts` for a scheduled per-tenant job;
`apps/api/src/modules/machine/` for the plain master shape.

## Out of scope

Any real hardware or a purchased gateway; writing **to** a machine (set-point changes) — read-only,
always; machine state derivation and downtime reasons (P2-02); energy meters (P2-03); OEE changes —
`modules/oee/` keeps computing from `HourlyProduction` until P2-04 gives it cycles.

## Acceptance

- `machine-telemetry.spec.ts`, entirely on `SIMULATOR`: gateway CRUD with encrypted credentials that
  never appear in a response; the signal map translates a vendor tag to a canonical signal and an
  unmapped tag is dropped with a counter, not an exception; a seeded simulator run produces a
  deterministic signal sequence; a flush writes one batch and a replayed batch adds no duplicate
  rows; cycles roll up with the expected count and durations from that run; a gateway error sets
  `lastError` and notifies once across three failing polls; the poll job is idempotent when
  pg-boss re-delivers.
- A test asserting `MachineSignal` is **absent** from `AUDITED_MODELS` and present in
  `RETENTION_CLASSES`, so a later change cannot quietly add a trigger per sample.
- Cross-tenant: a gateway of tenant B is invisible and un-pollable from tenant A.
- `MachineGateway`, `MachineSignalMap`, `MachineCycle` into `AUDITED_MODELS`; all four new models
  into `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
