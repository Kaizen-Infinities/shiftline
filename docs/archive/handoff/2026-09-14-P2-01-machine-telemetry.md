# P2-01 — machine telemetry

## Shipped

Machine gateways that pull signals off a press (or a file, or nothing at all yet) and roll them
into cycle counts, on a per-tenant poll cadence, with a settings screen to configure them and a
health strip on each machine's detail page.

**Schema** (`apps/api/prisma/schema.prisma`, migration
`apps/api/prisma/migrations/20260914000000_machine_telemetry/`): `MachineGateway` (one per
machine, an `adapterKind`, JSON `connectionSettings`, encrypted `credentialsEncrypted`, poll
interval, failure/last-seen tracking), `MachineSignalMap` (vendor tag → canonical signal per
gateway), `MachineSignal` (raw timestamped samples, `@@unique([companyId, machineId, signal,
timestamp])` for idempotent ingestion), `MachineCycle` (roll-up of completed cycles,
`@@unique([companyId, gatewayId, endedAt])`, same reason). RLS and audit triggers on the first
three; `MachineSignal` is deliberately unaudited (high-volume raw samples, not a book or a
master) and instead carries a new `MACHINE_TELEMETRY` retention class (7-day floor, 30-day
default, purgeable) in `retention.policy.ts`/`retention.service.ts`.

**Registries:** `machine-telemetry` permission module (`view`/`configure`/`ingest`) in
`packages/shared/src/permissions.ts`; a `shop-floor` feature (Growth plan and above) in
`features.ts` gating it; `machineGateway`/`machineTelemetry` paths in `api-paths.ts`;
`provisioningService`'s PRODUCTION role granted `machine-telemetry`.

**Backend module** (`apps/api/src/modules/machine-telemetry/`): CRUD + test-connection +
signal-map endpoints for gateways, read endpoints for canonical signals / recent signals /
cycles / fleet health. Adapters live behind a `MachineProtocolAdapter` interface
(`connect`/`poll`/`subscribe`/`disconnect`/`describe`/`cursor`) in `providers/`, dispatched by
`providerFor(adapterKind)`:

- **SIMULATOR** — a deterministic, seeded (mulberry32) state machine producing a repeatable
  9-tick script of temperatures, pressures and cycle completions. The only adapter that has ever
  actually run end-to-end.
- **EUROMAP63_FILE** — a genuinely working file-poll mechanism: watches a directory for
  EUROMAP63 host-interface flat files, diffs against the last-seen values (persisted via
  `cursor()`), translates through the signal map. Real code path, but its tag-name dictionary is
  illustrative — never checked against an actual press's file output.
- **OPCUA_EUROMAP77** / **MODBUS_MQTT** — honest stubs. `connect()`/`poll()` throw, naming the
  exact library (`node-opcua`, `modbus-serial`/`mqtt`) and hardware access that pinning them
  would need. `describe()`/`cursor()` work so they can still be configured and listed; "test
  connection" against either will always fail until someone with the hardware does that work.

**Ingestion:** `apps/api/src/jobs/machine-telemetry-poll.job.ts` on pg-boss — a per-minute
fanout (`MACHINE_TELEMETRY_FANOUT`) that enqueues one `MACHINE_TELEMETRY_POLL` job per active
gateway (tenant-scoped, `runAsTenant`), each writing samples via `createMany({ skipDuplicates:
true })` and rolling completed cycles into `MachineCycle` the same way. Failure count and
`notify()` (crossing 3 consecutive failures) live on the gateway row.

**Web:** `/settings/machine-gateways` (`MachineGatewaysPage.tsx`) — list, create/edit, delete,
test-connection, and an inline signal-map editor, gated on `machine-telemetry.configure`/`.view`
and the `shop-floor` feature. `MachineTelemetryHealthStrip.tsx` renders on a machine's edit page
(`MachineForm.tsx`) showing that machine's gateway(s) with a coloured status dot, or a link to go
set one up. Sidebar entry, route, and `/settings/machine-gateways` in `e2e/smoke.spec.ts` and
`docs/specs/P1-UI-remake.md`'s route inventory.

## Tests

`apps/api/test/integration/machine-telemetry.spec.ts`, 10 tests: gateway CRUD + test-connection

- delete happy path, signal-map replace (including a second replace that fully swaps rows),
  cross-tenant 404 on a foreign gateway, permission refusal for a role without
  `machine-telemetry.view`, a full poll cycle against the simulator asserting the exact sample and
  cycle counts a 9-tick script produces, idempotent replay (resetting the gateway's persisted
  cursor and re-polling reproduces byte-identical output, no duplicate rows), and the
  notify-after-3-consecutive-failures / no-further-notify-on-the-4th threshold.

Full suite: 80 files, 510 tests, green (`vitest run --no-file-parallelism`). Typecheck (api, api's
test project, web, shared), lint (0 errors, the same 510 pre-existing warnings — none in any file
this package touched), prettier and `e2e:typecheck` all clean.

## Half-done / known gaps

- **OPCUA_EUROMAP77 and MODBUS_MQTT have never met hardware.** They are honest stubs, not
  simulated success — a tenant can select either adapter kind and see it in the gateway list, but
  "test connection" and every real poll will fail until someone pins a real client library
  against a real press or PLC.
- **EUROMAP63_FILE's mechanism is real; its tag dictionary is not confirmed.** The file-diff and
  cursor logic genuinely works and is exercised (indirectly, through the same interface the
  simulator test covers) — what's unconfirmed is whether the specific tag names it looks for
  match what a real EUROMAP63 host-interface file actually emits.
- No UI exists yet to browse raw `MachineSignal` history or `MachineCycle` roll-ups outside the
  health strip's live-status view — P2-02 (state timeline / andon) is the natural place for a
  timeline view over the same data.
- The web page is left in the pre-Phase-2 visual direction the rest of `/settings` is in
  (Tailwind, no Bootstrap) — consistent with everything else outside the P1-UI slice-2 direction,
  not a Phase 2 gap.

## Next

P2-02 (machine state timeline, downtime reasons, live andon) builds directly on
`MachineSignal`/`MachineCycle` from this package.

## Blocked on you

Nothing blocks starting P2-02. Whenever real hardware or vendor documentation for EUROMAP 77
(OPC UA) or a Modbus/MQTT-speaking press becomes available, pinning those two adapters against it
is real, scoped follow-up work — not urgent, since SIMULATOR carries the full configure/rehearse
flow today.

## Changelog

Machines can now be connected to a telemetry gateway (starting with a built-in simulator) that
tracks cycles and machine signals automatically, with live gateway health visible from the
machine's own page.
