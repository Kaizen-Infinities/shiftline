# Phase 2 is built — what shipped, how it was verified, and what it still waits on

The ten packages in `2026-09-14-phase-2-plan.md` were built in parallel, one agent per package on
its own branch, and merged into `claude/sonnet-agents-phase-2-zodoon` in package order. Each has
its own spec in `docs/specs/P2-*.md` and its own hand-off note here; this is the map.

## The packages

| #     | Package                                | Note                                          |
| ----- | -------------------------------------- | --------------------------------------------- |
| P2-01 | Scheduled work                         | `2026-09-14-P2-01-scheduled-work.md`          |
| P2-02 | Payroll reconciliation                 | `2026-09-14-P2-02-payroll-reconciliation.md`  |
| P2-03 | Inspector's registers                  | `2026-09-14-P2-03-registers.md`               |
| P2-04 | Valuation wiring and WIP               | `2026-09-14-P2-04-valuation-wiring.md`        |
| P2-05 | TDS and TCS on documents               | `2026-09-14-P2-05-tds-tcs-documents.md`       |
| P2-06 | Banking and FX settlement              | `2026-09-14-P2-06-banking-fx-settlement.md`   |
| P2-07 | Fixed assets completion                | `2026-09-14-P2-07-fixed-assets-completion.md` |
| P2-08 | Job work completion                    | `2026-09-14-P2-08-job-work-completion.md`     |
| P2-09 | Leave management                       | `2026-09-14-P2-09-leave.md`                   |
| P2-10 | GST and MSME follow-ups                | `2026-09-14-P2-10-gst-followups.md`           |
| P2-11 | GRN form: TDS, currency, cheque        | `2026-09-14-P2-11-grn-form.md`                |
| P2-12 | Expense and sales forms, receipts      | `2026-09-14-P2-12-expense-sales-forms.md`     |
| P2-13 | Fines and deductions                   | `2026-09-14-P2-13-fines-deductions.md`        |
| P2-14 | WIP posting                            | `2026-09-14-P2-14-wip-posting.md`             |
| P2-15 | HR shared pieces                       | `2026-09-14-P2-15-hr-shared.md`               |
| P2-16 | Payroll follow-ups                     | `2026-09-14-P2-16-payroll-followups.md`       |
| P2-17 | Banking, FX and TDS follow-ups         | `2026-09-14-P2-17-banking-tds-followups.md`   |
| P2-18 | GST and job-work follow-ups            | `2026-09-14-P2-18-gst-jobwork-followups.md`   |
| P2-19 | SMS wiring, negotiated billing, assets | `2026-09-14-P2-19-sms-billing-assets.md`      |
| P2-20 | Costing follow-ups                     | `2026-09-14-P2-20-costing-followups.md`       |

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

## The third round (P2-15 to P2-20)

Six more agents closed the "Half-done" lists of the first fourteen notes: an employee search and
shared picker, a business place on employees so the registers filter, a leave calendar grid,
editable pending fines with employee notifications; a real quarterly overtime cap, dead payroll
settings removed, a work-state backfill, tax-declaration reminders, salary TDS on the wages
register and landscape PDFs; 36-character payment refs, FX at cheque clearing date, bounce-aware
cheque warnings, TDS defaults on the supplier form, PAN-pooled TCS thresholds, a scrap flag on
products; ITC-04 per business place, a shared ITC-04 table, split follow-ups with number
normalisation and a per-tenant provider setting, the payment warning across every payee, a daily
GSTR-2B nudge job; payment-link and payment-received SMS on the queue, a platform-set negotiated
price, an asset opening template and reversed-run view; a gap backfill for valuation, a real rate
for recovered wastage and a stock-tab period picker. Migrations `20260914150000` to
`20260914190000`.

## What was not done in this run

- The browser smoke suite runs in CI and was run locally only for screens that failed there.
- The frontend remake stays untouched, by agreement.
- Deliberately left: the raw-material versus finished-goods ledger split (it re-plumbs every
  stock write); `AttendanceRecord` has no business place of its own (the registers resolve it
  through the employee); `currencyService.rateFor` was fixed for the settlement path only and its
  other three call sites are unaudited for the same in-transaction RLS problem (see the P2-17
  note); anything that needs a live account (WhatsApp, SMTP, MSG91, Razorpay, GSP).

## Blocked on the owner

Unchanged from Phase 1: GSP, Razorpay and MSG91 accounts for the live adapters; the named human
approver and branch protection; an accountant for one validation month. New in Phase 2: the company's leave policy and bonus percentage (P2-09), and
the overhead allocation rule (P1-19, still open).
