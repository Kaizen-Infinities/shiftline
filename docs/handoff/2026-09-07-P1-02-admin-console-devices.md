# P1-02 — Platform admin console and device registry

## Shipped

- Impersonation (`modules/platform/impersonation.*`): `POST /platform/tenants/:id/impersonate`
  with a reason, a 30-minute token carrying `impersonatedBy`, `ImpersonationSession` rows,
  self-end and console-end, history; `authMiddleware` honours and bounds it; audit rows written
  meanwhile name the admin. Migration `20260907130000_impersonation_device_sessions`.
- Device-bound sessions (B1): `UserSession.deviceId` from `x-device-id` at login; auth and
  refresh refuse other devices; revoking a device ends its sessions (401 then 403
  `DEVICE_REVOKED`, the app's wipe signal).
- Console API (`modules/platform/console.*`): overview, tenant detail with usage, suspend /
  activate (sessions ended, login and auth answer 403 `TENANT_SUSPENDED`), overrides, users,
  audit trail, devices, revoke.
- Web: `/platform`, `/platform/tenants`, `/platform/tenants/:id`, `/platform/plans` behind
  `ProtectedRoute superAdmin` and a super-admin-only sidebar section; `ImpersonationBanner` in the
  app shell; `/settings/devices` for the office (`mobile-app.manage`).
- Tests: `impersonation.spec.ts` (3), `platform-console.spec.ts` (2); `e2e/platform.spec.ts`
  (console, act as owner, banner, stop) and `/settings/devices` in the smoke suite.
- Fixes found on the way: the route guard looped `fetchCompany()` for platform admins (they
  have no tenant) until the rate limiter tripped; `authMiddleware` now logs unexpected errors
  instead of hiding them behind a 401.

## Half-done / known gaps

- The console does not edit plans (the API's `PUT /platform/plans/:code` exists; the page is a
  catalogue). Backups have an API (`/platform/backups`) but no screen yet.
- Suspension keeps `suspendReason` in the request only; the company record has no column for it.
  A `CompanyNote`/status history would give operators the why and when.
- Impersonation tokens cannot be refreshed by design, but the web client's 401 handler will
  quietly refresh the admin cookie when the window ends, dropping the user back into the admin
  session without a message. A "your window ended" toast would be kinder.
- Platform admins have no notification centre (unchanged from P1-00).
- The legacy `POST /api/users` (password by email) is still in place; the tenant Users screen
  gets its Invite button and that path goes in a follow-up, as P1-00 noted.
- Rate limiting is per process and per IP; the console's fleet reads are cheap but a large
  fleet will want pagination on `/platform/tenants`.

## Next

- P1-03 PF8 full account export (pg-boss zip of every tenant table plus attachments manifest,
  signed 24-hour link), then P1-04 PC7 approval gates and P1-05 status page and insights.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.

## Changelog sentence

Platform operators get a console to provision, inspect, suspend and act as a tenant's user for
thirty minutes with every change marked in the audit trail, and a lost field phone can be revoked
so it signs out and wipes itself.
