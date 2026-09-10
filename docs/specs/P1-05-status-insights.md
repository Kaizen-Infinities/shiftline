# P1-05 — Status page and insights endpoints (PF6, B3)

## Why

Customers and the companion app need to know whether Shiftline is up without signing in, and
the TV wall, the Field app and external dashboards need a handful of read-only numbers without
each screen hitting a dozen list endpoints.

## Scope

- `modules/status/status.service.ts`: one pass over the database, the migration ledger, the
  worker heartbeat (pg-boss `platform.heartbeat`, stale after 5 minutes) and the last backup
  run (stale after 36 hours). `/ready` reads it (unchanged contract) and the new public
  `GET /api/status` publishes `{ overall, components: { api, database, migrations, worker,
backups }, checkedAt }` with coarse states (`ok | degraded | down | unknown`) and one plain
  sentence each. No migration names, hosts or versions. `Cache-Control: public, max-age=30`;
  503 when the database is down. Rate-limited like every other route.
- Web `/status` (no sign-in) polls it every 30 seconds and shows the components.
- `modules/insights`: `GET /api/v1/insights/{summary,accounts,ageing,field-team,plant,attention}`
  behind `authMiddleware` + `insights.view` (feature `insights`, on the Enterprise tier;
  Accounts, Production and Sales Executive roles hold the key). Answers are computed from the
  tenant's rows through the existing services (TV summary, ageing, bank balances, positions)
  and cached 60 seconds per tenant and endpoint in memory; responses carry
  `Cache-Control: private, max-age=<ttl>` and `X-Cache: HIT|MISS`.

## Out of scope

A hosted status page and incident history (there is no hosting yet); webhooks or push for
alerts; a shared cache across API processes.

## Acceptance

- `health.spec.ts`: `/api/status` answers without auth, coarse states only, cache header.
- `insights.spec.ts`: every endpoint 200 for a permitted user with MISS then HIT; 403 without
  the key and 401 anonymous; a different tenant gets its own miss and its own (empty) numbers.
- Leak suite sweeps the six GET routes; RLS forced on nothing new (no schema change).
