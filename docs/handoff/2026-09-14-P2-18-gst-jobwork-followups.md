# P2-18 — GST and job-work follow-ups

## Shipped

- **ITC-04's filing gate keyed per business place.** `jobWorkService.itc04/registerItc04
/markItc04Filed` all take an optional `businessPlaceId`; the register/mark-filed/list endpoints
  accept it in query/body. Omitted, behaviour is exactly what it was before (a company-wide gate,
  `businessPlaceId: null`) so the existing `job-work-completion.spec.ts` test is untouched. The
  GST hub's GSTIN selector already carried `businessPlaceId` on each `GstinScopeRow` — it now
  feeds the ITC-04 tab's load/register calls the same way GSTR-1 uses it.
- **A challan can no longer carry both `parentChallanId` and `fromJobWorkerId`.** `jobWorkService
.create` refuses with 400 `RETURN_AND_TRANSFER` before anything is written.
- **`Itc04Tables`** (`apps/web/src/modules/compliance/components/Itc04Tables.tsx`): the totals
  card, the approval panel and tables 4/5A/5B/5C, extracted from the Job Work screen's ITC-04 tab
  and now also rendering on the GST hub's ITC-04 tab (previously just a pointer to Job Work).
- **A mixed-supplier follow-up selection splits into one send per supplier.**
  `supplierFollowUpService` groups `recordIds` by the supplier they resolve to and sends one
  message and writes one `SupplierFollowUp` row per group; a single-supplier selection (every
  caller before this package, and the common case) still gets back one object rather than an
  array of one, so nothing else needed to change. WhatsApp recipients go through
  `sms/sms.calc.ts`'s `normaliseMobile` before a send. `Gstr2bSettings` gained
  `followUpProvider` (`FIXTURE`|`LIVE`, default `FIXTURE`) and `nudgeAfterDays` (default 5), both
  on the settings panel in `Gstr2bWorkbench.tsx`; `followup.providers.ts`'s `followUpProvider()`
  now takes the setting instead of checking `NODE_ENV === "test"` (still falls back to a
  `NODE_ENV`-keyed default — `FIXTURE` outside `production` — for any caller that has no tenant
  settings row yet).
- **The MSME payment warning merges across every payee row.** `msmeService.paymentWarning` takes
  one id, an array, or none; every covered supplier's due-soon/overdue bills are merged into one
  `PAYEE_SMALL` result. `vouchers.controller.ts` now collects every debit-side ledger's
  `supplierId` on a `PAYMENT` voucher rather than just the first.
- **`gstr2b-nudge.service.ts` / `src/jobs/gstr2b-nudge.job.ts`** (`QUEUES.GSTR2B_NUDGE`, daily
  09:00 IST): for each tenant and GSTIN scope, re-reconciles the period GSTR-2B covers (the month
  just gone, same window `ims.job.ts` warns about), finds MISSING_IN_2B/MISMATCH records whose
  document date is older than `Gstr2bSettings.nudgeAfterDays` with no `SupplierFollowUp` row
  naming them, and notifies holders of `gst-returns.prepare` once per record per period (dedup on
  the notification link, the same pattern `job-work.service.ts` and `ims.service.ts` use).
- Migration `20260914180000_gst_jobwork_followups`: additive columns only
  (`gstr2b_settings.follow_up_provider`, `gstr2b_settings.nudge_after_days`) plus the
  `FollowUpProviderKind` enum — no new tables, so no RLS/audit block was needed (`gstr2b_settings`
  already has RLS and is not audited). No new permission keys: everything reuses `job-work.{view,
manage,file}`, `gst-returns.{view,prepare}` and `payable.view`.
- `apps/api/test/integration/gst-jobwork-followups.spec.ts` (6 tests): the return/transfer
  refusal; the ITC-04 gate keyed per business place, proving a still-unapproved company-wide gate
  stays refused while the branch's own gate files clean; a mixed-supplier follow-up split into
  two sends with normalised WhatsApp numbers and two `SupplierFollowUp` rows; the settings
  default (`FIXTURE`/5) and a save round trip; the MSME warning merged across two payee suppliers
  versus a single payee unchanged versus nobody covered; the nudge job's idempotence (a same-day
  rerun raises nothing new) and that a foreign tenant sees none of its notifications.

## Decisions worth knowing

- **The nudge job re-runs `gstr2bService.reconcile()` rather than reading stored state.**
  MISSING_IN_2B has no row of its own (it is books minus whatever the 2B claimed, computed at
  read time), so there was no cheaper way to get an accurate list without also recomputing
  MISMATCH's `matchStatus`. It is idempotent and no more expensive than the workbench's own load,
  just running on a schedule instead of a click.
- **`followUpProvider()` keeps its `NODE_ENV` fallback** for a caller with no `Gstr2bSettings`
  row — `gstr2bSettingsService.ensure()` always creates one before `send()` reads it, so this
  path is dead in practice today, but it means a future direct caller does not silently reach a
  live gateway just because the tenant has never opened the settings panel.
- **A follow-up's `preview`/`send` responses are an object for one supplier, an array for
  several.** The alternative (always an array) would have been simpler but breaks the P2-10
  contract every existing caller relies on (`sent.body.data.status`, `.recipient`); unwrapping the
  single-element case keeps every prior caller working unchanged while multi-supplier callers get
  the array.

## Half-done / known gaps

- The web follow-up panel in `Gstr2bWorkbench.tsx` was not changed to let someone actually select
  records across two different suppliers in one go — it still groups by supplier in the UI. The
  backend now handles it correctly if the UI (or a script) ever sends a mixed selection; wiring
  the panel to allow it is cosmetic, not a correctness gap.
- The nudge job's "current period" is always the month just gone (like `ims.job.ts`), not
  configurable per tenant; a tenant on a delayed 2B import cycle would want a different window.
- No web change surfaces the nudge notifications distinctly from any other `gst-returns` category
  notification — they land in the same notification centre as everything else, which was judged
  sufficient for a first cut.

## Next

Nothing in the Phase 2 plan depends on this package.

## Blocked on you

Nothing filing/payment/tenancy/auth-sensitive beyond what P2-08/P2-10 already flagged as settled
(no live GSP/WhatsApp/SMTP account to test the live provider against, same as before).

## Changelog sentence

ITC-04 now files per registration like GSTR-1, a job-work challan can no longer be both a return
and a transfer, GSTR-2B follow-ups split cleanly across suppliers with normalised WhatsApp numbers
and your own fixture/live choice, the MSME payment warning covers every payee in a voucher, and a
daily nudge flags whatever nobody has chased yet.
