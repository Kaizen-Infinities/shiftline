# P1-13d — GSTR-9, the compliance calendar and the GST web hub

## Shipped

- `gstr9.service.ts` / `gstr9.types.ts`: tables 4, 5, 6, 7, 8, 9, 17 and 18 for a financial
  year. Tables 4 and 5 come from one scan of the year's sales documents, split on the question
  the monthly return never asks — was tax payable on this supply at all — so an export under a
  bond lands in 5(A) and the same export with IGST paid lands in 4(C); credit notes get their own
  rows rather than being netted away. Tables 6 and 7 come from the twelve monthly 3B tables, 9
  from their 6.1 tables, 8(A) from the year's `Gstr2bRecord` rows, and 17/18 from the sales and
  purchase lines by HSN. `monthly[]` carries each month's figures so a table can be traced back.
- `compliance.service.ts`: `DUE_RULES` gives every filing in the shared `FILINGS` registry a day
  of the month and a lag; `calendar()` expands that into dated rows across a window with the
  period each covers and its state from the filing gate; `warnUpcoming` nudges holders of
  `filings.prepare` at 7 and 2 days, de-duplicating on the notification link.
- Routes `GET /gstr9`, `POST /gstr9/register`, `POST /gstr9/filed`, `GET /calendar`; pg-boss
  queue `gst.compliance.calendar` at 07:30 IST daily.
- Web: `/compliance/gst` — one hub over a shared period and GSTIN, with a tab per return; the
  2B and IMS workbenches as their own components; `/compliance/calendar`. Sidebar entries and
  both screens in `e2e/smoke.spec.ts`.
- Tests: `test/unit/compliance-calendar.spec.ts` (5) and `test/integration/gstr9.spec.ts` (4).

## Decisions worth knowing

- **6(A) uses the GSTR-3B that was actually filed.** Taking it from the recomputed return would
  make 6(J) structurally zero and the table pointless. Where a month has a `SUBMITTED` gate the
  figures come from its stored summary, so 6(J) shows drift between what went to the portal and
  what the books now say — which is the finding the annual return exists for. A month with no
  filed return falls back to the recomputed figure and is named in the warnings.
- **The calendar's dates live beside the registry, not in it.** `FILINGS` says a filing exists;
  `DUE_RULES` says when it is due. A unit test fails if a filing is added to the registry
  without a date, because otherwise it would silently never be warned about.
- **The period a filing covers is derived, not stored.** GSTR-3B due on 20 September is the
  return for August, and a quarterly TDS form due on 31 July is April–June. That arithmetic is
  unit-tested per cadence; an off-by-one month here turns a warning into an apology.
- **The IMS workbench leads with the undecided count and what it costs**, because the portal
  accepts an undecided record by default. The bulk action accepts only records that agree with
  the books; rejecting always asks for a reason.

## Fixed in passing

`gstr9.spec.ts` first used FY 2024-25, which the year-end suite closes — the sales invoices it
created changed what that suite's closing contained, and two of its tests failed. The suites
share one database, so the GSTR-9 tests now use years nothing else touches (2019-20, 2020-21,
2021-22). Same class of problem as the `filings.spec` period fixed in P1-13c.

## Half-done / known gaps

- Tables 10 to 14 of GSTR-9 (amendments made in the _next_ year's returns) are not built; they
  need the next year's GSTR-1 amendment tables, which arrive with GSTR-1A.
- 8(C) "availed in the next financial year" is zero: it needs credit dated to one year and taken
  in another, which the ledger can express but nothing yet records as a deliberate choice.
- 7(C) and 7(D) (rules 42 and 43) stay zero for the same reason as in P1-13b: no exempt-turnover
  ratio until P1-19.
- Table 4(F) advances is zero until P1-14 models receipt vouchers.
- The calendar's window is fixed (one month back, three months on) and its dates are the central
  ones; professional tax varies by state and arrives with P1-16.
- There is no GSTR-9 JSON: the annual return is filed on the portal, not uploaded, so the
  working papers are the deliverable.
- The hub loads one tab at a time and refetches on every period change; fine for a monthly task,
  worth caching if it is opened repeatedly.

## Next

P1-14: exports, advances and job work — export invoices under LUT or with IGST with shipping
bill details feeding GSTR-1's EXP table (which currently goes out without them), receipt
vouchers for advances (which would fill 4(F) here), refund vouchers, and delivery challans for
job work with ITC-04.

## Blocked on you

Unchanged: GSP sandbox credentials; branch protection and the named approver; pentest vendor;
Anthropic API key decision; ToS text; EPFO/ESIC access; sample bank statements; Razorpay and
MSG91 accounts; an accountant for a validation month — who should also settle the 4(A)(5)
question raised against P1-13b, since GSTR-9 table 8 now shows both sides of it.

## Changelog sentence

GST returns now have a home: one screen for the month's GSTR-1, GSTR-3B, 2B reconciliation and
IMS decisions, GSTR-9 working papers for the year, and a calendar that says what is due when and
nudges before the date rather than after it.
