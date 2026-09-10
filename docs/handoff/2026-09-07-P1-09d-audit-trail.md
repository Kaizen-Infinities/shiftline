# P1-09 part D — audit trail viewer and auditor role

## Shipped

- `modules/audit-trail`: `GET /api/audit-trail` (entity, record, user, action, request id, date
  range; paginated, newest first) with per-row actor, request id and before/after diff;
  `GET /audit-trail/filters`; `GET /audit-trail/export` CSV behind `audit-reports.export`.
- `AUDITED_MODELS` moved to `src/lib/audited-models.ts` (the migration script imports it); the
  trigger now also drops `mfaSecret`, `tokenHash` and `prev_token_hash`
  (migration `20260907090000_audit_trail_redaction`, regenerated from the script).
- Default role `AUDITOR` with view-only keys plus audit export; seed user `demo.auditor`.
- Web `/reports/audit` "Audit Trail": filters, table, expandable diff, CSV export, deep links.
- 5 integration tests; routes snapshot updated; `/reports/audit` in the smoke suite.

## Half-done / known gaps

- Document screens do not yet link to their own trail (`/reports/audit?entity=vouchers&entityId=…`
  works; add a "History" button per screen in P1-10).
- Login/logout events written by `auth.service` carry no `companyId`, so they are not in the
  tenant's view; a platform-side viewer is P1-02 scope.
- Field names in the diff are database column names (`voucher_no`, `company_id`); a label map
  per entity would read better.
- The export is synchronous and capped at 10,000 rows; a pg-boss job with a download link belongs
  with the account export (P1-03).

## Next

- P1-09e year-end closing (closing JV to reserves, next FY periods and sequences, freeze date,
  prepare/approve preview).

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
