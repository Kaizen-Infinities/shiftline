# P1-06 — Tally XML export

## Why

Almost every Indian manufacturer's chartered accountant works in Tally. The books can live in
Shiftline, but the auditor still wants them in Tally at the end of the month, and re-typing them
is both the largest recurring manual cost and the largest source of disagreement between the two
sets of books. Tally imports XML; if we write the XML the accountant's job is an import, not a
month of data entry.

## Why not just dump the ledgers

Two things make a naive dump wrong. Tally has **reserved groups** of its own — the ones it
creates in every company — and their names are not ours: our "Cash in Hand" is Tally's
"Cash-in-Hand", our "Direct Income" is its "Direct Incomes". Import a group by our name and Tally
silently makes a _second_ group beside the real one, and half the balance sheet lands in the
wrong place. Second, Tally's **Journal voucher refuses cash and bank ledgers** unless the company
enables it; an expense paid in cash posted as a Journal is rejected at import.

Both are handled here rather than left to the accountant.

## Scope

- **Name mapping.** A built-in table maps our standard ledger-group codes to Tally's exact
  reserved names; those groups are never emitted as masters because Tally already has them. Only
  the tenant's own groups are created, under the mapped parent. On top of that a `TallyNameMap`
  lets the tenant override any name — group, ledger, unit, stock item or voucher type — because a
  Tally company that has been running for ten years has its own names and the import must meet
  them where they are.
- **Masters XML** (`All Masters`): custom ledger groups, every account ledger under its Tally
  parent, party ledgers carrying GSTIN, registration type, state and opening balance, units of
  measure, and stock items (raw materials and products) with their base unit and HSN.
- **Voucher XML** (`Vouchers`) for a date range, built from `Voucher` and `JournalItem`: Tally's
  sign convention (debit negative with `ISDEEMEDPOSITIVE`, credit positive), the voucher type
  mapped per type with returns becoming credit and debit notes, cancelled vouchers exported as
  cancelled rather than dropped, and a `REMOTEID` per voucher so a re-import updates rather than
  duplicates.
- **Journal safety.** A journal or expense voucher that touches a cash or bank ledger is
  exported as a Payment or a Receipt — whichever side the money moved — because Tally will not
  accept it as a Journal.
- **Incremental.** A run records the window and the newest voucher timestamp it covered; the next
  incremental run starts from the last _confirmed_ run's watermark, so a month can be exported
  weekly without re-importing what the accountant already has.
- **Runs.** `TallyExportRun` keeps what was exported, how many of each kind, the payload hash and
  who confirmed the import. Downloads regenerate from the recorded window; a hash that no longer
  matches says the books moved since, which is exactly what the accountant needs to know.

## Out of scope

Reading anything back from Tally, Tally's ODBC/HTTP gateway (this is a file the accountant
imports), inventory allocation on vouchers (stock items are exported as masters but vouchers are
accounting-only until P1-19 gives us costed stock movement), payroll and depreciation vouchers
(they do not exist yet — P1-16 and P1-18), and bill-by-bill references on party lines.

## Acceptance

- A golden-file test: a fixed set of masters and vouchers produces exactly the expected XML.
- The reserved-group mapping is proved: a standard group is not emitted and a custom one is,
  under its Tally parent.
- A journal touching a bank ledger comes out as a Payment.
- A cancelled voucher comes out with `ISCANCELLED`.
- An incremental run after a confirmed one contains only what changed since.
- Every query is tenant-scoped; the cross-tenant test proves a foreign `companyId` returns
  nothing.
