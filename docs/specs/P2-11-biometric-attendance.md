# P2-11 — Biometric attendance ingestion (HR1)

## Why

Attendance is typed in by hand into `AttendanceRecord` while a fingerprint reader on the wall
already has the data. Manual entry is the single largest source of payroll disputes and the easiest
thing on the shop floor to automate — the devices are already installed in most plants and speak a
well-known push protocol.

Read `docs/specs/P2-00-shop-floor-foundation.md` first. P1-16 statutory payroll has landed and
defines the wage structure these punches feed, but **it did not fix `AttendanceRecord.date`, which
is still a `String`** (`apps/api/prisma/schema.prisma`). Device punches carry real timestamps, so
this package migrates that column to a proper date rather than formatting timestamps into a string
to fit it. Do the migration first, with a backfill, and keep the existing payroll reads green.

## Scope

- **`AttendanceDevice`** master (audited): code unique per tenant, make (`ZKTECO`, `ESSL`,
  `MATRIX`, `GENERIC_ADMS`), serial number, business place, the door or gate it covers, an encrypted
  shared secret, `isActive`, last-seen and last-error. Device enrolment maps a device's internal
  user id to an `Employee` — this mapping is the part that goes wrong in practice, so it is an
  explicit, editable table, not an assumed equality.
- **ADMS push endpoint.** `POST /api/attendance-devices/adms` accepting the standard ADMS/`iclock`
  push format the named makes speak. This is the one route without `authMiddleware`: it
  authenticates by device serial plus shared secret, is rate-limited with the existing
  `tenant-rate-limit` helper, returns the protocol's expected bare response and never an error
  detail. A punch from an unknown serial is logged and dropped, never created.
- **`AttendancePunch`** raw rows: device, device user id, resolved employee (nullable until mapped),
  timestamp, direction where the device reports it, and the raw payload. Written through the P2-00
  batched path. **Not** audited; its own `RetentionDataClass` value and `RETENTION_CLASSES` spec.
  De-duplicated on device, device user and timestamp — devices re-send after a network gap.
- **Punch pairing** into `AttendanceRecord` under the existing shift, late and permission slabs:
  first-in and last-out per employee per date, with the overnight-shift case handled by the shift's
  own span rather than a calendar day. Odd punch counts produce an exception, not a guess.
- **Exception queue.** Unmapped device users, unpaired punches, punches outside any roster, and
  punches for an inactive employee, all surfaced for a human to resolve. Resolution writes the
  `AttendanceRecord` and is audited; nothing is auto-corrected silently.
- **Idempotent re-derivation:** re-running a date rebuilds its `AttendanceRecord` rows from punches
  without duplicating, so a late-arriving batch corrects the day.
- A pg-boss job per tenant pairs punches for the previous day and warns on unresolved exceptions.
- Routes `/api/attendance-devices` (CRUD, enrolment map, health) plus the ADMS endpoint, and
  `/api/attendance-punches` (list, exceptions, resolve, re-derive). New permission module
  `attendance-devices` (`view, configure, resolve`) in `permissions.ts`, feature `shop-floor`, paths
  in `api-paths.ts`, keys to OWNER and an HR/PRODUCTION set in `ROLE_DEFS`.
- Web: `/settings/attendance-devices` with health and the enrolment map, and an exception queue
  beside the existing payroll attendance screen. Into `e2e/smoke.spec.ts`.

**Anchor files:** `apps/api/src/modules/mobile/` — device-authenticated writes, `x-device-id`
headers and sync conflict rules already exist there and this is the same problem for a different
device; `modules/e-invoice/e-invoice.config.service.ts` for encrypted per-device secrets;
`modules/payroll/` for `AttendanceRecord` and the slabs.

## Out of scope

Face and palm recognition specifics beyond whatever the device already resolves to a user id;
enrolling fingerprints from Shiftline; access control and door opening; GPS or mobile attendance for
field staff, which `modules/mobile` already covers; employee self-service (HR5).

## Acceptance

- `attendance-device.spec.ts`: device CRUD with a secret that never appears in a response; the ADMS
  endpoint accepts a correctly signed push and refuses a wrong secret and an unknown serial without
  leaking which; a replayed batch creates no duplicate punches; an unmapped device user lands in the
  exception queue and its punch is retained; mapping the user and re-deriving produces the
  `AttendanceRecord`; first-in/last-out pairing with the late and permission slabs applied; an
  overnight shift pairs across midnight; an odd punch count raises an exception rather than
  inventing an out; re-deriving a date twice yields identical records; the endpoint is rate-limited.
- The `AttendanceRecord.date` migration backfills every existing row, and
  `statutory-payroll.spec.ts` and `labour-code.spec.ts` stay green.
- Cross-tenant: a device of tenant B cannot push into tenant A even with a valid-looking serial.
- `AttendanceDevice` and the enrolment map into `AUDITED_MODELS`; `AttendancePunch` deliberately not,
  with a test asserting so; all new models into `MODELS_WITHOUT_SEED_ROWS`;
  `npx vitest run routes leak -u`.
