# Hosting Shiftline on Railway behind Cloudflare

This runbook deploys the production application as four Railway services and publishes the two
public services through Cloudflare:

```text
Browser ── Cloudflare ── app.example.com ── Railway web (nginx + Vite build)
                   └──── api.example.com ── Railway api (Express + Socket.IO)
                                                    │
                                  Railway private network
                                                    │
                              PostgreSQL ───── worker (pg-boss)
```

Use separate `web`, `api`, and `worker` services. Do not run the worker in every API replica and
do not expose PostgreSQL or the worker publicly. These instructions assume the repository is in
GitHub and `example.com` is already an active Cloudflare zone.

> Railway and Cloudflare change their dashboards regularly. The field names below are current as
> of September 2026; the linked vendor documentation is the source of truth.

## 1. Pre-flight checks

Before creating production resources:

```bash
nvm use
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Resolve all failures before deploying. Never copy `docker/api.env`, the demo credentials, or an
existing development `.env` into Railway. Generate independent production secrets, for example:

```bash
openssl rand -base64 48  # JWT_ACCESS_SECRET
openssl rand -base64 48  # DATA_ENCRYPTION_KEY
openssl rand -base64 32  # optional PLATFORM_GATEWAY_WEBHOOK_SECRET
```

Keep those values in a password manager as well as Railway. Losing `DATA_ENCRYPTION_KEY` makes
encrypted tenant integration credentials unusable.

## 2. Create the Railway project

1. In Railway, create a project from the GitHub repository.
2. Add a **PostgreSQL** service. Keep its generated public networking disabled; applications use
   its private `DATABASE_URL` reference.
3. Add three GitHub services named `api`, `worker`, and `web`, all from the same repository and
   branch. Because this is an npm-workspaces monorepo, leave each service's root directory at the
   repository root.
4. Configure the service builds:

| Service  | Builder    | Dockerfile path       | Start command                                  |
| -------- | ---------- | --------------------- | ---------------------------------------------- |
| `api`    | Dockerfile | `apps/api/Dockerfile` | image default (`node apps/api/dist/server.js`) |
| `worker` | Dockerfile | `apps/api/Dockerfile` | `node apps/api/dist/worker.js`                 |
| `web`    | Dockerfile | `apps/web/Dockerfile` | image default (`nginx -g 'daemon off;'`)       |

The API and worker deliberately share one production image. Do not select the Dockerfiles' `dev`
targets. Railway supplies `PORT` to the API; nginx listens on port 80 in the web image.

Railway references: [monorepos](https://docs.railway.com/guides/monorepo),
[Dockerfiles](https://docs.railway.com/guides/dockerfiles), and
[service variables](https://docs.railway.com/guides/variables).

## 3. Configure domains before building the web app

Choose the final hostnames first:

```text
app.example.com  → web
api.example.com  → api
```

In Railway, add each hostname as a custom domain on its service and copy the DNS target Railway
shows. Do not invent or copy a target from another environment.

In Cloudflare **DNS**, create one `CNAME` per hostname using Railway's displayed targets. Start
with both records **DNS only** (grey cloud). This lets Railway validate ownership and provision
its origin certificates without another proxy in the middle. Wait for both Railway domains to
show as active and verify their certificates before enabling the Cloudflare proxy.

Railway reference: [custom domains](https://docs.railway.com/guides/public-networking). Cloudflare
reference: [create DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/).

## 4. Set production variables

### API

Set these on `api`. A Railway reference such as `${{Postgres.DATABASE_URL}}` should point to the
actual name of the PostgreSQL service in this project.

| Variable                           | Production value / guidance                                     |
| ---------------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`                         | `production`                                                    |
| `DATABASE_URL`                     | `${{Postgres.DATABASE_URL}}`                                    |
| `FRONTEND_URL`                     | `https://app.example.com`                                       |
| `BACKEND_URL`                      | `https://api.example.com`                                       |
| `JWT_ACCESS_SECRET`                | unique random value, at least 32 characters                     |
| `DATA_ENCRYPTION_KEY`              | different random value, at least 32 characters                  |
| `ADMIN_EMAIL`                      | initial platform administrator email                            |
| `ADMIN_USERNAME`                   | initial platform administrator username                         |
| `ADMIN_PASSWORD`                   | unique password, at least 12 characters                         |
| `COOKIE_SECURE`                    | `true`                                                          |
| `REFRESH_COOKIE_SAMESITE`          | `lax` when both hosts remain under the same registrable domain  |
| `EMBED_WORKER`                     | `false`                                                         |
| `PGBOSS_SCHEMA`                    | `pgboss`                                                        |
| `LOG_FORMAT`                       | `json`                                                          |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | optional; set the environment to `production`                   |
| `SMTP_*`, `FROM_NAME`              | production mail provider; required for real invitation delivery |
| `IMAGEKIT_*`                       | recommended for durable uploaded images                         |

Also set any integrations that are actually enabled (`PLATFORM_GATEWAY_WEBHOOK_SECRET`,
`ANTHROPIC_API_KEY`, or S3 variables). Leave disabled integrations unset rather than using dummy
values. Do **not** set `RUN_MIGRATIONS=true` on the continuously running API service.

### Worker

Set `NODE_ENV=production`, the same `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, integration secrets,
and mail settings on `worker`. Set `EMBED_WORKER=false`. The worker does not need a public domain.

Railway service variables are isolated, so shared values must be supplied through Railway shared
variables or explicit references; setting a value on `api` does not automatically set it on
`worker`.

### Web (build-time variables)

Set these before triggering the `web` build:

```text
VITE_API_URL=https://api.example.com/api
VITE_API_BASE_URL=https://api.example.com/api
VITE_IMAGE_URL=https://api.example.com
```

Vite embeds `VITE_*` values into browser assets at build time. Changing one requires a new web
deployment; restarting the existing container is not enough. Never put a secret in a `VITE_*`
variable because every visitor can read it.

`VITE_API_BASE_URL` is currently also used by employee photo views. Keep it aligned with
`VITE_API_URL` until those call sites are consolidated.

### Database-role security checkpoint

The local PostgreSQL bootstrap creates separate `shiftline_migrator` and non-bypass
`shiftline_app` roles, but Railway does not run `docker/postgres/init.sql`. The generated Railway
database URL normally uses the database owner for both migrations and application traffic. That
is sufficient to boot the current deployment, but it does **not** reproduce the intended
least-privilege runtime role and may weaken the database-level RLS defence in depth.

Before accepting real multi-tenant production data, have the deployment reviewed and provision a
non-owner, `NOBYPASSRLS` runtime role plus a separate migration role/URL. Test that the runtime
role can use every migrated table and sequence, cannot disable or bypass RLS, and cannot read a
foreign tenant under an adversarial integration test. Do not copy the development passwords from
`docker/postgres/init.sql`. Until the application has a documented two-URL production path, treat
this role split as a launch blocker rather than assuming Railway's owner URL is equivalent.

## 5. Migrations, health checks, and deploy order

Configure the API's Railway **pre-deploy command** as:

```bash
npx -w @shiftline/api prisma migrate deploy
```

This runs migrations once before the new API deployment is made active. Do not use
`prisma migrate dev`, `prisma db push`, or the demo seed in production. The API image entrypoint
also supports `RUN_MIGRATIONS=true`, but that is intended for a one-shot job; enabling it on every
replica can race during scaled or rolling deploys.

Set the API health-check path to `/ready`. It verifies database readiness, whereas `/health` is
only liveness. Give migrations and cold starts a reasonable timeout. The worker should deploy
only after the first successful API migration; it has no HTTP health endpoint and needs no public
networking. Deploy in this order for the initial release:

1. PostgreSQL;
2. API migration and API;
3. worker;
4. web.

Railway references: [pre-deploy commands](https://docs.railway.com/guides/pre-deploy-command) and
[health checks](https://docs.railway.com/guides/healthchecks).

## 6. Durable files and backups

Railway container filesystems are disposable. Uploaded files, archives, exports, and database
dumps must not depend on the image filesystem surviving a restart.

- Prefer ImageKit or the supported S3 storage driver for user uploads.
- Attach a Railway volume to the **worker** at `/data` and set `ARCHIVE_DIR=/data/archives`,
  `BACKUP_DIR=/data/backups`, and `EXPORT_DIR=/data/exports` if those jobs write locally.
- If API requests create exports directly, attach a separate API volume and set its `EXPORT_DIR`.
  A volume is not shared automatically between Railway services.
- A volume is not an off-site backup. Copy database dumps to versioned object storage with a
  retention policy and perform the restore drill in `backup-restore.md` at least quarterly.
- Enable Railway PostgreSQL backups appropriate to the plan, but retain application-generated,
  independently restorable dumps as a second recovery path.

Railway reference: [volumes](https://docs.railway.com/guides/volumes).

## 7. Put Cloudflare in front

After Railway reports both custom domains healthy:

1. Change the two Cloudflare CNAME records to **Proxied** (orange cloud).
2. In **SSL/TLS**, choose **Full (strict)**. Never use Flexible: browser-to-Cloudflare HTTPS with
   Cloudflare-to-origin HTTP breaks the application's security assumptions.
3. Leave WebSockets enabled. Socket.IO uses `api.example.com/socket.io/` and needs HTTP upgrade
   traffic to reach the API.
4. Create a cache rule that bypasses cache for `api.example.com/*`, including `/api/*`,
   `/socket.io/*`, `/health`, and `/ready`. Authenticated JSON and Socket.IO traffic must never be
   edge-cached. The web image already marks fingerprinted `/assets/*` immutable, so Cloudflare may
   cache those static files normally.
5. Do not add a blanket JavaScript challenge to API or Socket.IO paths. If Bot Management or WAF
   rules are enabled, explicitly skip interactive challenges for those paths and rate-limit only
   after observing normal application traffic.
6. Redirect HTTP to HTTPS using Cloudflare's **Always Use HTTPS** setting.

Cloudflare references: [Full (strict) mode](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/),
[WebSockets](https://developers.cloudflare.com/network/websockets/), and
[cache rules](https://developers.cloudflare.com/cache/how-to/cache-rules/create-dashboard/).

## 8. Production verification

Run these checks through the final Cloudflare hostnames, not Railway's temporary domains:

```bash
curl -fsS https://api.example.com/health
curl -fsS https://api.example.com/ready
curl -I https://app.example.com/
curl -I https://app.example.com/assets/<an-asset-from-the-built-index>
```

Then verify in a private browser window:

1. the login page loads without mixed-content or CORS errors;
2. the platform administrator can sign in, refresh the page, and sign out;
3. an invitation email uses `https://app.example.com/accept-invitation`;
4. DevTools shows the refresh cookie as `Secure`, `HttpOnly`, and the intended `SameSite` value;
5. the Socket.IO connection upgrades successfully and the UI's live indicator connects;
6. a file upload and download survive a redeploy;
7. a queued job is consumed once by `worker`, not by `api`;
8. `/ready` fails if database access is deliberately removed, while `/health` remains a liveness
   signal;
9. Cloudflare returns dynamic API responses as uncached (`CF-Cache-Status` must not be `HIT`);
10. logs contain request IDs but no tokens, passwords, cookies, or tenant secrets.

## 9. Updates and rollback

For routine releases, take or verify a backup, deploy the API migration, API, worker, then web.
Prisma production migrations must be backward-compatible with the currently running release
during a rolling deploy. If an application release fails, roll the services back in Railway; do
not delete migration rows or automatically reverse a schema migration. For a destructive schema
problem, stop API and worker writes and follow `backup-restore.md` to restore into a **new**
database before changing `DATABASE_URL`.

After changing a custom domain, update all three of `FRONTEND_URL`, `BACKEND_URL`, and the web's
build-time URLs, redeploy, and recheck CORS, refresh cookies, invitations, uploads, and Socket.IO.
