# P1-09 parts A and B — period control, cancel and reverse

## Shipped

- `periodService.assertPostingAllowed(date, actor)`: closed period (403 `PERIOD_CLOSED`), company
  freeze date (403 `BOOKS_FROZEN`), role backdating allowance (403 `BACKDATE_LIMIT`; platform admins
  exempt). Runs inside `safeCreateVoucher`, so every auto-posted, manual and mobile-collection
  voucher is gated, and at the start of sales invoice, GRN, return, expense and petty-cash
  create/update. `GET/PUT /api/accounts/period-control` reads and sets `Company.booksFrozenUpTo`
  (forward only unless `allowBack`); a closed period behind the freeze date cannot be reopened;
  `PATCH /api/roles/:id` (now `roles.edit`) accepts `backdateDays`.
- Cancellation (`cancellation.service.ts`): a voucher becomes `CANCELLED` and a `JOURNAL` reversal
  (`REV-<no>`, `refDocType REVERSAL`, `reversalOfId`) mirrors its lines, dated on the original date
  when open, else today. `Voucher.cancelSeq` keeps the "one posted voucher per document" uniqueness
  while letting a document post again; re-posts take a `-R<n>` number. Every DELETE on vouchers,
  sales invoices, GRNs and expenses now cancels (`POST /:id/cancel { reason }` is the explicit
  form; returns and petty cash gained cancel routes). Sales invoice cancellation reverses the sales
  and receipt vouchers, corrects the customer's outstanding and returns dispatched stock through a
  reversal adjustment; GRN cancellation keeps its reversal adjustment; purchase-return cancellation
  restores stock for goods returns; expense cancellation cancels the mirrored petty-cash entry; an
  expense edit reverses and re-posts instead of deleting. Opening-balance vouchers cannot be
  cancelled (the repair routine cancels them with `force`).
- The unposted-voucher sync skips cancelled documents and only counts `POSTED` vouchers.
- CI gate: no `delete`/`deleteMany` on vouchers, journal items or book documents under
  `apps/api/src/modules` (retention excepted).
- Migration `20260907070000_period_control_cancellation`; `period-control.spec.ts` (3) and
  `cancellation.spec.ts` (4); routes snapshot updated.

## Half-done / known gaps

- Web: list screens still call the DELETE endpoints, which now cancel; cancelled rows stay in the
  lists with `status = CANCELLED` (`Cancelled` on expenses) but no badge or "cancel with reason"
  dialog yet, and the period-control screen (freeze date, role allowances) is API-only.
- Sales-invoice and return edits still replace line items in place (audited by the trigger); the
  reversing-entry treatment applies to vouchers, not to document lines.
- Payroll runs: drafts can still be deleted (nothing posted); payroll posting itself is P1-16.
- Cancelling a document whose period has since closed posts the reversal today; the original
  period's figures do not change, which is the accepted treatment.

## Next

- P1-09c ledger group tree; P1-09d audit trail viewer and auditor role; P1-09e year-end.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
