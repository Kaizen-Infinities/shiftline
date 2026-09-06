# P0-11 — Field app module, sync rules, position feed

## Shipped

- `apps/api/src/modules/mobile` ported from sun-sea-mobile `backend-extension/` behind tenancy
  (compound uniques, `getCurrentCompany`, `emitToTenant`, interactive transactions), mounted at
  `/api/mobile` with the `mobile-app` permission module (view, create, manage); the seed's Sales
  Executive role has view + create.
- Conflict policy enforced server-side: server-owned tables rejected, collections and orders
  append-only, visits merged field by field (office plans, agent executes), 30-day tombstones,
  device headers required on writes, revoked devices refused with `DEVICE_REVOKED`, clock-skew
  warning. `MobileDevice` registry with list/revoke/restore endpoints.
- Position feed: `POST /api/mobile/position`, `GET /api/mobile/admin/positions`,
  `agentPosition:updated` on the tenant room, `AgentPosition` model, `AGENT_POSITIONS` retention
  class (90 days default).
- Dashboard map rewritten on the real feed; simulated roster and SIMULATED badge deleted.
- Seed: route `R01` per tenant. Migration `20260906223019_mobile_devices_positions`.
- Tests: `mobile.spec.ts` (13 cases); 83 tests green; leak suite sweeps every `/api/mobile` route.

## Half-done / known gaps

- Cheque OCR is wired but disabled until `ANTHROPIC_API_KEY` is set (your decision from the
  plan's "needed from you" list); the endpoint answers 503 and the app falls back to manual entry.
- The mobile app (sun-sea-mobile) must send `x-device-id` and `x-app-version` on push and
  position calls and handle `403 DEVICE_REVOKED` by wiping its local database. That is an app
  change in the separate repo; the server contract is in `mobile.types.ts`.
- Device-bound refresh tokens and remote wipe arrive with the device registry screens (P1-02);
  today revoke blocks sync only.
- No web screens yet for routes, visits, devices or the collections register; the endpoints are
  complete and the leak suite covers them.
- The bootstrap `company` block still comes from the Company row; branding per business place
  arrives with P1-08.

## Next

- P0-12: Playwright smoke (12 screens) and the CI e2e job.

## Blocked on you

- Branch protection and the approver handle (since P0-00).
- Anthropic API key for cheque OCR, or the decision to drop OCR.
