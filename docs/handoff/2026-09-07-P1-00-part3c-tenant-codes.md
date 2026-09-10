# P1-00 part 3c — tenant-scoped business codes, Prisma decision

## Shipped

- Uuid primary keys and per-tenant unique codes for Store, Machine, RawMaterial, ProductionOrder,
  WeeklyMachineProgram, DailyProductionPlan, Location and Shift; 47 relations now pair the code with
  `companyId`, so cross-tenant references are impossible at the database level. API contract and
  web app unchanged (codes in paths and payloads; responses gain `id`).
- `byCode()` selector helper and a runtime rewrite in the tenant extension; 176 lookups migrated by a
  tsc-driven codemod; migration `20260907030000_tenant_scoped_codes`.
- `docs/decisions/2026-09-07-prisma-7-8.md`: stay on Prisma 6.19.x through Phase 1, move to 8 as a
  dedicated package after Gate 1; allowlist note corrected (7.10 does not fix deepmerge-ts).
- Tests: 133 API (tenant-codes.spec.ts adds 4).

## Half-done / known gaps

- Web code still calls these rows by code everywhere, which is fine; nothing displays the new `id`.
- `Location` is unused by the screens (kept for stores); it received the same treatment for
  consistency.
- The legacy `POST /api/users` (emailed password) is still mounted; retire it with the Users screen
  Invite button in P1-02.

## Next

- P1-00 close-out (docs, verification, CI), then P1-01 plan tiers and entitlements.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
