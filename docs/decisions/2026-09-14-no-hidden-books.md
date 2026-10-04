# Decision: no parallel or hidden books, ever — cash is first-class, evasion features are out of scope

Date: 2026-09-14 · Status: accepted · Owner: platform

## Context

The Phase 2 research pass (`docs/archive/research/phase-2/`) covers eleven domains and surfaces close to
200 candidate features, several of them touching cash handling directly: a cash-sales counter
mode, a cash-denomination register, cash purchase quick-entry, UPI/QR collection. Indian
secondary-sector SMEs — the product's stated market — run real cash tills, and it would be easy
for a build agent, in isolation, to read "cash workflow" as license to make a transaction optional
to record, or to build a second, unaudited path alongside the real books "for convenience." The
research brief given to every domain researcher already told them not to propose that; this
decision records why, so the rule is enforceable rather than merely inherited from a brief nobody
building Phase 2 will re-read.

## Decision

Shiftline will not build, in Phase 2 or after:

- A parallel or hidden set of books, or any storage path for a transaction that bypasses the
  audited ledger.
- Off-record sales, or any document flow whose output is not itself a recorded, numbered document
  feeding the same books as every other sale.
- A purgeable or hard-deletable transaction. The existing rule that books are never deleted
  (P1-09) is not renegotiable by a Phase 2 package; a posted entry stops counting only by
  cancellation-with-reversal or year-end closing, both fully audited.
- Any feature whose purpose, stated or implied, is to conceal revenue, understate liability, or
  otherwise mislead a tax authority, a lender or an auditor.

Cash workflows are explicitly in scope and explicitly first-class: a cash-sales counter, a cash
till, a cash-denomination register are all being built (P2-08, P2-09 in
`docs/archive/handoff/2026-09-14-phase-2-roadmap.md`). They are built to the same standard as every other document —
a voucher, a party (or a recorded cash-sale counter-party), a document number from
`documentNumberService`, and an audit row — not built with a door left open to skip that standard.

## Reasoning

Two things point the same direction:

1. **The audit trail is the owner's protection, not a liability.** In a GST assessment, a labour
   inspection, or a bank loan review, the party at risk is the tenant, and what protects them is a
   complete, contemporaneous, tamper-evident record. A feature that let an owner hide one
   transaction today would be the first thing an assessing officer asks about tomorrow, and its
   existence would make every other number in the system suspect by association — it does not
   protect the owner, it exposes them, and it exposes Shiftline as the vendor who built it in.
2. **The product wins on compliance being effortless, not on evasion being possible.** Shiftline's
   competitive position against a notebook-and-spreadsheet shop is that GST, e-invoice, e-way
   bill, EPR and labour filings fall out of data already entered for operational reasons — UPI/QR
   collection reconciles itself, an e-invoice IRN is one click off a sales order that already
   exists. That advantage only exists if the data is complete. A back door undermines the exact
   feature that makes the product worth paying for.

## Consequences

- Every Phase 2 spec that touches cash, discounts, commissions or any off-list pricing must show
  the recorded document and audit path in its data model section before a build agent starts
  implementing it; a spec that doesn't is incomplete, not merely light.
- Code review (self-review per CLAUDE.md's definition of done, "tenancy, input leaks, secrets,
  error text") gains an implicit fifth check for any cash- or discount-adjacent package: does
  every path that moves money or goods end in a posted, audited document. This is not a new gate,
  it restates the existing `safeCreateVoucher`/audit-trigger rules as a review checklist item for
  Phase 2's cash-facing packages specifically.
- A feature request that requires an off-record path to be useful (an SME asking for a way to
  "keep some sales off the books") is refused, full stop, regardless of who asks or how the
  request is worded — this is a product boundary, not a per-tenant configuration.

## Re-evaluate when

This decision is not time-bound and not expected to be revisited by a schedule. Re-open it only if
a future statutory change makes a currently-required audit practice illegal or unnecessary (it has
not, and none of the eleven research reports flagged one), never to accommodate a tenant or
prospect request.
