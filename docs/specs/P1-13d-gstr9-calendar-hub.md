# P1-13d — GSTR-9, the compliance calendar and the GST web hub

## Why

P1-13a to c compute the monthly returns but nothing shows them to the person who files them, and
nothing says when anything is due. A return that only exists as an API response is a return
nobody files. The annual return, in turn, is the one that finds the mistakes: it puts twelve
months of credit next to what was actually claimed, and twelve months of the books next to what
the suppliers filed, and the two differences it surfaces are what an assessment turns on.

## Scope

- `gstr9.service.ts` and `gstr9.types.ts`: tables 4 (supplies on which tax is payable, split
  B2C/B2B/export-with-tax/SEZ/deemed export, with the notes in their own rows), 5 (supplies on
  which it is not, including exports under a bond and nil-rated), 6 (ITC availed, with 6(A) from
  the GSTR-3B that was actually _filed_ where one was, so 6(J) means something), 7 (reversals),
  8 (the year's 2B against the books), 9 (tax paid, from the twelve 6.1 tables), and 17/18 (HSN
  summaries of outward and inward supplies). One ledger rebuild covers the year; the twelve
  monthly 3B builds reuse it through `skipItcRebuild`.
- `compliance.service.ts`: due dates derived from the `FILINGS` registry in `packages/shared`
  plus a `DUE_RULES` table of the day and the lag (GSTR-1 the 11th, IMS the 14th, GSTR-3B the
  20th, TDS challan the 7th, PF and ESI the 15th, GSTR-9 nine months on, and so on), the period
  each covers, and the state of each from the filing gate. A daily pg-boss job nudges holders of
  `filings.prepare` 7 and 2 days before a date, once per nudge rather than once per day.
- Routes `GET /api/gst-returns/gstr9`, `POST /gstr9/register`, `POST /gstr9/filed` and
  `GET /api/gst-returns/calendar`.
- Web: `/compliance/gst`, one hub over a shared period and GSTIN with a tab per return —
  GSTR-1 with its portal JSON download, GSTR-3B with 3.1, 4 and the 6.1 challan, the 2B
  reconciliation workbench, the IMS workbench, and the GSTR-9 working papers — and
  `/compliance/calendar`. Both gated on the permissions the API already uses.

## Out of scope

Filing GSTR-9C (the reconciliation statement); amendment tables 10 to 14 of GSTR-9, which
concern the _next_ year's returns; the portal's GSTR-9 JSON, since the annual return is filed on
the portal rather than uploaded; per-tenant due dates for state filings such as professional tax,
which vary by state and arrive with P1-16.

## Acceptance

- `gstr9.spec.ts`: a year with documents in two months produces the right tables 4, 5 and 17,
  the monthly trace matches the months the documents were in, an unfiled month is named in the
  warnings rather than passed off as filed, and the filing gate refuses until approved.
- `compliance-calendar.spec.ts` (unit): the period a filing covers is the month, quarter, half
  or financial year _before_ its due date, for each cadence; every filing in the shared registry
  has a due rule, so one added there cannot go unwarned.
- The calendar lists each date in order with its gate status, and the nudge goes out once at
  seven days and once at two, not daily.
- Both screens in `e2e/smoke.spec.ts`; web typecheck, lint and build green.
