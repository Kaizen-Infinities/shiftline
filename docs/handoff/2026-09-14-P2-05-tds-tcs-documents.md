# P2-05 — TDS and TCS on documents

## Shipped

- `TDS-<section>` / `TCS-<section>` payable ledgers (one per row of `TDS_SECTION_SEEDS`) added to
  `DEFAULT_SEED_LEDGERS` in `accounts.service.ts` — created for every tenant on day one
  (`provisioningService.provisionTenant()` already calls `ensureSystemLedgersExist()`) and
  idempotently for existing tenants the next time any posting path calls it.
- GRN invoice (`modules/grn-invoice`): `tdsSectionCode` + `deductTds` on create. The section
  alone returns a `tdsPreview` (the rate decision, unsaved); accepting it calls
  `tdsService.deduct`, stamps `tdsAmount`/`tdsSectionCode` onto the GRN, recomputes
  `paymentStatus` against `netAmount - tdsAmount`, and posts a journal — Dr supplier / Cr
  `TDS-<section>` — through the same `safeCreateVoucher` every other posting uses
  (`tdsService.postDeductionVoucher`, `refDocType "TDS_DEDUCTION"`). Cancelling the GRN reverses
  it (`tdsService.reverseForDoc`) alongside the existing voucher reversal.
- Expense (`modules/expense`): already had raw `tdsSection`/`tdsRate`/`tdsAmount` fields and
  posted a generic `TDS-LIA-001` credit inside the single EXPENSE voucher (P1-15 left this
  half-done). `deductTds: true` now runs the figures through `tdsService.deduct` (threshold,
  206AA/206AB, a real `TdsDeduction` row) instead of trusting whatever the caller typed, and
  `postExpenseVoucher` credits the section-specific ledger _only when a `TdsDeduction` row is on
  file for that expense_ — a bill where `tdsRate`/`tdsAmount` were only typed by hand keeps
  crediting `TDS-LIA-001` exactly as before, which is what `gst-documents.spec.ts`'s existing
  expense test still asserts. Cancelling reverses the `TdsDeduction` row (the voucher line was
  already inside the one EXPENSE voucher `cancelExpense` reverses).
- Sales invoice (`modules/sales-invoice`): `collectTcs` + `tcsSectionCode`. Accepted, `tcsAmount`
  is folded into `grandTotal` (the receivable carries it) and `postSalesVoucher` credits
  `TCS-<section>` instead of Sales Account for that slice. `TdsDeduction` gained a `customerId`
  column (a TCS collection's payee is a customer, not a supplier — a different id type) and the
  threshold aggregate in `tdsService.rateFor` keys off whichever of `supplierId`/`customerId` is
  given. No PAN field exists on `Customer`; it is read off characters 3–12 of the GSTIN.
  Cancelling a sales invoice reverses the collection row the same way.
- Challan (`tdsService.payChallan`): now also posts Dr `TDS-<section>` (summed per section
  across the deductions on the challan) / Cr `BANK-001`, with surcharge/interest/late fee to
  `EXP-001`.
- Web: `TdsPage.tsx`'s sections table is editable inline (the `POST /api/tds/sections` endpoint
  already existed from P1-15; only the screen was read-only).
- Migration `20260914050000_tds_on_documents`: `grn_invoices.tds_amount`/`tds_section_code`,
  `sales_invoices.tcs_amount`/`tcs_section_code`, `tds_deductions.customer_id` (+ FK, index).
  All three tables were already RLS-protected and in `AUDITED_MODELS`; no new models, so no
  audit-trigger regeneration and no `MODELS_WITHOUT_SEED_ROWS` entry needed.
- `apps/api/test/integration/tds-documents.spec.ts` (9 tests): over-threshold deduction with
  voucher/ledger assertions, under-threshold (a zero-amount row, no voucher), 206AB, declining
  the preview, scrap-sale TCS, challan posting, cancel reversal, permission refusal, cross-tenant.

## Decisions worth knowing

- **GRN's TDS is a second voucher; the expense's is folded into one.** The GRN's existing
  purchase voucher already credits the supplier for the full `netAmount`, so a second voucher
  (Dr supplier / Cr `TDS-<section>`) nets the payable down without touching the first. The
  expense already posted TDS inside its single voucher (P1-15), and changing that shape would
  have meant rewriting `cancelExpense`'s reversal path too — folding it in was the smaller,
  safer change and matches what the spec asked for on that document.
- **The expense ledger choice is keyed off the `TdsDeduction` row, not off the section code
  string.** The first cut looked up `expense.tdsSection` against the section master directly,
  which is wrong: `gst-documents.spec.ts` already posts an expense with `tdsSection: "194J"`
  through the old hand-typed `tdsRate`/`tdsAmount` path (no `deductTds`), and "194J" is a real
  seeded section code — so that lookup would have silently changed which ledger a pre-existing,
  untouched code path posts to. Checking for an actual `TdsDeduction` row keeps the two paths
  apart.
- **Preview and deduction must derive the PAN the same way.** The rate decision depends on
  whether the payee has a valid PAN on file; the first cut called `tdsService.rateFor` for the
  preview without it (supplier/customer PAN is normally resolved inside `tdsService.deduct`,
  which the preview never reaches), so every preview came back at the 206AA 20%/5% no-PAN rate
  regardless of the real one. Both the GRN and sales-invoice preview calls now resolve the PAN
  first (supplier's own field; the customer's GSTIN characters 3–12) and pass it in.
- **A shared physical `node_modules` across worktrees made `prisma generate` racy.** Several
  Phase 2 agents build in parallel and this environment's worktrees resolve `@prisma/client`
  from one shared directory tree, not a per-worktree copy; a sibling agent's `prisma generate`
  (for its own schema) can land mid-typecheck or mid-test-run and produce spurious "property
  does not exist" errors or `PrismaClientKnownRequestError`s that have nothing to do with this
  change. Every verification step in this hand-off was re-run immediately after a fresh
  `prisma generate` and, for the full-suite run, split into shorter windows for the same reason.
  A fresh clone or a `git worktree` with its own `node_modules` would not have this problem.

## Half-done / known gaps

- The GRN, expense and sales-invoice **forms** do not show the preview/accept toggle — the
  fields (`tdsSectionCode`/`deductTds`, `collectTcs`/`tcsSectionCode`) and the `tdsPreview`/
  `tcsPreview` response shape are ready, but wiring three existing, large forms was not done
  this pass. The deduction list (`TdsPage.tsx`, deductions tab) already links `docNo`, which is
  enough to find the document by hand until the forms grow the toggle.
- No default TDS section per supplier/deductee: the caller has to name `tdsSectionCode` on the
  request. A "supplier default section" field on the Supplier master (the spec's "or the section
  can be inferred from the deductee master") was not added.
- Threshold tracking for 206C(1H) is exact per `customerId`, not merged if the same real-world
  buyer is later linked from more than one Customer row.
- The challan's Dr side falls back to `TDS-LIA-001` if a deduction's section has no
  `ledgerCode` on file (should not happen with the seeded sections, but a hand-edited section
  with a blank ledger code would hit it).

## Next

Nothing in the Phase 2 plan depends on this directly; P2-10 (GST follow-ups) touches the same
supplier-expense area (MSME clock) and could pick up the form wiring at the same time.

## Blocked on you

Nothing — this needed no new account or credential.

## Changelog sentence

Purchase bills and supplier expenses now offer to deduct TDS (at the right rate, including the
no-PAN and non-filer cases) and post the liability straight to the books; scrap and
above-threshold sales collect TCS the same way; challans post their own payment entry; and the
TDS section rates are editable from the compliance screen.
