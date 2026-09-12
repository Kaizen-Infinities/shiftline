# P1-06 — Tally XML export

## Shipped

- `GET /api/tally/masters` and `GET /api/tally/vouchers`: the two files the tenant's accountant
  imports into Tally. Masters carry custom ledger groups, every ledger under its Tally parent,
  party ledgers with GSTIN, registration type, state and opening balance, units, and stock items
  (raw materials and products) with base unit and HSN. Vouchers carry the period's `Voucher` and
  `JournalItem` rows in Tally's own sign convention.
- The reserved-group map (`tally.names.ts`). Tally's own groups are not called what ours are —
  its "Cash-in-Hand" against our "Cash in Hand", its "Direct Incomes" against our "Direct
  Income" — and it will not rename them. A reserved group is therefore never exported; one of
  ours is created under the reserved parent it belongs beneath.
- `TallyNameMap`: the tenant's override on top of that, per group, ledger, unit, stock item or
  voucher type, including a flag to keep a ledger out of the file entirely.
- Journal safety: a journal or expense voucher touching a cash or bank ledger is exported as the
  Payment or Receipt it actually is, because Tally's Journal refuses those ledgers unless the
  company has enabled it.
- Cancellation translated rather than copied: our cancelled original plus its `REVERSAL` voucher
  becomes Tally's one cancelled voucher, and when only the reversal falls in the window the
  original is fetched anyway so the cancellation still reaches Tally.
- `TallyExportRun`: what was handed over, when, how many records, and the payload hash.
  Confirming a run is a separate act and the only thing that moves the incremental watermark —
  nothing here can see whether Tally accepted the file. Re-downloading a run rebuilds it from the
  recorded window and says in a header whether the books have moved since.
- Routes under `/api/tally`; permissions `tally.{view,export,manage}` granted to Owner and
  Accounts. Migration `20260912140000_tally_export` with RLS, and the name map in
  `AUDITED_MODELS`. Web `/accounts/tally` with export, handover history and name mapping, in
  `e2e/smoke.spec.ts`. `tally.spec.ts` (8 tests), including a golden-file assertion on a voucher.

## Decisions worth knowing

- **The file is generated, never stored.** The books are the source of truth; a stored copy only
  goes stale. The run keeps the hash instead, which answers "is this what I imported?" without
  keeping a second copy of the books on disk.
- **A draft run does not move the watermark.** Generating a file proves nothing about whether it
  reached Tally; only a person clicking "mark imported" does, so that is what incremental runs
  key off.
- **Cancelled comes across as cancelled, with no entries.** Sending the entries _and_ the
  reversal would have left Tally short by the amount of every cancelled voucher — the two systems
  cancel in opposite directions and the translation has to happen here.
- **Vouchers are netted one line per ledger**, which is how Tally stores them anyway. A voucher
  that debits and credits the same ledger collapses; nothing in the books does that today.

## Also fixed here

Four services looked the tenant's company up with a bare `prisma.company.findFirstOrThrow()`.
`Company` is the tenant rather than a tenant-scoped model, so that query is not scoped and
returned an arbitrary company — the wrong legal name, GSTIN, TAN or PAN on a printed challan or a
TDS return whenever more than one tenant existed. All four now look it up by `requireTenantId()`:
`job-work.print.ts`, `tds.returns.ts`, `tds.service.ts` (Form 16A) and the new `tally.service.ts`.
The Tally golden-file test is what surfaced it.

## Half-done / known gaps

- Vouchers are accounting-only: no inventory allocation, so a sales voucher does not carry the
  stock item lines. Stock items go across as masters, and the allocation belongs with P1-19,
  where costed stock movement is being built anyway.
- No bill-by-bill (`BILLALLOCATIONS.LIST`) on party lines, so Tally keeps the party balance but
  not the invoice-wise breakup. The ledgers are already marked bill-wise, so adding it is a
  block inside the party entry.
- No GST details on stock items beyond HSN and the rate; Tally's `GSTDETAILS.LIST` with
  applicability dates is not written.
- Payroll, depreciation and stock-journal vouchers are named in the original scope but do not
  exist yet (P1-16, P1-18, P1-19). The voucher builder reads whatever `Voucher` holds, so they
  arrive with those packages rather than needing work here.
- Nothing reads back from Tally, and there is no ODBC or HTTP gateway push — the accountant
  imports the file. That is deliberate: the gateway needs Tally running and reachable.
- The export is not on a schedule. A monthly pg-boss job that prepares the file and notifies the
  accountant would be a small addition on top of `createRun`.

## Next

P1-07: MSME 43B(h).

## Blocked on you

Unchanged. (The TAN and PAN noted in the P1-15 note are still wanted; they are now also what the
Tally masters would carry for the company itself, once company masters are exported.)

## Changelog sentence

The books can now be handed to your accountant as a Tally XML file — masters under the names
Tally already uses, the month's vouchers in its own sign convention, and a record of what has
already been imported so the next file carries only new work.
