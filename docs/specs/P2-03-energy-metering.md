# P2-03 — Energy metering and kWh attribution (M2)

## Why

Energy is the second-largest variable cost in moulding after material, and the backlog calls it
"the second input to real product cost". P1-19 shipped a cost sheet with material, labour and
overhead (`OVERHEAD_BASES` is `QUANTITY`, `MATERIAL_VALUE`, `LABOUR_HOURS` in
`apps/api/src/modules/costing/costing.service.ts`) and **no energy line at all** — energy is
currently absorbed into overhead. This package measures it and adds it as its own line. It is also
the raw input ESG reporting needs when an OEM customer starts asking.

Read `docs/specs/P2-00-shop-floor-foundation.md` first — meters use the same adapter and batched
write path as machine telemetry.

## Scope

- **`EnergyMeter`** master (audited): code unique per tenant, description, the machine it serves or
  the business place where it is a plant-level main, meter kind (`MACHINE`, `UTILITY`, `MAIN`),
  multiplier, adapter kind and encrypted connection settings, `isActive`. A meter may serve one
  machine or a group; the group case apportions.
- **`EnergyReading`**: meter, timestamp, cumulative kWh and the computed interval kWh, written in
  batches through the P2-00 write path. Not audited; its own `RetentionDataClass` value and
  `RETENTION_CLASSES` spec. Cumulative readings roll over — the interval computation must handle a
  counter reset without emitting a negative or an absurd spike (clamp and flag, never silently drop).
- **Adapter** behind `providers/` with `SIMULATOR` plus an unpinned `MODBUS_METER` adapter, reusing
  the `MachineProtocolAdapter` shape from P2-01 rather than inventing a second one where the
  interface fits.
- **Attribution.** `EnergyAllocation` per machine per shift: total kWh, and the split across the
  production orders that ran, apportioned by the run minutes from P2-02's `MachineStateSpan`
  (falling back to `HourlyProduction.runtimeMinutes` where there is no telemetry). Derived figures:
  kWh per shift, per production order, and per kg of output using the product weight already on the
  product master. Idle-state energy is attributed to the machine, not to any order.
- **Cost integration.** Add an `energyCost` line to the cost sheet in
  `modules/costing/costing.service.ts` (around the `materialCost` / `labourCost` / `overheadCost`
  total at lines 333-343), sourced from a single function this module exposes that returns energy
  for an order, or null where no meter covers the machine. **When it returns null the sheet must
  behave exactly as it does today** — energy stays inside overhead and `totalCost` is unchanged —
  so a tenant without meters sees no difference. That is the only change to P1-19's code.
- **Tariff** per business place with slab and time-of-day rates, so kWh becomes rupees on the cost
  sheet rather than a raw number.
- Routes `/api/energy-meters` CRUD, `/api/energy` (readings, allocations, per-order and per-kg
  reports), `/api/energy-tariffs` CRUD. New permission module `energy`
  (`view, configure, export`) in `permissions.ts`, feature `shop-floor`, paths in `api-paths.ts`,
  keys to OWNER, PRODUCTION and ACCOUNTS in `ROLE_DEFS`.
- Web: `/settings/energy-meters`, an energy report with kWh per shift, per order and per kg, and an
  energy tile on the production dashboard. Into `e2e/smoke.spec.ts`.

**Anchor files:** `apps/api/src/modules/machine-telemetry/` from P2-01 in full — this is that
pattern narrowed to one signal; `modules/inventory/jobs/eodStockSnapshot.job.ts` for a per-shift
roll-up job.

## Out of scope

Power quality, power factor and demand-charge optimisation; ESG and Scope 1–2–3 disclosure (ES1, a
later backlog item — this package is its raw input); solar or generator source accounting; billing
reconciliation against the utility's invoice.

## Acceptance

- `energy.spec.ts`, on the simulator: meter CRUD with encrypted settings never returned; interval
  kWh from cumulative readings; a counter rollover is clamped and flagged rather than producing a
  negative; a batch replay adds no duplicate readings; allocation across two production orders on
  one machine splits by run minutes and the parts sum to the shift total; idle energy attaches to
  the machine and to no order; kWh per kg matches a hand-computed case; tariff slabs convert kWh to
  rupees at the slab boundary.
- **The existing `costing` integration suite passes unchanged**, proving a meterless tenant's
  `totalCost` did not move, and a new case asserts the sheet gains an `energyCost` line when a meter
  covers the machine and double-counts nothing against overhead.
- `EnergyMeter` and the tariff into `AUDITED_MODELS`; `EnergyReading` deliberately not, with a test
  asserting so; all new models into `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
