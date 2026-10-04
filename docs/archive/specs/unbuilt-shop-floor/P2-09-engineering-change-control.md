# P2-09 — Engineering change control (Part Three, close-soon)

## Why

A BOM, a drawing revision or a process parameter changes today by someone editing a record. Nobody
approves it, nobody is told, and nothing records what the part looked like before. For an
OEM-tier supplier that is an audit finding: IATF 16949 requires change to be requested, assessed,
approved and communicated, with the effective date controlled. The Functional Completeness Addendum
flags this as close-soon precisely because it unblocks buyer segment 2.

Read `docs/specs/P2-00-shop-floor-foundation.md` first.

## Scope

- **`EngineeringChangeRequest`** (ECR, audited): raised against a product, raw material, BOM or
  process step; the reason category (`CUSTOMER`, `COST`, `QUALITY`, `SUPPLY`, `SAFETY`,
  `CORRECTION`), the problem, the proposed change, the originator, and status `DRAFT`, `SUBMITTED`,
  `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `CANCELLED`.
- **`EngineeringChangeNotice`** (ECN, audited): created from an approved ECR. Carries the effective
  date, the disposition of existing stock and work in progress — `USE_UP`, `REWORK`, `SCRAP`,
  `RETURN` — the affected documents, the implementation checklist, and the closure record. An ECN is
  never deleted; it is cancelled with a reason.
- **Approval chain.** Configurable per change category: who must review (production, quality,
  accounts) and who finally approves, with each reviewer's decision and comment recorded. Reuse the
  approval posture of `modules/filings/filing-approval.service.ts` — a request, a hash of what is
  being approved, and a refusal to apply until approved — rather than inventing a second approval
  engine. The change payload is hashed so an approved ECN cannot be silently edited before it takes
  effect.
- **Revision control.** A revision number on `Product`, `BillOfMaterial` and `ProductionStep`, with
  the prior version retained. `apps/web/src/features/product/types.ts` carries a `mouldReference`
  field with no database column — either give it a column here or delete it; do not leave the
  orphan.
- **Effectivity.** An approved ECN applies its change on its effective date through a daily pg-boss
  job under `runAsTenant`, idempotent; production orders opened before the date keep the old
  revision, and the revision in force is stamped onto the order when it is created so history stays
  readable.
- **Notification.** On approval and on effectivity, holders of `engineering-change.view` are told
  through `notify`, and the affected machines' operators via the shift execution board.
- Routes `/api/engineering-changes` (ECR CRUD and submit, review, approve, reject; ECN create,
  implement, close, cancel; affected-items lookup). New permission module `engineering-change`
  (`view, raise, review, approve, implement`) in `permissions.ts`, feature `quality`, paths in
  `api-paths.ts`, keys to OWNER, PRODUCTION and STORES; approve to OWNER in `ROLE_DEFS`.
- Web: an ECR/ECN board by status, a change detail with the review panel
  (`apps/web/src/modules/compliance/components/ApprovalPanel.tsx` is the reusable shape), a revision
  history on the product and BOM screens. Each into `e2e/smoke.spec.ts`.

**Anchor files:** `modules/filings/filing-approval.service.ts` for approve-before-apply with a
payload hash; `modules/year-end/` for prepare-then-approve with a dated effect;
`modules/production-order/` for the status machine and history table shape.

## Out of scope

CAD or drawing file management and viewing — MES2 shop-floor document control, Phase 3, is where the
current drawing revision gets pushed to the station; customer PPAP submission packets (the auto
vertical pack); cost impact analysis beyond a free-text estimate, which P1-19's cost sheet can
answer separately.

## Acceptance

- `engineering-change.spec.ts`: an ECR moves through its status machine and an illegal transition is
  refused; an ECN cannot be created from an unapproved ECR; editing the change payload after
  approval invalidates the hash and blocks implementation; each configured reviewer must decide
  before final approval; the effectivity job applies on the effective date, exactly once, and a
  re-run applies nothing; a production order opened before the effective date keeps the old revision
  and one opened after gets the new; stock disposition is recorded for each of the four options;
  cancellation requires a reason and the ECN row survives; notification fires once on approval and
  once on effectivity.
- The `mouldReference` orphan is resolved one way or the other, with a test or its absence proving it.
- New models into `AUDITED_MODELS` and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
