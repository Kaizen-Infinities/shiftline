# P1-05 — status page and insights endpoints (PF6, B3)

## Shipped

- `modules/status/status.service.ts`: one component check (database, migration ledger, worker
  heartbeat, last backup) behind both `/ready` and the new public `GET /api/status`, which
  returns coarse states and one plain sentence per component, cached 30 seconds, 503 when the
  database is down. No migration names, hosts or versions in the public body.
- Web `/status` (no sign-in): overall banner, five components, refresh every 30 seconds.
- `modules/insights`: `GET /api/v1/insights/{summary,accounts,ageing,field-team,plant,attention}`
  behind `insights.view`; computed from the TV summary, ageing, bank balances, positions,
  devices, visits, collections, machines, production orders and pending filings; cached 60
  seconds per tenant and endpoint with `Cache-Control` and `X-Cache` headers.
- Permission module `insights` (feature `insights`, Enterprise tier); Accounts, Production and
  Sales Executive roles hold the key. `API_PATHS.insights` and `API_PATHS.status`.
- `insights.spec.ts` (3 tests), `/api/status` in `health.spec.ts`; route snapshot updated;
  `/status` in the smoke suite.

## Half-done / known gaps

- The cache is per API process; with more than one process each keeps its own 60 seconds.
- A hosted status page with incident history waits for hosting; `/status` is the in-app page.
- The mobile bootstrap does not yet advertise the insights endpoints; the companion app reads
  `entitlements.features` for `insights` and calls them directly.
- No web screen consumes the insights endpoints yet; the TV wall still uses `/dashboard/tv-summary`.

## Next

- P1-05 closes the platform-core block (P1-00 to P1-05). Next in the build order: P1-11
  e-invoice (needs GSP sandbox credentials; the provider interface and sandbox adapter can be
  built against recorded fixtures first), then P1-12 e-way bill, P1-13 GST returns.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  terms-of-service text. New for the next package: GSP sandbox credentials (e-invoice, e-way
  bill, IMS/returns APIs).

## Changelog sentence

A public status page shows whether Shiftline, its database, background jobs and backups are
healthy, and a read-only insights API gives the TV wall, the Field app and integrations the
day's numbers in one call each.
