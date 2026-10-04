# P2-18 — GST and job-work follow-ups

## Why

`docs/archive/handoff/2026-09-14-P2-08-job-work-completion.md` and `P2-10-gst-followups.md` left six
follow-ons: ITC-04's filing gate is company-wide although the registry marks it per business
place; a challan can carry both `parentChallanId` and `fromJobWorkerId` at once, which makes no
sense; the GST hub's ITC-04 tab just points at the Job Work screen instead of showing the
tables; a mixed-supplier follow-up selection is refused outright instead of split; WhatsApp
numbers are not normalised and the fixture/live provider split is a `NODE_ENV` check rather than
a tenant setting; the payment-voucher MSME warning only looks at the first payee row; and there
is no scheduled nudge for a `MISSING_IN_2B`/`MISMATCH` record nobody has chased.

## Scope

1. ITC-04's builder, register and mark-filed take a `businessPlaceId`; the filing gate keys on it
   (`FilingApproval` already supports the tuple); the hub's existing GSTIN selector supplies it.
2. `jobWorkService.create` refuses a challan with both `parentChallanId` and `fromJobWorkerId` set
   (400, `RETURN_AND_TRANSFER`).
3. The ITC-04 totals card and tables 4/5A/5B/5C move into `Itc04Tables`
   (`apps/web/src/modules/compliance/components/`), used by both the Job Work screen and the GST
   hub's ITC-04 tab.
4. `supplier-followup.service.ts` groups a follow-up's `recordIds` by supplier and sends one
   message and writes one `SupplierFollowUp` row per supplier instead of refusing a mixed
   selection; WhatsApp numbers go through `normaliseMobile`; `Gstr2bSettings` gains
   `followUpProvider` (`FIXTURE`|`LIVE`, default `FIXTURE`) and `nudgeAfterDays` (default 5),
   editable on the settings panel, replacing the `NODE_ENV` check in `followup.providers.ts`.
5. `msmeService.paymentWarning` accepts every payee supplier id on a voucher (not just the
   first) and merges their bills into one warning; `vouchers.controller.ts` collects every
   debit-side ledger's `supplierId`.
6. `src/jobs/gstr2b-nudge.job.ts` (daily, `QUEUES.GSTR2B_NUDGE`): for each tenant and GSTIN scope,
   finds MISSING_IN_2B/MISMATCH records of the current period (the month GSTR-2B covers, same
   window IMS uses) older than `Gstr2bSettings.nudgeAfterDays` with no `SupplierFollowUp` row
   naming them, and notifies holders of `gst-returns.prepare` once per record per period.

## Out of scope

Section 16 interest, the Udyam portal check, a live GSP pull for GSTR-2B — unchanged from P2-10.

## Acceptance

`apps/api/test/integration/gst-jobwork-followups.spec.ts`: the return/transfer refusal; the
ITC-04 gate keyed per business place with the refuse-until-approved path proven against a
separate, still-unapproved company-wide gate; a mixed-supplier follow-up split into two sends
with normalised WhatsApp numbers and two `SupplierFollowUp` rows; the settings default and save
round trip; the MSME warning merged across two payee suppliers versus a single payee, unchanged;
the nudge job's idempotence (a second run the same day raises nothing new) and cross-tenant
isolation. Existing `job-work`, `job-work-completion`, `gst-followups`, `gstr2b`, `ims`, `msme`
and `vouchers`-touching specs (`routes`, `leak`) still pass.
