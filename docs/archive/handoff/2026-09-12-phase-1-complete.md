# Phase 1 is finished — what was built, and what it is still waiting on

Every package in `2026-09-10-commission-remaining-phase-1.md` is built, committed and pushed,
except the frontend remake, which the owner dropped from this run. Each package has its own spec
in `docs/specs/` and its own handoff note here; this is the map.

## The packages, in the order they were built

| #   | Package                                                | Commit                          |
| --- | ------------------------------------------------------ | ------------------------------- |
| 1   | P1-13b GSTR-3B and the ITC ledger                      | `a27656d`, `1d63c52`, `94a6dbd` |
| 2   | P1-13c GSTR-2B import and IMS                          | `26fd193`                       |
| 3   | P1-13d GSTR-9, the compliance calendar and the GST hub | `35cd7fa`                       |
| 4   | P1-14 exports, advances, job work                      | `c37d046`, `890242c`            |
| 5   | P1-15 TDS and TCS                                      | `45a1eef`                       |
| 6   | P1-06 Tally XML export                                 | `b4344da`                       |
| 7   | P1-07 MSME dues and section 43B(h)                     | `7f5c51c`                       |
| 8   | P1-18 fixed assets and depreciation                    | `4a3ce7d`                       |
| 9   | P1-17 foreign exchange and imports                     | `2259fc3`                       |
| 10  | P1-19 valuation, costing, cost centres, budgets        | `2cdc0da`                       |
| 11  | P1-20 bank reconciliation and cheques                  | `2ba3fb2`                       |
| 12  | P1-16 statutory payroll and filings                    | `5e181da`                       |
| 13  | P1-17b Labour Code entitlements                        | `c4df3dc`                       |
| 14  | P1-21 payment links and subscription billing           | `151b73c`                       |
| 14  | P1-22 SMS, DLT templates and one-time passwords        | `f698c3e`                       |

## Where the work stands

- 69 API test files, 426 tests, all passing. Typecheck green across the four workspaces, lint
  clean of errors, no schema drift against the migrations.
- Every new tenant model carries `companyId`, row-level security and — where it is a book, a
  document or a master — an audit trigger. Every package's integration suite includes a
  cross-tenant test that proves a foreign `companyId` sees nothing.
- Every new screen is in `e2e/smoke.spec.ts`.

## What Phase 1 is waiting on from the owner

Nothing in the list below blocks a line of code that has been written; each is an account or a
credential that turns a fixture into a live integration.

- **A GSP account** for e-invoicing and e-way bills (P1-11, P1-12) and for the GSTR-2B pull and
  IMS push (P1-13c). The adapters exist; they have never spoken to a portal.
- **A Razorpay account** for the tenant-side payment gateway, and a **platform Razorpay account
  with Subscriptions** for billing tenants, plus `PLATFORM_GATEWAY_WEBHOOK_SECRET` in the
  deployment environment (P1-21). No live adapter was written, deliberately.
- **An MSG91 account** and the tenant's **DLT registration** — principal entity id, sender id and
  a registered template id for each seeded template (P1-22). Without the DLT ids nothing is
  delivered whatever the code does.
- **An accountant for one validation month**: the returns, the payroll files and the Tally export
  are tested against golden files of our own making. Somebody who files for a living needs to
  look at one real month's output before any of it is trusted.
- **The named human approver** for the filing, payment, tenancy and auth pull requests, and the
  branch-protection rule that enforces it.

## The largest gaps carried into Phase 2

Each package's own note lists its gaps in full. These are the ones that cut across:

- **Nothing schedules itself that should.** Subscription invoices, leave accrual from attendance,
  and the SMS send queue are all manual or synchronous. Each is a pg-boss job and none is
  written.
- **Overtime and the Labour Code wage rules are computed but not wired into the payroll run.**
  The engine has its own slabs; reconciling the two is one package.
- **The inspector's registers** (muster roll, wages, overtime, fines, deductions, advances) are
  not written. The data exists; each is a report.
- **No payout reconciliation** for the payment gateway, and no delivery receipts for SMS. Both
  need a live account before they can be built honestly.
- **The frontend remake** (item 15 of the commission) is untouched by agreement.
