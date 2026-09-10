# P1-02 — Platform admin console and device registry (PF3 + B1)

**Goal.** A Shiftline operator runs the fleet from inside the app: sees every tenant with its plan,
usage and onboarding state, provisions new ones, suspends or reactivates, adjusts subscriptions
and feature overrides, reads a tenant's audit trail, revokes a lost phone, and, with a stated
reason and a thirty-minute cap, acts as one of the tenant's users. Field phones hold refresh
tokens bound to the device, so a revoked phone is signed out at once and wipes itself.

## Impersonation

- `POST /api/platform/tenants/:id/impersonate { userId?, reason }` (super admin). Default user is
  the tenant's active Owner. Creates an `ImpersonationSession` row (platform data, row-secured
  like every tenant table, never deleted: admin, admin session, company, user, reason, started,
  expires, ended, ended reason, ip) and returns a **30-minute access token** for that user. The
  token carries `impersonatedBy: admin_<id>` and `impersonationId`, keeps `isSuperAdmin: false`
  and rides on the admin's own `UserSession` (there is no refresh token: when the window closes
  the admin is an admin again).
- `authMiddleware` accepts such a token only while the session row is live and unended and the
  admin is active; it runs the request inside the tenant with `impersonatedBy` set, so
  `app.impersonated_by` reaches every audit trigger and every audit row written meanwhile names
  the admin (`impersonatedBy`) as well as the user (`changedBy`). Platform routes refuse it.
- `POST /api/auth/impersonation/end` (the impersonated token itself) and
  `POST /api/platform/impersonations/:id/end` (the console) end it early; `GET
/api/platform/impersonations?companyId&active` is the history. A tenant user calling
  impersonate gets 403; a missing reason 400; an unknown user 404.
- Web: the tenant page's **Act as owner** and per-user **Act as** buttons ask for the reason, swap
  the in-memory access token and reload the profile; `ImpersonationBanner` (amber, in the app
  shell) names the user and reason, counts down and **Stop impersonating** ends the session,
  restores the admin token from the refresh cookie and returns to `/platform`.

## Device-bound sessions and revoke-and-wipe (B1)

- `UserSession.deviceId` (migration `20260907130000_impersonation_device_sessions`). A login that
  sends `x-device-id` (the field app) binds the session to that device; `authMiddleware` and
  `POST /auth/refresh` refuse the session from any other device (401 `DEVICE_MISMATCH`).
- Revoking a `MobileDevice` (office: `POST /api/mobile/admin/devices/:id/revoke`; console:
  `POST /api/platform/tenants/:id/devices/:deviceId/revoke`) also ends every active session bound
  to that device, so the phone's next call is 401 and its refresh is 403 `DEVICE_REVOKED`, the
  signal the app already treats as "wipe the local database". Restore clears the flag; the agent
  signs in again.
- Web: `/settings/devices` (`mobile-app.manage`) lists the company's devices with revoke-and-wipe
  and restore; the console's tenant page has the same list.

## Console API (super admin)

- `GET /api/platform/overview`: tenants (total, active, suspended, onboarded), active users,
  active devices, subscriptions by status and by plan, live impersonations.
- `GET /api/platform/tenants/:id`: company record, subscription, overrides, entitlements, usage
  (users, active users, pending invitations, active devices, last-30-day invoices, vouchers and
  GRNs, last login) and the owners. Reads run under the tenant's own row-level context.
- `PUT /api/platform/tenants/:id { isActive?, suspendReason?, companyName?, legalName?, email?,
phone? }`. `isActive: false` ends every session of the tenant; `authMiddleware` and login then
  answer 403 `TENANT_SUSPENDED` for its users until `isActive: true`. Platform admins still see
  and edit the tenant.
- `GET …/overrides`, `GET …/users`, `GET …/audit` (same query as `/api/audit-trail`),
  `GET …/devices`, `POST …/devices/:deviceId/revoke`, plus the existing subscription and
  override routes from P1-01 and `POST /api/platform/tenants` from P1-00.

## Web

`/platform` (overview), `/platform/tenants` (list, search, **New tenant** provisioning form that
invites the owner and shows the invitation link when email is not configured),
`/platform/tenants/:id` (record, suspend/activate, subscription editor, overrides editor with the
feature registry, tabs for users, devices, audit trail and impersonation history),
`/platform/plans` (catalogue). All behind `ProtectedRoute superAdmin`; the sidebar's **Platform**
section is `superAdminOnly`. `e2e/platform.spec.ts` signs in as the admin, opens the demo tenant,
acts as its owner, sees the banner and stops.

## Tests

`impersonation.spec.ts` (start, audit marker, list, self-end, console-end, refusals, device
binding, mismatch, rotation, revoke), `platform-console.spec.ts` (super-admin only, overview,
detail, users, overrides, audit, devices, suspend locks out and login says why, activate). The RLS
sweep covers the new table; routes and leak snapshots updated.

## Done means

An operator provisions, inspects, suspends and reactivates a tenant from the console; every
change made while acting as a user carries the admin's name in the tenant's audit trail and the
window cannot outlive thirty minutes; a revoked phone cannot refresh or call the API again.
