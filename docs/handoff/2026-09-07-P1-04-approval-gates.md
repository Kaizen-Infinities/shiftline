# P1-04 — approval gates on filings (PC7)

## Shipped

- `FilingApproval` model (audited, RLS) and migration `20260907150000_filing_approvals`.
- `FILINGS` registry, period-key validation and `FILING_STATUSES` in `@shiftline/shared`;
  permissions `filings.view|prepare|approve|submit` in the core feature; Accounts role gets view,
  prepare and submit.
- `modules/filings`: `filingApprovalService` with the hash gate (`assertSubmittable`) that every
  filing package calls before a portal push, self-approval refusal, voiding on payload change,
  notifications to approvers and back to the preparer; routes under `/api/filings`.
- Web `/compliance/approvals` (sidebar under Accounts) and `modules/compliance/components/
ApprovalPanel.tsx` for reuse on filing screens; `filingService`; smoke entry.
- `filings.spec.ts` (2 tests); route and leak snapshots updated.

## Half-done / known gaps

- Nothing registers filings yet: the page is empty until P1-13 (GST returns), P1-15 (TDS) and
  P1-16 (payroll) call `upsertDraft` and `assertSubmittable`. Year-end closing (P1-09e) keeps its
  own prepare/approve pair; it can move onto this gate when a second approver is wanted.
- One approval level; no thresholds. `approve` accepts the preparer when the actor is a super
  admin acting for the platform.
- `businessPlaceId` is accepted but the page does not show the place name.

## Next

- P1-05 status page and insights endpoints, then P1-11 e-invoice onwards.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  terms-of-service text; GSP sandbox credentials for P1-11.

## Changelog sentence

Statutory filings now pass through an approval gate: whoever prepares a return sends it for
approval, someone else approves or rejects it with a reason, and any change to the figures after
approval must be approved again before the return can be filed.
