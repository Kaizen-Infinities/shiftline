# P1-01 — Plan tiers and entitlements

## Shipped

- Feature registry and plan tiers in `@shiftline/shared`; `Plan`, `Subscription`,
  `FeatureFlagOverride` models (migration `20260907040000_plans_subscriptions`, RLS, audit
  triggers); provisioning assigns the Starter trial (or a named plan), the demo seed is Enterprise.
- Entitlement resolution with a per-tenant cache and socket invalidation; every permission check now
  implies its feature; six auth-only modules gated by `requireFeature()`; seat cap on invitations and
  user creation; per-tenant API cap with `RateLimit-*` headers; `code`/`details` on error responses.
- Platform endpoints for plans, subscriptions and overrides; entitlements in `/auth/me`,
  `/api/entitlements` and the mobile bootstrap.
- Web: plan-aware `can()`, `holds()`/`hasFeature()`, `useEntitlement()`, `/upgrade` page, route
  guard redirects, profile refresh on `entitlements:updated`.
- Tests: 136 API (entitlements.spec.ts adds 6).

## Half-done / known gaps

- The API cap is per process (in-memory). Horizontal scaling needs a shared counter (Redis or a
  Postgres table); the enforcement point is a single function.
- Payroll, expenses, GRN, inventory, product capacity history and product shift records still have
  no per-route RBAC (only auth plus the plan feature); HR2 and the purchase packages add their
  permission keys.
- No platform screens yet: plans and subscriptions are managed through the API until the admin
  console (P1-02).
- No billing: Razorpay Subscriptions (P1-21) will drive status transitions; today the platform sets
  them by hand.
- The web shows no trial/past-due banner yet; `useEntitlement()` exposes the flags for it.

## Next

- P1-02 PF3 admin console and B1 device registry.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
