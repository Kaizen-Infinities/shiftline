# Phase 2 is built — what shipped, how it was verified, and what it still waits on

The ten packages in `2026-09-14-phase-2-plan.md` were built in parallel, one agent per package on
its own branch, and merged into `claude/sonnet-agents-phase-2-zodoon` in package order. Each has
its own spec in `docs/specs/P2-*.md` and its own hand-off note here; this is the map.

## The packages

| #     | Package                   | Note                                          |
| ----- | ------------------------- | --------------------------------------------- |
| P2-01 | Scheduled work            | `2026-09-14-P2-01-scheduled-work.md`          |
| P2-02 | Payroll reconciliation    | `2026-09-14-P2-02-payroll-reconciliation.md`  |
| P2-03 | Inspector's registers     | `2026-09-14-P2-03-registers.md`               |
| P2-04 | Valuation wiring and WIP  | `2026-09-14-P2-04-valuation-wiring.md`        |
| P2-05 | TDS and TCS on documents  | `2026-09-14-P2-05-tds-tcs-documents.md`       |
| P2-06 | Banking and FX settlement | `2026-09-14-P2-06-banking-fx-settlement.md`   |
| P2-07 | Fixed assets completion   | `2026-09-14-P2-07-fixed-assets-completion.md` |
| P2-08 | Job work completion       | `2026-09-14-P2-08-job-work-completion.md`     |
| P2-09 | Leave management          | `2026-09-14-P2-09-leave.md`                   |
| P2-10 | GST and MSME follow-ups   | `2026-09-14-P2-10-gst-followups.md`           |

## How the merge was verified

- Ten migrations `20260914010000` to `20260914100000` apply in order to an empty database and
  `prisma migrate diff --exit-code` against the schema prints no difference.
- The whole API suite on the merged branch: 79 test files, 498 tests, all passing, run
  sequentially. Typecheck green in all four workspaces, lint clean of errors, prettier clean,
  e2e typecheck green, web build green.
- Merge conflicts were all additive (two packages appending at the same place in the schema,
  the job registry, permissions, routes, sidebar and smoke spec) and were resolved by keeping
  both sides.
- One seam between packages was closed after the merge: P2-08's one-step return challan now
  moves the returned and scrapped quantities through P2-04's valuation, exactly as `receive`
  does, with a test in `valuation-wiring.spec.ts`.
- One pre-existing flake was fixed: `subscription-billing.spec.ts` tampered a signature by
  replacing its first character with `0`, a no-op whenever the hex already began with `0`.

## What was not done in this run

- The Playwright smoke suite was not run against a live stack in this session; every new screen
  is listed in `e2e/smoke.spec.ts` and the e2e typecheck passes. Run it once on the compose
  stack before merging to `main`.
- The frontend remake stays untouched, by agreement.
- The gaps each note lists under "Half-done" are real. The ones worth reading first: the GRN,
  expense and sales-invoice forms do not yet show the TDS/TCS preview toggle (P2-05) or the
  cheque and currency fields (P2-06) that the API now accepts; no screen writes fines and
  deductions yet, so that register stays empty (P2-03); WIP is reported, not posted (P2-04).

## Blocked on the owner

Unchanged from Phase 1: GSP, Razorpay and MSG91 accounts for the live adapters; the named human
approver and branch protection; an accountant for one validation month. New in Phase 2: which
ledger WIP should post to (P2-04), the company's leave policy and bonus percentage (P2-09), and
the overhead allocation rule (P1-19, still open).
