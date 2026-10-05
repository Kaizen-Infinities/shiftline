# Status

Dated 2026-10-05. Update this file and [ROADMAP.md](ROADMAP.md) at the end of every package.

## Live

The app runs at https://shiftline.apps.kaizeninfinities.com on version `a8c7fca2` (the merge of PR #36). It has 12 hubs and about 146 screens, including TN-01 export incentives, TN-02 delivery schedules and TN-03 order T&A. What was seen, and what looks wrong, is in [AS-BUILT.md](AS-BUILT.md). Operating details are in [runbooks/hosting.md](runbooks/hosting.md).

## In main, not deployed

`main` is ahead of the live version by two PRs. They are in the code and have not been checked live (roadmap R-11).

- PR #37, TN features beta: TN-04 Tamil UI, TN-05 MSME delayed-payment claims, TN-06 multi-step process routes, TN-07 OEM ASN and labels, TN-09 job costing.
- PR #38: TN-08 buyer audit readiness, TN-10 subsidy tracker.

## Security fixes, not deployed

The IDOR and business-logic assessment fixes (F01-F10, JWT-01/02, API-01..04, BL-01..04, ABUSE-01) are merged on `claude/clever-curie-ymam25`, pending human review. Two migrations (`20260928090000_tenant_role_fks`, `20260928091000_eod_stock_run_permission`) and the new `eod-stock.run` key ship with them. Run the reconciliation queries before deploying. See [handoff/2026-10-04-security-fixes.md](handoff/2026-10-04-security-fixes.md).

## QA fixes, not deployed

The 19 findings from the live demo QA pass (F1-F19) are fixed or partly fixed on `claude/clever-curie-ymam25`, pending human review. Seed fixes reach the live tenant only through the `demo-seed` job after `backup` and `update`. See [handoff/2026-10-05-qa-fixes.md](handoff/2026-10-05-qa-fixes.md) for the verdict per finding, what is not done, and one decision for the owner (the credit-limit rule).

## Simulator or unconfigured

| Integration              | State                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| E-invoice and e-way bill | Fixture provider; no GSP connected, so nothing reaches the portal        |
| WhatsApp Business        | Not set up                                                               |
| SMTP                     | Not configured; mail is only logged                                      |
| Payment gateway          | Not connected; no payment links raised                                   |
| Machine telemetry        | Built (OPC UA, EUROMAP 63, Modbus adapters, simulator); no live readings |
| Field sales app          | No agent positions on the live tenant                                    |

## CI

GitHub Actions runs again as of 2026-10-04 (typecheck/lint/format, schema and migration gate, API tests). Run the checks locally before pushing too.

## Local checks

Last recorded on 2026-10-05 (QA-fix merge, non-superuser DB role): 138 test files / 1,163 API tests passing, 8 shared, 33 web, typecheck clean, lint with 0 errors, web build clean. The e2e suite was not run (no browser in the merge environment). Re-run them; this is not a live result.

## Not built yet

Quality, maintenance, andon and energy screens do not exist; neither do the other ideas in [ROADMAP.md](ROADMAP.md). New packages take `R-xx` ids from there and start with `docs/specs/R-xx-<name>.md`.

## Where docs live

- `specs/`: one spec per package, including built ones.
- `decisions/`: accepted decisions, for example [no hidden books](decisions/2026-09-14-no-hidden-books.md).
- `runbooks/`: local run, repo setup, backup and restore, data handling, and [hosting](runbooks/hosting.md).
- `security/`: security notes and reviews.
- `archive/`: historical, not current. Do not plan, test or design from it. See [archive/README.md](archive/README.md).
