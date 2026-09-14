# P2-10 — GST and MSME follow-ups

## Shipped

- **Supplier follow-up from the 2B workbench.** `SupplierFollowUp` (RLS, not audited).
  `supplier-followup.service.ts` resolves a mix of `Gstr2bRecord` ids (a `MISMATCH`) and
  `DOCTYPE:docId` composites (a `MISSING_IN_2B` book document the supplier never filed), composes
  one message naming every record, and sends it through `followup.providers.ts` — a fixture
  provider by default in tests, and a live one everywhere else that wraps the existing
  `WhatsappService` and `sendEmail`. Refuses with `NO_CONTACT` when the supplier has no WhatsApp
  number (`Supplier.whatsapp`) or email on file for the chosen channel. Every send, sent or
  failed, is recorded; `POST /api/gst-returns/gstr2b/:period/follow-up` and a `/preview` twin that
  writes nothing. `gstr2bService.summary()` now returns `followUps`, the latest per supplier
  GSTIN.
- **Per-tenant matching tolerances.** `Gstr2bSettings` (RLS, one row per company, defaults 7 days
  / ₹1). `gstr2bService.reconcile()` reads it whenever the caller does not pin a tolerance
  explicitly — `GET`/`PUT /api/gst-returns/gstr2b/settings` behind `gst-returns.{view,prepare}`.
  The constant `DEFAULT_TOLERANCE` in `gstr2b.types.ts` is gone from the reconciliation path
  (still exported for anything that wants the package default explicitly).
- **The MSME clock reaches supplier expenses.** `msmeService.bills()` now unions GRN invoices with
  `Expense` rows carrying a `supplierId` against a MICRO/SMALL supplier (`status` Pending or
  Approved, not cancelled): the clock runs from the expense date, and the expense is "paid" the
  day it is Approved (the day `voucherPostingService` posts it) rather than through an instalment
  table, since expenses have none. Every row now carries `source: "GRN" | "EXPENSE"`, and the
  disallowance report, Form 1 and the daily warning sweep all pick this up for free since they are
  all built from `bills()`. The MSME workbench (`MsmePage.tsx`) shows the source as a badge.
- **A payment-run warning, never a block.** `msmeService.paymentWarning(supplierId?)`: paying a
  micro/small supplier directly returns their own bills due within 5 days or overdue; paying
  anyone else returns a count and amount of small-supplier bills about to breach elsewhere.
  `GET /api/msme/payment-warning` (`payable.view`). The generic `POST /api/vouchers` response for
  a `PAYMENT` voucher carries `msmeWarning` computed from whichever debit-side ledger has a
  `supplierId` (the payee); `PaymentVoucherAddPage.tsx` shows the same thing live as rows are
  filled in, as an amber banner, never disabling Save.
- **Web**: a tolerance settings panel and a "chase a supplier" panel (select records → channel →
  preview → send, with a last-sent column) on `Gstr2bWorkbench.tsx`; a source column on
  `MsmePage.tsx`; the payment-warning banner on `PaymentVoucherAddPage.tsx`. No new routes or
  sidebar entries — all three screens already exist and are already in `e2e/smoke.spec.ts`.
- Migration `20260914100000_gst_followups` (RLS on both new tables, no audit trigger — both are
  operational, not books/documents/masters). No new permission keys: reused `gst-returns.{view,
prepare}` and `payable.view`.

## Tests

`apps/api/test/integration/gst-followups.spec.ts` (7 tests, all passing): a WhatsApp follow-up
sends through the fixture provider, is recorded and shown on the reconciliation's `followUps`;
refused with `NO_CONTACT` when the supplier has neither number nor email; widening the tolerance
turns a ₹5/₹0.45 mismatch into a match and narrowing it back reverses that; a Pending expense
against a MICRO supplier appears in `/api/msme/bills` with `source: "EXPENSE"` and the correct due
date, and the 2-days-left warning fires on the 15-day clock; the payment warning returns
`PAYEE_SMALL` with the right bills for a small payee and `OTHER_SMALL` with a count for a large
one; permission refusal (`demo.production`) on both the settings PUT and the follow-up POST;
cross-tenant isolation on `Gstr2bSettings` and `SupplierFollowUp` both through Prisma directly and
through the settings GET route.

`gst-followups gstr2b ims msme expense vouchers routes leak` and, separately,
`gst-documents gstr3b cancellation hygiene rls tenancy` (chosen because they touch GRN invoices,
expenses, vouchers or the tenancy sweep this package's models are now part of) all pass —
34 + 7 + 34 tests. `routes` and `leak` snapshots regenerated (`-u`) for the four new routes and
the two new tenant models. Whole-suite run: see the orchestrator's merge notes; run
`cd apps/api && npx vitest run --no-file-parallelism` against `TEST_DATABASE_URL` for
`shiftline_test_p2_10` to reproduce this package's result on its own.

## Half-done / known gaps

- **A follow-up names only one supplier per send.** `MIXED_SUPPLIER` refuses a mixed selection
  rather than splitting it; the web panel enforces this implicitly by only ever offering one
  supplier's records to select at once in the current groupings, but nothing stops selecting
  across suppliers by id manipulation server-side — the 400 is the actual guard.
- **The fixture/live provider split is a `NODE_ENV` check**, not a per-tenant setting like
  `Gstr2bSettings` or `SmsConfig.provider`. It matches the brief ("fixture-safe in tests") without
  inventing a config surface nobody asked for yet; if a tenant ever wants to _choose_ fixture vs
  live (e.g. a demo tenant), that needs its own flag.
- **WhatsApp follow-ups send to `Supplier.whatsapp` as stored**, with no normalisation pass like
  `sms.calc.normaliseMobile` — a supplier record with a malformed number will "succeed" against
  the fixture provider and fail against the real Graph API. Worth sharing `normaliseMobile` here
  if WhatsApp follow-ups turn out to be the primary channel in practice.
- **The payment-voucher warning looks at only the first payee row** when a payment voucher pays
  several people in one go (the multi-row Busy-style entry grid); it does not merge warnings
  across all rows. Fine for the common one-payee voucher, not for a batch run.
- **No scheduled nudge for an unfollowed `MISSING_IN_2B`/`MISMATCH` record.** This package is the
  manual send only; a pg-boss job that flags records untouched N days into the period (like
  `msme.job.ts`'s daily sweep) is a natural P2-01-style follow-on, not built here.
- Section 16 interest and the Udyam portal check remain out of scope, as before.

## Next

Nothing in the Phase 2 plan depends on this package; the orchestrator can merge it independently
of the others once the whole-suite run is clean.

## Blocked on you

Nothing — WhatsApp and email already have working services (Meta Graph API, SMTP); a live send
was never exercised here because there is no test account, same caveat as every other channel in
Phase 1.

## Changelog sentence

The GSTR-2B workbench can now chase a supplier over a missing or mismatched invoice by WhatsApp or
email with one click, its matching tolerances are yours to tune, and the MSME 15/45-day clock and
payment warnings now cover supplier expenses as well as GRN invoices.
