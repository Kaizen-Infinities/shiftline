# Shift console supervisor override — server-verified

**Changelog:** Unlocking supervisor mode on the shift console now needs a supervisor's own
sign-in and the new "Supervise" permission, checked by the server, instead of a shared passcode.

## Before

`ShiftExecutionBoard.tsx` compared the typed passcode to the literal `"1234"` in the browser and
printed the hint in the placeholder. Anyone at the console could unlock every hour row.

## Now

- Permission `shift-execution.supervise` is registered in `packages/shared/src/permissions.ts`.
  OWNER gets it on new tenants through the "every permission" template.
- `POST /api/shift-execution/supervisor-override` (`apps/api/src/modules/shift-execution/`) takes
  `{ email, password }` for the supervisor.
  - **Who can call it:** the caller needs `shift-execution.edit`.
  - **Rate limit:** the path is on the login rate limiter.
  - **Checks, in order:**
    1. The email is looked up in the current tenant only.
    2. The account must be active.
    3. The password is compared against the stored hash.
    4. The account's role must hold `shift-execution.supervise`.
  - **Failures:** a wrong password and an unknown or foreign email both get the same 401, so
    the endpoint does not reveal which emails exist. A real account without the permission
    gets a 403.
  - **Audit:** every attempt is written to the audit log as `SUPERVISOR_OVERRIDE_GRANTED` or
    `SUPERVISOR_OVERRIDE_DENIED` (migration `20260927000000_supervisor_override_audit` adds the
    enum values). The operator is `changedBy`, and the denial reason is recorded.
- The page keeps the "Supervisor Override" / "Supervisor Unlocked" pills and the "Supervisor
  Authorization" dialog. The dialog now asks for the supervisor's email and password and calls
  the endpoint. No passcode or hint remains in client code.
- Tests: `apps/api/test/integration/shift-execution.spec.ts` covers:
  - the grant, and that it is audited;
  - a wrong password, and that it gets the same answer as an unknown email;
  - a role without the permission;
  - a supervisor from another tenant, which is never found;
  - a caller without `shift-execution.edit`;
  - validation errors and an unauthenticated call.

## Not done

- The hourly-production API itself still lets anyone with `hourly_productions.edit` change any
  hour. The "only the active hour" lock was a workflow aid on the page and still is. The
  override decides what the console offers; it is not a server-side lock on the data.
- Existing tenants' OWNER roles do not pick up new permission keys automatically. Grant
  `shift-execution.supervise` under Settings → Users & access → Role permissions. A general
  "keep OWNER in sync with the registry" step belongs to provisioning and needs the named
  tenancy approver.
