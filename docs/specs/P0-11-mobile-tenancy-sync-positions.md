# P0-11 — Field app module behind tenancy, sync rules, position feed (A1, A2, A5)

**Goal.** Bring the Field app's backend extension (sun-sea-mobile `backend-extension/`) into
Shiftline as a tenant-scoped module with tests, make the offline-sync conflict policy something
the server enforces rather than the app promises, and replace the dashboard's simulated GPS
roster with a real position feed.

**Module.** `apps/api/src/modules/mobile` mounted at `/api/mobile`, permissions `mobile-app.view`
(bootstrap, pull, statement), `mobile-app.create` (push, positions, attachments, cheque OCR),
`mobile-app.manage` (routes, planning, collections, devices). Tenant scoping comes from the
Prisma extension and RLS; the port replaced the compound uniques (`companyId_clientId`,
`companyId_code`), `company.findFirst()` (now `getCurrentCompany()`), bare socket emits
(`emitToTenant`), array transactions (interactive) and `require()` (dynamic import). The order
status given to field orders is a tenant setting (`SystemSetting MOBILE_ORDER_STATUS`, DRAFT or
CONFIRMED, default DRAFT). Cheque OCR needs `ANTHROPIC_API_KEY` and answers 503 without it;
attachments go to ImageKit under `shiftline-mobile/<companyId>/…` (S3 optional). Collections
post exactly as the web receipt flow does: invoice payments JSON + `sales_invoice_payments`
rows + RECEIPT vouchers via `voucherPostingService`, an on-account RECEIPT for any remainder,
`customer.outstandingAmount` decremented, one `MobileCollection` row and one sync record, all in
one transaction. The payment reference id is `mc-<collection 18>-<invoice 8>` so it fits
`Voucher.refDocId` (36 chars).

**Conflict policy (A2), enforced in `mobile.sync.service.ts` and documented in `mobile.types.ts`.**

| Rule                  | Behaviour                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-owned tables   | customers, invoices, products, routes, route_customers are pull-only; pushed changes come back in `results.rejected` with reason `server-owned`                                                                                                                                              |
| Append-only documents | collections and orders honour `created` only; `updated`/`deleted` are rejected (`append-only`). The server assigns receipt and order numbers                                                                                                                                                 |
| Visits                | field-level merge: when the server row changed after the device's `lastPulledAt`, the office keeps planning fields (customer, route, date, time, sequence) and the agent's execution fields (status, outcome, check-in/out, position, notes) are applied; `results.visits.merged` lists them |
| Ownership             | a device may only change or delete its own agent's visits; others are rejected (`not-owner`)                                                                                                                                                                                                 |
| Tombstones            | soft-deleted visits and route customers are echoed in `deleted` for 30 days; the SYNC_TOMBSTONES retention class hard-deletes them afterwards                                                                                                                                                |
| Device identity       | `x-device-id` (8–64 chars) is required on push and position calls and optional on pull/bootstrap; `x-app-version`, `x-device-platform`, `x-device-model` are recorded                                                                                                                        |
| Revoked device        | `MobileDevice.revokedAt` set → every sync/push/position call fails `403 DEVICE_REVOKED`; office endpoints list, revoke and restore devices                                                                                                                                                   |
| Clock skew            | `x-device-time` more than five minutes off server time adds a `CLOCK_SKEW` warning to the response (data is stored as sent); `serverTime` is always returned                                                                                                                                 |
| Failed records        | posting failures are stored (`MobileCollection` FAILED, or only the sync record when the customer does not exist) and echoed on pull with `sync_error`                                                                                                                                       |

**Position feed (A5).** `POST /api/mobile/position` takes up to 500 points
(`latitude, longitude, accuracy_m, speed_kmh, heading, battery_pct, recorded_at`) per call, stores
`AgentPosition` rows and emits `agentPosition:updated` to the tenant room.
`GET /api/mobile/admin/positions?withinMinutes=` (mobile-app.manage or dash-overview.view) returns
the latest point per agent (`DISTINCT ON` inside the tenant transaction) with today's counters
(planned/completed visits, orders, collections, collected amount). Positions are personal data:
the new `AGENT_POSITIONS` retention class purges them after 90 days by default (floor 7).

**Schema.** `MobileDevice` (`companyId, deviceId, userId, platform, appVersion, model, firstSeenAt,
lastSeenAt, lastSyncAt, revokedAt, revokedBy`, unique per tenant+device) and `AgentPosition`,
both with RLS, in migration `20260906223019_mobile_devices_positions`; `RetentionDataClass`
gains `AGENT_POSITIONS`. The seed gives every tenant route `R01` with three customers and an
all-week assignment for the `<slug>.sales` user, so the leak suite exercises Route,
MobileRouteCustomer and MobileRouteAssignment and sweeps every `/api/mobile` route.

**Web.** `SalesPersonLiveMap` reads `/mobile/admin/positions`, listens to `agentPosition:updated`,
shows live (≤5 min), recent (≤30 min) and stale agents with today's counters, and shows an
explicit empty state when there is no feed. The hard-coded roster, the movement simulation and
the SIMULATED badge are gone (TRUST-01 closed).

**Tests.** `mobile.spec.ts` (13): bootstrap; full pull with masters, route and auto-planned visits;
device id required on push; collection posted once across two devices with balanced RECEIPT
vouchers and outstanding decremented; draft order created and echoed; failed record echoed;
server-owned and append-only rejections; visit field-level merge and not-owner deletion; route
customer tombstones; revoke/restore device; clock-skew warning; positions and latest endpoint;
office endpoints refused to field users. Leak and route snapshots updated.

**Done when.** 83 tests green; lint and typecheck clean; migration drift gate clean; no
simulated data left in the web app.
