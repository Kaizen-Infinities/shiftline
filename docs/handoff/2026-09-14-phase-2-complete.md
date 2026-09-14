# Phase 2 is built — what shipped, how it was verified, and what it still waits on

The ten packages in `2026-09-14-phase-2-plan.md` were built in parallel, one agent per package on
its own branch, and merged into `claude/sonnet-agents-phase-2-zodoon` in package order. Each has
its own spec in `docs/specs/P2-*.md` and its own hand-off note here; this is the map.

## The packages

| #     | Package                           | Note                                          |
| ----- | --------------------------------- | --------------------------------------------- |
| P2-01 | Scheduled work                    | `2026-09-14-P2-01-scheduled-work.md`          |
| P2-02 | Payroll reconciliation            | `2026-09-14-P2-02-payroll-reconciliation.md`  |
| P2-03 | Inspector's registers             | `2026-09-14-P2-03-registers.md`               |
| P2-04 | Valuation wiring and WIP          | `2026-09-14-P2-04-valuation-wiring.md`        |
| P2-05 | TDS and TCS on documents          | `2026-09-14-P2-05-tds-tcs-documents.md`       |
| P2-06 | Banking and FX settlement         | `2026-09-14-P2-06-banking-fx-settlement.md`   |
| P2-07 | Fixed assets completion           | `2026-09-14-P2-07-fixed-assets-completion.md` |
| P2-08 | Job work completion               | `2026-09-14-P2-08-job-work-completion.md`     |
| P2-09 | Leave management                  | `2026-09-14-P2-09-leave.md`                   |
| P2-10 | GST and MSME follow-ups           | `2026-09-14-P2-10-gst-followups.md`           |
| P2-11 | GRN form: TDS, currency, cheque   | `2026-09-14-P2-11-grn-form.md`                |
| P2-12 | Expense and sales forms, receipts | `2026-09-14-P2-12-expense-sales-forms.md`     |
| P2-13 | Fines and deductions              | `2026-09-14-P2-13-fines-deductions.md`        |
| P2-14 | WIP posting                       | `2026-09-14-P2-14-wip-posting.md`             |

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

## The second round (P2-11 to P2-14)

The gaps the first round left open were closed the same afternoon by four more agents: the GRN,
expense and sales-invoice forms now expose the TDS/TCS toggle with a live preview, the GRN form
takes a currency and cheque payments, the sales invoice takes a receipt by hand (cash, bank or
cheque, with FX settlement), fines and deductions have an entry screen with show-cause and
approval and are recovered by the payroll run, and work in progress posts to a `Work in Progress`
ledger with a per-tenant setting. Migrations `20260914110000` to `20260914140000`.

## What was not done in this run

- The browser smoke suite runs in CI; it was run locally only for the screens that failed there.
  Two Phase 1 screens (bank reconciliation, statutory payroll) mapped over their response
  envelopes and are fixed; the API's global rate limit is now `GLOBAL_RATE_LIMIT_MAX` so the
  suite can render every screen from one IP.
- The frontend remake stays untouched, by agreement.
- The remaining gaps are listed under "Half-done" in each package note. The ones worth reading
  first: the supplier form has no field for the default TDS section (API only); the balance
  sheet's raw-material and finished-goods split is computed for display while the stock ledger
  stays one blended `STOCK-001`; the scrap TCS default on a sales invoice is a name heuristic
  because the item master has no scrap flag.

## Blocked on the owner

Unchanged from Phase 1: GSP, Razorpay and MSG91 accounts for the live adapters; the named human
approver and branch protection; an accountant for one validation month. New in Phase 2: the company's leave policy and bonus percentage (P2-09), and
the overhead allocation rule (P1-19, still open).
