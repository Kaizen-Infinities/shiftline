# P0-09 — Cross-tenant leak suite (F3 exit)

**Goal.** Prove, on every push, that tenant A cannot read or change tenant B's data through
any model or any route.

**Setup.** `prisma/seed-lib.ts` (`seedTenant`) is the development seed refactored into a
function; the suite seeds a second tenant (`TEN-B`, users `tenb.*`, prefixed codes for the
still-global keys) with the same shape as the demo tenant.

**Model sweep.** For every model in `TENANT_MODELS`, `findMany` as A and as B returns only that
tenant's `companyId`. Models with no rows in either tenant are listed in a snapshot
(`__snapshots__/leak.spec.ts.snap`) so a new model must be seeded or knowingly listed.

**Route sweep.** Routes come from `API_MOUNTS`. Every GET/PUT/PATCH/DELETE route whose path
parameters can be resolved to tenant B identifiers (by module prefix or parameter name) is
called as tenant A. Failures: any 5xx; B's `companyId` anywhere in a response; a 200 whose
body contains the B identifier used. Unresolvable routes (transactional documents without
seed rows yet) are snapshotted so coverage grows visibly. Before and after the sweep every
tenant table's rows for B are hashed (`md5(string_agg(row::text))` under bypass); any change
fails the test. `PUT /api/companies/:id` (global table) has its own test and a controller
guard (403 unless it is the caller's own company).

**Bugs the sweep exposed and fixed.** Bare `Error("Customer not found")` → 500 on
credit-status (now 404); BigInt JSON patch lived only in `server.ts` (now `lib/bigint-json.ts`
imported by `app.ts`); socket emits threw before `initSocket` (no-op emitter now); four batch
`$transaction([...])` calls rewritten as interactive transactions (the scoped client requires it).

**Done when.** Suite green locally and in CI; snapshots reviewed.
