# P1-03 — Full account export (PF8, DPDP)

**Goal.** A company can take everything it holds in Shiftline out in one file, without asking
anyone: every tenant-scoped table, the files its rows point at, and a manifest, built in the
background and downloadable for 24 hours by the requester or through a signed link.

## Format

`shiftline-export-<companycode>-<stamp>.tar.gz` (POSIX ustar + gzip, written by `lib/tar.ts`
with no dependency):

- `tables/<table>.ndjson`: one JSON object per row for every model in `TENANT_MODELS` (derived
  from the schema, so a new tenant table is exported automatically), ordered by primary key,
  1,000 rows a page. BigInt and Decimal become strings, dates ISO 8601 UTC, bytes base64.
  Columns in the secret list (`passwordHash`, session and refresh token hashes, MFA secrets,
  SMTP and WhatsApp credentials, API keys) are dropped from every table; the manifest lists them.
- `attachments/<path>`: files under this instance's `uploads/` folder that URL columns point at
  (employee photos, product images, expense receipts, field-app photos); external URLs are listed
  but not fetched.
- `manifest.json`: format version, company, generated-at, row count and file per table, the
  attachment index (table, id, column, url, included, file), excluded columns.
- `README.txt`.

## Lifecycle

`AccountExport` (tenant table, RLS; migration `20260907140000_account_exports`): status QUEUED →
RUNNING → READY | FAILED, then EXPIRED; requester, timestamps, file name, size, sha256, table
counts, attachment count, `tokenHash`, download count, error.

- `POST /api/account-export` (`account-export.create`): one open export per tenant (409
  `EXPORT_IN_PROGRESS`); enqueues `platform.account-export` (pg-boss, singleton per tenant) when a
  worker is attached, else builds inline. `runAccountExport()` writes to
  `EXPORT_DIR/<companyId>/`, sets `expiresAt = now + 24h`, hashes a 256-bit token and notifies the
  requester with the signed link. A failure marks FAILED with the message and notifies.
- `GET /api/account-export` (`account-export.view`, last 20; expires stale READY rows and deletes
  their files first), `GET /:id`, `GET /:id/file` (signed-in download),
  `GET /:id/download?token=` (no login; 404 unknown token, 410 expired). Downloads are counted.
- `EXPORT_DIR` (default `./exports`, `/app/exports` in Docker, gitignored).

## Web

`/settings/export` (`account-export.view`): request button (`account-export.create`), list with
status, contents, size, expiry, downloads; polls while an export builds; Download streams through
the session. Sidebar entry under Settings; in the smoke suite.

## Tests

`account-export.spec.ts`: permission, request and build, list, archive contents (manifest,
README, users without `passwordHash`, vouchers, own `account_exports` table, no global
`companies`), row counts tie to the manifest, signed link from the notification, bad token 404,
missing token 400, download counter, expiry flips the row and refuses both downloads, 409 while
one is in progress. The leak suite covers the new model; routes snapshot updated.

## Done means

A tenant owner requests an export, is told when it is ready, downloads an archive any archiver
opens, finds every table and every uploaded file listed in the manifest, and finds no secret in it.
