# 2026-09-25 — Beta integration: one line for Phase 2

## What happened

By 2026-09-24 the work since Phase 1 sat on six branches that no longer agreed with each other.
Phase 2 had been built twice: `claude/sonnet-agents-phase-2-zodoon` (P2-01..P2-26, PR #19) and
`chatgpt` (P2T-01..04 plus P2-01 machine telemetry, PR #24). The UI remake (#18) and the
accessibility pass (#20/#21) were built against different versions of the shell. This branch,
`claude/vibrant-bell-ihn002`, merges all of it into a single line:

| Source                | What came in                                                                                                       | How conflicts went                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| #19 sonnet-agents     | Phase 2 P2-01..P2-26                                                                                               | Base of the integration                                    |
| #25 cool-davinci      | Phase 2 roadmap, research, no-hidden-books decision                                                                | Clean                                                      |
| #24 chatgpt           | Machine telemetry, P2T-04 tests + six bug fixes, IST-midnight EOD fix, slice 2 shell, PRODUCT.md, shop-floor specs | #19 wins where both built the same thing (see below)       |
| #18 youthful-hypatia  | P1-UI slices 3 and 4                                                                                               | New look for styling; Phase 2 behaviour kept               |
| #21 / #20 codex       | Accessibility pass, nav regrouping, Railway/Cloudflare runbook                                                     | New look kept, a11y behaviour taken; #20 superseded by #21 |
| Dependabot #3–#7, #10 | Actions v7 / buildx v4, `@types/qrcode` 1.5.6                                                                      | Workflow version lines only                                |

## Dropped as duplicates (chatgpt → sonnet wins)

- P2T-01 jobs `billing-cycle.job`, `leave-accrual.job`, `sms-send.job` and their service helpers
  (`raiseNextIfDue`, `accrueForMonth`, `sendQueuedMessage`): `billing.job`, `leave.job` and
  `sms.job` already do this. `scheduling.spec.ts` went with them.
- P2T-02's overtime path: P2-02/P2-16 already pay the Labour Code double rate, with the quarterly
  cap.
- P2T-03 `statutory-registers` module, page, permission and API paths: P2-03 `registers` covers
  the same six registers.

The P2T hand-off notes and specs stay in `docs/` as history. They describe code that no longer
exists on this line.

## Kept from chatgpt

- The PRODUCTION role's permission keys are now spelled as the registry spells them. On #19 they
  were still wrong, so `demo.production` got 403 on production orders, hourly production and OEE.
- Machine telemetry is added to `jobs/index.ts`, `QUEUES`, `AUDITED_MODELS`, permissions, the
  `shop-floor` feature and the PRODUCTION role.
- `payroll.spec` now expects employer PF to be the full statutory cost P2-02 introduced
  (12% + EDLI + admin = ₹1,950 on ₹15,000), not 12% alone.

## Left out on purpose

- #9 Prisma 7, #22 Node 25 (not an LTS release), #23 TypeScript 7 and lint-staged 17: each is a
  major upgrade and needs its own work package. #11 nodemailer 10 and #12 `@types/node` 26 are
  also left for later.

## Known loose ends

- `JobWorkPage` keeps its Phase 2 version. Slice 4 restyled a table P2-08 has since changed, so
  the page still has the old look.
- Two P2 spec series share numbers: the shop-floor plan (`P2-00-shop-floor-foundation`,
  `P2-01-machine-telemetry`…`P2-12`) and the delivered Phase 2 (`P2-01-scheduled-work`…). Rename
  one series before either is extended.
- CI cannot run. Every GitHub-hosted job since 2026-09-14 ~17:00 UTC stops with "recent account
  payments have failed or your spending limit needs to be increased". The account owner has to
  fix this under Billing & plans.

## Verified locally (no CI)

`npm ci`, typecheck (api, api tests, web, shared), lint (0 errors), prettier, `prisma validate`,
`migrate deploy` plus the drift check against an empty Postgres 16, the full API suite
(634/634 after the chatgpt merge), shared tests, web build and `e2e:typecheck`.
