# P1-04 — Approval gates on filings (PC7)

## Why

Every statutory filing (GST returns, TDS statements, EPFO/ESIC files, payroll runs) must be
checked by someone other than the person who prepared it before it leaves the company, and a
change made after the check must invalidate it. Later packages (P1-13, P1-15, P1-16) plug into
one generic gate instead of each growing its own approval.

## Scope

- `FilingApproval` (audited by trigger, never deleted): `filingType`, `periodKey`,
  `businessPlaceId?`, `status` DRAFT → PENDING → APPROVED → SUBMITTED, or REJECTED back to DRAFT;
  `payloadHash` (sha256 of the stable-serialised payload), `summary` for the approver, who
  prepared / sent / approved / submitted and when, `lockedAt`, `rejectReason`, `submissionRef`,
  a `history` array. One row per tenant, filing, period and business place.
- Registry of filings in `@shiftline/shared` (`FILINGS`): key, name, authority, cadence,
  per-business-place flag; `isValidPeriodKey(key, cadence)` for `2026-08`, `2026-Q1`, `2026-H1`,
  `2026-27`.
- `filingApprovalService`: `upsertDraft` (a changed hash voids a PENDING/APPROVED gate; a
  SUBMITTED period refuses with `FILING_SUBMITTED`), `sendForApproval` (notifies holders of
  `filings.approve`), `approve` (refuses the preparer: `SELF_APPROVAL`), `reject` (reason
  required), `assertSubmittable(filingType, period, hash)` (`FILING_NOT_APPROVED`,
  `FILING_SUBMITTED`, `FILING_STALE`), `markSubmitted`.
- `/api/filings/registry`, `/api/filings/approvals` list/create, `/:id`, `/:id/send`,
  `/:id/approve`, `/:id/reject`, `/:id/submitted`. Permissions `filings.view|prepare|approve|
submit` (Accounts role: view, prepare, submit; approval stays with the owner or a role the
  tenant chooses).
- Web `/compliance/approvals` list with review drawer and a reusable `ApprovalPanel` component
  any filing screen drops in.

## Out of scope

Amount thresholds and multi-level approval; approval of documents other than filings (expense
claims keep their own flow from P1-10d).

## Acceptance

- `filings.spec.ts`: walk-through GSTR-1 (period shape rejected, draft, gate refuses, self
  approval refused, approve, stale hash refused, changed figures void the approval, re-approve,
  submit, redraft refused, audit rows), rejection with reason and resend.
- Cross-tenant: `FilingApproval` swept by `leak.spec.ts`; RLS forced.
