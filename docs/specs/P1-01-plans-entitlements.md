# P1-01 — Plan tiers and entitlements (PF2)

**Goal.** Shiftline is sold in tiers. A tenant's plan decides which parts of the product its users
can reach, how many seats it has and how hard it may hit the API; the platform can put a tenant on
a plan, pause it, and switch individual features on or off without a deploy.

## Model

- **Feature registry** (`packages/shared/features.ts`): `FEATURES` maps every permission-registry
  module to exactly one feature (`core`, `sales`, `purchase`, `inventory`, `production`, `accounts`,
  `payroll`, `field-app`, `insights`, `api-access`). `featureForPermission("production_orders.view")`
  gives `production`. `core` is always on. `PLAN_TIERS` seeds three plans: Starter (core, sales,
  purchase, inventory; 5 seats; 600 API requests per 15 min), Growth (adds production, accounts,
  field-app; 25 seats; 3,000), Enterprise (everything; unlimited seats; 12,000).
- **Plan** (global): code, name, features, seat and API limits, price, active, sort order. Seeded from
  `PLAN_TIERS` by `provisioningService.ensurePlans()`; edits in the row win over the registry.
- **Subscription** (one per tenant, RLS, audited): plan, status (TRIALING, ACTIVE, PAST_DUE,
  SUSPENDED, CANCELLED), optional seat and API-cap overrides, trial end, period dates, notes.
  Provisioning creates it: the Starter trial (14 days) by default, or `planCode` +
  `subscriptionStatus` when the platform admin passes them. The demo seed is Enterprise, active.
- **FeatureFlagOverride** (per tenant, RLS, audited): feature, enabled, reason, optional expiry.

## Resolution and enforcement

`entitlementService.resolve()` (cached 60 s per tenant, invalidated on every platform change and
announced to the tenant's sockets as `entitlements:updated`) returns plan, status, effective
features (plan ∪ enabling overrides − disabling overrides, expired ones ignored), seat limit and
usage (active users + live invitations), API cap, trial/period dates, `readOnly`
(SUSPENDED/CANCELLED) and `pastDue`. A tenant without a subscription resolves to `core` only.

- **Routes.** `requirePermission` and `requireAnyPermission` now also require the permission's
  feature; the six modules that were authenticated but had no permission checks (payroll, expenses,
  GRN, inventory, product capacity history, product shift records) carry a router-level
  `requireFeature()`. Refusals are 403 with `code: FEATURE_NOT_IN_PLAN` and `details.feature`; a
  write on a suspended or cancelled tenant is 403 `SUBSCRIPTION_INACTIVE` (reads still work so data
  can be exported). Platform admins pass every gate. `ApiError` gained `code` and `details`, which
  the error middleware returns.
- **Seats.** `assertSeatAvailable()` (fresh count) runs before an invitation or a direct user
  create; 403 `SEAT_LIMIT_REACHED`. Re-inviting a pending address replaces it and costs no seat.
- **API cap.** `authMiddleware` counts every authenticated tenant request in a 15-minute window
  (in-memory; per process) against the plan or subscription cap, sets `RateLimit-*` headers and
  answers 429 `API_LIMIT_REACHED` with `Retry-After` when exceeded. Platform admins and tenants
  without a cap are not counted.
- **Exposure.** `GET /api/auth/me` and `GET /api/entitlements` return the entitlements; the mobile
  bootstrap returns plan, status, features and `readOnly`.

## Platform API (super admin)

`GET /api/platform/plans` (catalogue + feature registry), `PUT /api/platform/plans/:code`;
`GET/PUT /api/platform/tenants/:id/subscription` (plan, status, seats, API cap, dates; creates the
subscription for a legacy tenant); `PUT/DELETE /api/platform/tenants/:id/overrides/:feature`.
`POST /api/platform/tenants` accepts `planCode` and `subscriptionStatus` and returns the
entitlements; the tenant list shows plan and status.

## Web

`usePermission().can()` is plan-aware (permission held _and_ feature in plan), so every sidebar
entry, button and route guard follows the plan without per-screen work; `holds()` and
`hasFeature()` separate "not in your plan" from "no permission". `ProtectedRoute` sends a held
permission whose feature is missing to `/upgrade?feature=…` (new page naming the feature and the
current plan) instead of 403, and accepts a `feature` prop for permission-less screens.
`useEntitlement()` exposes plan name, read-only and past-due flags for banners. The socket event
reloads the profile when the platform changes a plan.

## Tests

`entitlements.spec.ts` (6): catalogue and Enterprise demo; Starter trial refused production,
payroll and the field app with codes; upgrade opens, override closes and expires, enabling
override adds, removal takes away; seats stop invitations at the limit and re-invites are free;
API cap answers 429 with headers and never counts platform admins; suspended tenant is read-only
while the demo tenant is unaffected. 136 API tests.

## Edge cases that matter

- A permission that maps to no feature counts as core (new modules default open; add them to the
  registry deliberately).
- Cache: platform changes invalidate immediately; a tenant's own seat usage is counted fresh at
  the moment of adding a seat, not from the cache.
- Browser tests run on the Enterprise demo tenant; the onboarding flow's Starter trial only touches
  core screens.

## Done means

A Starter tenant cannot open production, accounts, payroll or the field app from the web or the
API; the platform can upgrade, pause and override without a deploy; seats and API caps hold;
Gate 1's "on a plan" clause is satisfied.
