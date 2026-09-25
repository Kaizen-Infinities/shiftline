# P2-17 — Banking, FX and TDS/TCS follow-ups

## Shipped

- **`deriveStablePaymentRefId`'s fallback now always fits 36 characters.** A payment with no
  `id` of its own used to derive `<parentId>_<prefix>_<hash12>`, which for a uuid parent could
  run past `Voucher.refDocId`'s `VarChar(36)`; it is now `h_<32-hex>` (34 characters), a hash of
  the same inputs (parent, prefix, index, amount, date, method, reference) so a collision still
  needs all of those to match. A payment with an explicit `id` is untouched.
- **A PDC's FX now realises at the clearing date, not the date it was first recorded.**
  `postPaymentVouchersForGRN` and `postReceiptVouchersForSales` take a new optional
  `clearingDate`, which `banking.service.ts`'s own `updateCheque` passes through (the `on` it
  already had) when it force-posts a cleared PDC's payment. The realised-FX voucher's own
  `narration` records both dates (`cheque cleared … (recorded …)`) when they differ, and the
  voucher's `date` is the clearing date — so which date the rate came from is on the voucher
  itself, not just in the code. Along the way, `currencyService.rateFor` gained an optional `db`
  parameter, now passed the caller's own transaction client from `realiseFxForPayment`: called
  through the top-level `prisma` singleton from inside an already-open transaction, the
  tenant-scoping extension does not re-apply the row-level-security session setting to that
  query (it assumes, wrongly in this case, that "someone already ran it in this transaction"),
  and the rate lookup would silently see no rows at all rather than the tenant's own rate — a
  real, previously-latent bug this package's own test for item 2 tripped over immediately.
- **The cheque-due warning tells a bounce, a re-presentation and an ordinary cheque apart.**
  `bankingService.warnDueCheques` now queries `IN_HAND`, `DEPOSITED` and `BOUNCED` cheques in the
  window (not just `IN_HAND`): a `BOUNCED` one (not yet re-presented, by definition of the state
  machine — re-presenting always moves a cheque to `DEPOSITED`) is skipped outright; a
  `DEPOSITED` one with `presentedCount > 0` gets its own "(re-presented)" title and body instead
  of silence; an ordinary `IN_HAND` cheque, or a `DEPOSITED` one that never bounced, behaves as
  before.
- **Supplier TDS fields.** `defaultTdsSectionCode` (P2-11), `higherRate206AB` and `deducteeType`
  (both P1-15 columns, never validated or exposed on a form) are now accepted by
  `supplier.validation.ts` on both create and update, and `SupplierForm.tsx` gets a "TDS
  Defaults" panel (section picker, deductee type, 206AB toggle) behind `tds.view`, matching the
  GRN form's own gate.
- **TDS challan refuses a section with no ledger instead of guessing.** `payChallan` now checks
  every deduction's section for a `ledgerCode` before doing anything else and refuses
  (`SECTION_NO_LEDGER`, 409) if one is missing, naming the section; the old
  `d.section.ledgerCode ?? "TDS-LIA-001"` fallback in `postChallanVoucher` is gone (every
  deduction reaching it now has a real ledger code, since `payChallan` already checked). The
  sections screen (`POST /api/tds/sections`) now requires a non-blank `ledgerCode` on every save,
  new section or edit alike — the existing "refuses TDS section edits without the permission"
  test still passes because the permission check runs before body validation.
- **206C(1H) pools its threshold by PAN, not by customer row.** `tdsService.rateFor` now
  aggregates the year's payments by `deducteePan` instead of `customerId` specifically for
  section `206C(1H)`, and specifically when the deductee's PAN is present and passes
  `isValidPan` — every other section, and 206C(1H) itself with no PAN on file, is unchanged
  (per document-party row, as before). This needed one more fix to actually work: the
  sales-invoice TCS path only ever called `tdsService.deduct` when `tcsAmount > 0`, so a
  below-threshold invoice left nothing on file for a later invoice (same customer, or the same
  PAN on a different row) to add up against — the GRN/TDS side already avoids this by always
  recording a `PENDING` row, zero amount included, and the sales-invoice side now does the same.
- **`Product.isScrap`** (additive column, migration `20260914170000_banking_tds_followups`) with
  a checkbox on `ProductForm.tsx`. `SalesInvoiceCreate.tsx`'s scrap-section default now checks
  each line's own product first — a directly-sold production product's own flag, or, for a
  composite sales product, any of its components' — and only falls back to the `/scrap/i` name
  heuristic when nothing on the item master says so.
- **GRN view's cheque match keys on cheque number and cheque date.** `cheques` was already
  scoped to the GRN's own `sourceDocId`; the payment-row match inside that now also checks
  `chequeDate`, so two cheque payments on one bill that happen to share a re-typed cheque number
  (allowed by the register's own `(companyId, kind, chequeNo, chequeDate)` unique key, since the
  dates differ) no longer both match whichever register row `Array.find` happens to hit first.
- `apps/api/test/integration/banking-tds-followups.spec.ts` (9 tests): the refDocId length, the
  PDC clearing-date realisation (voucher date, narration, and the actual gain amount at the
  clearing rate rather than the recorded-date rate), the cheque-due warning's skip/label/warn
  three-way split, a supplier's TDS fields round-tripping and hidden from a foreign tenant, the
  challan's `SECTION_NO_LEDGER` refusal plus the sections screen's now-required ledger code, the
  206C(1H) PAN-pooled threshold across two Customer rows, `Product.isScrap` round-tripping and
  hidden from a foreign tenant, two same-numbered cheques on one bill staying distinguishable by
  date, and a permission refusal on the supplier TDS fields.

## Decisions worth knowing

- **The `currencyService.rateFor` connection gap was a genuine, pre-existing production bug, not
  a test artifact.** Any receipt or payment settling a foreign-currency document without an
  explicit `settlementRate` on the payment itself was silently failing with a 409 the moment it
  reached this code path — the "gain" test in `banking-fx-settlement.spec.ts` never actually
  exercised the automatic rate-table lookup (it always supplied `settlementRate` on the payment),
  which is exactly why this had never been caught. The fix is narrow and only touches the one
  call site this package's own scope covers (`realiseFxForPayment`); `grn-invoice.service.ts`,
  `sales-invoice.service.ts` and `fx.service.ts` call `currencyService.rateFor` too, but at
  document-creation or restatement time (not from inside a payment's own nested transaction), so
  they were not confirmed to share the gap and widening the audit was out of this package's size.
- **206C(1H) pooling reads `deducteePan` off the `TdsDeduction` row itself, not by joining back
  to `Customer` rows sharing a PAN.** The PAN is already stored on every deduction (resolved once,
  at `deduct()` time, from the supplier's own field or the customer's GSTIN); aggregating
  `WHERE deducteePan = <pan>` is simpler and cheaper than first finding every `Customer` row with
  that PAN and then aggregating by `customerId IN (...)`, and gives the identical answer.
- **A below-threshold TCS invoice now always records a `PENDING`, zero-amount `TdsDeduction`
  row**, the same shape GRN's own TDS path already used for an under-threshold bill. Without this,
  neither per-customer nor per-PAN pooling could ever work across more than one invoice — nothing
  was ever on file to sum. This is a real behavior change beyond the PAN-pooling ask itself, but
  a necessary one for either threshold model to function at all past a single document.
- **The cheque-due warning's "at least one notification" pattern.** `notify()` fans out one
  `Notification` row per recipient holding the permission, not one per call — the test asserts
  `>= 1` for a cheque that should warn (matching `scheduled-work.spec.ts`'s own convention) and
  exactly `0` for one that should not, rather than assuming a fixed recipient count.

## Half-done / known gaps

- `currencyService.rateFor`'s other three call sites (document creation, restatement) were not
  audited for the same nested-transaction gap; if one of them turns out to share it, the same
  `db` parameter (already added to `rateFor`'s signature) just needs threading through.
- No settings UI for either the cheque-due warning's new labelling or the TDS section's
  now-required ledger code — neither needed one; the section requirement surfaces as a normal
  validation error on `TdsPage.tsx`'s existing inline-edit table.
- `SupplierForm.tsx`'s new TDS panel is read/write only for a role with `tds.view`; a role that
  can edit suppliers but not view TDS never sees these three fields on the form (they can still
  be set by a caller that sends them directly, same as before this package).
- The scrap default's composite-sales-product check reads `sp.components[].componentProduct`
  from whatever `salesProductService.fetchAll()` already returns (it always included the full
  component product via its `includeDefaults` include) — no new backend call was needed, but if
  that include ever narrows to a `select`, the flag would silently stop showing up client-side.

## Next

Nothing in the Phase 2 plan depends on this directly. A natural follow-up: audit
`currencyService.rateFor`'s other three call sites for the same nested-transaction gap this
package found and fixed at one of them.

## Blocked on you

Nothing — no new account or credential.

## Changelog sentence

A payment's own reference id can no longer overflow its column, a post-dated cheque that clears
now books its exchange gain or loss at the day it actually cleared, the cheque-due warning tells
a bounce and a re-presentation apart, the supplier master offers its own TDS defaults, a TDS
challan refuses to post against a section with no ledger instead of guessing one, the 206C(1H)
threshold now follows a buyer's PAN across duplicate customer rows, a product can be flagged as
scrap for the sales-invoice TCS default, and a GRN bill's cheque payments no longer collide on a
repeated cheque number.
