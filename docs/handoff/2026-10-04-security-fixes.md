# Security fixes from the IDOR and business-logic assessments

**Changelog:** Sessions now end the moment a password is changed or reset, live updates no longer
carry business figures, employee, leave, cheque-scan, payroll-advance and payment screens enforce
the right permissions and amounts, and invoice notes are shown as plain text in PDFs.

Six branches merged into `claude/clever-curie-ymam25` (reports: `idor.md`, `business.md`). Not a
PR yet. Auth, tenancy and payment changes need the named human approver before merge.

## Findings fixed

| Id               | Fix                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01              | `assertTenantRole` on every role assignment; composite FKs `(company_id, roleId)` on `users` and `role_permissions` (migration `20260928090000_tenant_role_fks`)                          |
| F02              | Employee `loginAccount` needs `users.create` / `users.edit`, uses the strict account schema and the seat check, and revokes the linked user's sessions and sockets                        |
| F03              | `safeUserSelect` (`modules/users/user.select.ts`): employee endpoints no longer return password hashes or tokens                                                                          |
| F04              | Realtime payloads are invalidation-only (ids, no business data); web consumers refetch                                                                                                    |
| F05              | Socket handshake runs the HTTP checks (live session, device, account, company, impersonation), disconnects at token expiry; `disconnectSession/User/Company/Device/Impersonation` helpers |
| F06, F10         | Production, inventory and customer-credit routes gated by permission; new key `eod-stock.run`                                                                                             |
| F07              | Leave cancel/edit only by the request's own employee (or `leave.approve`)                                                                                                                 |
| F08              | Mobile sync cursor validated; a device cannot change visit planning                                                                                                                       |
| F09              | Foreign tenant references checked at code level (scoped lookups)                                                                                                                          |
| JWT-01           | Permissions fail closed: from the live role, empty if the role is missing, inactive or foreign                                                                                            |
| JWT-02           | Password change ends all other sessions (and their sockets)                                                                                                                               |
| API-01           | PDF and template HTML escaping; `pdfGenerator` hardening; browser closed on shutdown                                                                                                      |
| API-02           | Tight limiter attached to the real reset routes                                                                                                                                           |
| API-03           | Cheque OCR budget (per user per hour, per tenant per day, concurrency, timeout)                                                                                                           |
| API-04           | Download URLs redacted in logs (`lib/redact-url.ts`)                                                                                                                                      |
| BL-01            | Advance recovered once, at approval, in the same transaction as an atomic DRAFT to APPROVED claim                                                                                         |
| BL-02, BL-03     | Subscription charges matched by provider invoice id or exact open amount; unmatched charges are logged and change nothing                                                                 |
| BL-04            | Webhook: only finished events count as duplicates; FAILED and stale RECEIVED are re-claimed                                                                                               |
| ABUSE-01         | Invoice row locked while a receipt or gateway capture is applied                                                                                                                          |
| Other 1, 3, 4, 6 | Reset limiter, user and employee validation, seat checks on register and employee accounts, fail-closed role handling                                                                     |

Integration wiring added in the merge: every place that ends a `userSession`
(`auth.repository`: logout, logout-all, password change, reset, refresh-token reuse, employee
revoke) disconnects exactly those sockets; password change keeps the caller's own. `closePdfBrowser()`
runs in the API and worker shutdown. `authMiddleware` now reads session, user, company and role
grants in one query for a normal tenant user (the socket handshake already did).

## What users will notice

- Invoice notes and other free text that contains HTML print as text in PDFs, not as markup.
- Realtime events carry ids only; screens refetch after an event, so a list may flicker once.
- Leave self-service: an employee can only cancel or change their own requests.
- A mobile device can no longer change visit planning from the office plan.
- Cheque OCR is limited. Env vars (all optional): `MOBILE_OCR_MODEL`, `MOBILE_OCR_USER_PER_HOUR`
  (30), `MOBILE_OCR_TENANT_PER_DAY` (500), `MOBILE_OCR_MAX_CONCURRENT` (4), `MOBILE_OCR_TIMEOUT_MS`.
- New permission `eod-stock.run` for the manual EOD rerun. Migration
  `20260928091000_eod_stock_run_permission` grants it to every OWNER role and every role that holds
  `eod-stock.edit`; new tenants get it from `ROLE_DEFS`. Other custom roles must be given it by hand.
- A password change or reset signs the user out everywhere else, sockets included.

## Not done

- Composite tenant FKs for customer and mobile relations (F09): code-level checks only.
- Deployment risks in `idor.md` "Other #5": public plain-HTTP port 8090, `COOKIE_SECURE=false`,
  forwarded-protocol handling, API and worker on the migrator role, same-disk backups.
- Password-reset email is still unimplemented (the token is returned outside production).
- JWT `iss` / `aud` / `alg` pinning.
- Permission-scoped socket rooms (events are tenant-wide but now carry ids only).
- No table for unapplied subscription charges: an unmatched charge is only logged.

## Run before deploying (read-only, per tenant or with RLS bypassed)

Run as the migrator with `SELECT set_config('app.bypass_rls','on',false);` first.

```sql
-- 1. Advances double-recovered by runs LOCKED before this fix: recoveredAmount against what the
--    APPROVED and LOCKED payroll results deducted. Any row listed is wrong; deducted > amount is certain.
SELECT a.company_id, a.id, a."employeeId", a.amount, a."recoveredAmount", r.deducted
FROM salary_advances a
JOIN (SELECT pr.company_id, pr."employeeId", SUM(pr."salaryAdvance") AS deducted
      FROM payroll_results pr JOIN payroll_runs run ON run.id = pr."payrollRunId"
      WHERE run.status IN ('APPROVED','LOCKED') GROUP BY 1, 2) r
  ON r.company_id = a.company_id AND r."employeeId" = a."employeeId"
WHERE a."recoveredAmount" <> r.deducted OR a."recoveredAmount" > a.amount;

-- 2. Sales invoice payments: JSON column vs rows vs vouchers
SELECT si.company_id, si.id, si.invoice_no,
       COALESCE((SELECT SUM((p->>'amount')::numeric) FROM jsonb_array_elements(si.payments::jsonb) p), 0) AS json_total,
       COALESCE((SELECT SUM(amount) FROM sales_invoice_payments sp WHERE sp.sales_invoice_id = si.id), 0) AS row_total,
       COALESCE((SELECT COUNT(*) FROM sales_invoice_payments sp
                 WHERE sp.sales_invoice_id = si.id AND sp.voucher_posted
                   AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id::text = sp.source_voucher_id AND v.status = 'POSTED')), 0) AS rows_without_posted_voucher
FROM sales_invoices si
WHERE COALESCE((SELECT SUM((p->>'amount')::numeric) FROM jsonb_array_elements(si.payments::jsonb) p), 0)
   <> COALESCE((SELECT SUM(amount) FROM sales_invoice_payments sp WHERE sp.sales_invoice_id = si.id), 0);

-- 3. Payment links: amount_paid vs captures
SELECT pl.company_id, pl.id, pl.link_no, pl.amount_paid, COALESCE(SUM(pc.amount), 0) AS captured
FROM payment_links pl LEFT JOIN payment_captures pc
  ON pc.payment_link_id = pl.id AND pc.status = 'CAPTURED'
GROUP BY pl.company_id, pl.id HAVING pl.amount_paid <> COALESCE(SUM(pc.amount), 0);

-- 4. Subscriptions activated without a matching paid invoice
SELECT s.company_id, s.status, s.current_period_start
FROM subscriptions s
WHERE s.status = 'ACTIVE' AND s.provider_subscription_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM subscription_invoices i
                  WHERE i.company_id = s.company_id AND i.status = 'PAID'
                    AND i.period_start <= now() AND i.period_end >= now());

-- 5. Cross-tenant role references the F01 migration deletes (role_permissions) and nulls (users.roleId)
SELECT count(*) AS role_permissions_to_delete FROM role_permissions rp JOIN roles r ON r.id = rp."roleId"
 WHERE rp.company_id <> r.company_id;
SELECT u."userId", u.company_id, u."roleId" FROM users u JOIN roles r ON r.id = u."roleId"
 WHERE u.company_id <> r.company_id;
```

Check the table and column spellings against `prisma/schema.prisma` if a query errors (the
`PaymentCaptureStatus` and `SubscriptionInvoiceStatus` enum value names in particular). Users in
list 5 lose their role when the migration runs and need a role from their own tenant.
