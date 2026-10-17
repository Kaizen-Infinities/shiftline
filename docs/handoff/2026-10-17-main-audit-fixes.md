# 2026-10-17 — main audit fixes

Branch `claude/confident-edison-ycd0yk`, from `main` at `916b492`. No PR opened yet.

## What shipped

A convention audit of `main` (tenancy, error text, auth, books/GST, concurrency, frontend) and fixes:

- **Books:** sales invoice, expense, sales return, purchase return and GRN vouchers post inside the
  document transaction; a posting failure rolls the document back (422). Edits reverse the old
  voucher and post a new one. Sales invoices with a live IRN or e-way bill cannot be edited
  (409 `IRN_LIVE` / `EWB_LIVE`).
- **TDS:** an expense created as Approved and a GRN with TDS record the deduction, its journal and
  the document's voucher in one transaction, under a per-payee lock for the cumulative threshold.
  Expenses with `deductTds: true` previously always failed (the flag was written as a column); fixed.
- **Stock:** raw-material issue locks the row; finished-goods stock moves by increment; purchase
  returns use a guarded decrement; SA/PW and daily-plan numbers allocate under an advisory lock.
- **GST:** a place of supply that was given but cannot be resolved is refused (400); a party with no
  state at all is treated as local. E-invoice `Pos` never comes from a state name.
- **Auth:** admin `X-Company-Id` honoured only on `/api/platform`; admins without a tenant get 403
  on tenant routes. Password reset never returns the token and emails the link through Resend;
  `/reset` in the web app now requests and completes resets. Refresh tokens rotate by
  compare-and-swap.
- **Field app:** receipts take numbers from the RECEIPT series (`RCT/2026-27/0001`, was
  `MC-2026-00001`), post through `safeCreateVoucher` and respect closed periods; `x-device-id` is
  required on pull and attachment upload.
- **Leaks and hardening:** no raw provider/SMTP/Prisma text to clients; SMTP password masked on
  save; `/uploads` serves images only; product-image upload needs `product-images.edit`; list
  `limit` capped at 100; forged payment callbacks write nothing; GSTR-2B pulls decrypt the GSP
  secret; `process.env` read only through `config/env.ts` (backup job's `pg_dump` child excepted).

Verified: `npm run typecheck`, lint, prettier, web and shared tests green; API suite 1218/1219 — the
one failure (`e-invoice.spec.ts` "refuses a B2C document…") also fails on `main` and is not touched.

## Half-done

- Login page has no "Forgot password?" link to `/reset` (needs an i18n key).
- `GET /api/companies` returns 500 for an admin token without a tenant (route has no permission
  middleware).
- Master codes (customer, supplier, machine, shift, raw material) are client-supplied; a collision is
  a 409, not auto-allocated.

## Blocked on a person

- Set `RESEND_API_KEY` and `RESEND_FROM` on the hosted stack, or reset emails are not sent (a warning
  is logged).
- The mobile app must send `x-device-id` on pull and attachment upload, and accept the new receipt
  number format.
- Editing a sales invoice still clears its payments and resets status to CONFIRMED while posted
  receipt vouchers remain — owner to decide the intended behaviour.
- Not done, need decisions: `GET /api/companies/public` picks an arbitrary tenant (resolve by host?);
  WhatsApp webhook signature check needs the Meta app secret; `DATA_ENCRYPTION_KEY` fallback to the
  JWT secret outside production.
- Auth, tenancy, payment and filing changes need the named human approver before merge.
