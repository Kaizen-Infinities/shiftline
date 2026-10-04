# P1-03 — Full account export

## Shipped

- `AccountExport` model and migration; `lib/tar.ts` (dependency-free ustar writer and reader);
  `jobs/account-export.job.ts` (`runAccountExport`, `expireAccountExports`, pg-boss handler on
  `platform.account-export`); `modules/account-export` routes; `EXPORT_DIR` env, Docker volume.
- Permission module `account-export` (view, create) in the core feature; owners get it.
- Web `/settings/export` page and sidebar entry; smoke entry; `account-export.spec.ts` (2 tests).

## Half-done / known gaps

- Exports are built on the worker's local disk. When hosting arrives the same job should write
  to object storage and the signed link should be the bucket's, not the API's.
- No CSV or XLSX flavour; accountants get NDJSON. A per-table CSV would be a small addition to
  the job (one writer per table).
- External attachment URLs (imagekit-era images) are listed in the manifest but not fetched.
- The 24-hour expiry is enforced lazily (on list and on download) plus by the row's status; there
  is no scheduled sweep, so a tenant that never returns leaves a file until the next list call.
  A daily cleanup in the backup job would close that.
- Retention (P0-10) still has no archive-to-export bridge: the sweep archives to NDJSON.gz per
  class; the account export covers live rows only.

## Next

- P1-04 PC7 approval gates on filings; P1-05 status page and insights endpoints.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.

## Changelog sentence

A company can export everything it holds in Shiftline as one archive from Settings, ready within
minutes and downloadable for 24 hours, with passwords and integration secrets left out.
