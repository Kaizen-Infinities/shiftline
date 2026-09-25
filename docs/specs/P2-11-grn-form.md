# P2-11 — GRN invoice form: TDS toggle, currency and cheque fields

## Why

P2-05 made the GRN invoice API accept `deductTds`/`tdsSectionCode` and return a `tdsPreview`;
P2-06 made it accept `currencyCode`/`exchangeRate`/`foreignTotal` and cheque instrument fields on
its payments. None of that reached the web form or the view page.

## Scope

- Create form (`InvoiceDetailPage.tsx`): a "Deduct TDS" toggle with a section picker (sections
  from `/api/tds/sections`, defaulting from the supplier's own `defaultTdsSectionCode` when it
  has one), a live preview line (rate, TDS amount, net payable) from `/api/tds/preview`, and a
  currency picker (default INR, exchange-rate and foreign-total fields hidden for INR) with the
  rate defaulted from the currency rate table for the invoice date and left editable.
- Payments section: the form had payment _state_ wired since an earlier pass but no UI to add
  one — this package builds it. Instrument type (cash / bank transfer / cheque), and for cheque
  the number, date, bank and drawer; a cheque dated after the payment date is flagged post-dated.
- View page (`GrnInvoiceViewPage.tsx`): a summary panel showing the TDS deduction (with a link to
  the compliance TDS screen) and the foreign-currency total alongside the INR one; each payment's
  cheque register status (from `/api/banking/cheques`, matched by `sourceDocId`).
- Backend gap closed: `Supplier.defaultTdsSectionCode` (additive column) so the form has
  something to default from; the supplier create/update routes accept and return it.
- Every new field validated client-side to match the GRN invoice's zod schema; `en-IN`
  formatting; Tailwind.

## Out of scope

The expense and sales-invoice forms (P2-12). TDS/currency editing after creation — the update
endpoint never re-ran the TDS deduction even before this package (a pre-existing gap), and the
rest of the edit form is already locked the same way, so the toggle and currency fields follow
that pattern and stay disabled once a GRN is saved; only payments (including cheques) can be
added afterwards, matching what the API already supports on update. No screen change that needs
`e2e/smoke.spec.ts` — no new route or sidebar entry, and the two screens keep their headings.

## Acceptance

- `npm run typecheck -w @shiftline/web`, lint and the web build green.
- The `Supplier.defaultTdsSectionCode` round trip covered in `tds-documents.spec.ts`.
- Hand-off note in `docs/handoff/`.
