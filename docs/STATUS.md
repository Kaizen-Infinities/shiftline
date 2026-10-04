# Status

Dated 2026-10-04. Update this file and [ROADMAP.md](ROADMAP.md) at the end of every package.

## Live

The app runs at https://shiftline.apps.kaizeninfinities.com on version `a8c7fca2` (the merge of PR #36). It has 12 hubs and about 146 screens, including TN-01 export incentives, TN-02 delivery schedules and TN-03 order T&A. What was seen, and what looks wrong, is in [AS-BUILT.md](AS-BUILT.md). Operating details are in [runbooks/hosting.md](runbooks/hosting.md).

## In main, not deployed

`main` is ahead of the live version by two PRs. They are in the code and have not been checked live (roadmap R-11).

- PR #37, TN features beta: TN-04 Tamil UI, TN-05 MSME delayed-payment claims, TN-06 multi-step process routes, TN-07 OEM ASN and labels, TN-09 job costing.
- PR #38: TN-08 buyer audit readiness, TN-10 subsidy tracker.

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

GitHub Actions billing blocks CI. Checks run locally before merge.

## Local checks

Last recorded on 2026-09-29: API suite 115 files / 853 tests passing, typecheck clean, lint clean. Re-run them; this is not a live result.

## Not built yet

Quality, maintenance, andon and energy screens do not exist; neither do the other ideas in [ROADMAP.md](ROADMAP.md). New packages take `R-xx` ids from there and start with `docs/specs/R-xx-<name>.md`.

## Where docs live

- `specs/`: one spec per package, including built ones.
- `decisions/`: accepted decisions, for example [no hidden books](decisions/2026-09-14-no-hidden-books.md).
- `runbooks/`: local run, repo setup, backup and restore, data handling, and [hosting](runbooks/hosting.md).
- `security/`: security notes and reviews.
- `archive/`: historical, not current. Do not plan, test or design from it. See [archive/README.md](archive/README.md).
