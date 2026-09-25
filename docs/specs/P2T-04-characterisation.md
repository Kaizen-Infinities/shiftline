# P2T-04 — Characterisation tests for the untested core

## Why

Phase 2 is about to touch eight modules that have never had an integration test: OEE, machine,
production orders, hourly production, inventory, GRN/invoice receipt, goods dispatch and the
legacy payroll engine. Without a safety net, Phase 2's changes to these paths are blind. This
package writes the safety net first, characterising current behaviour — including its bugs — so
a later change that alters it fails a red test rather than shipping unnoticed.

## Scope

One `apps/api/test/integration/<name>.spec.ts` per module: `oee`, `machine`, `production-order`,
`hourly-production`, `inventory`, `grn-invoice`, `goods-dispatch`, `payroll`. Each covers its main
read/write path, a couple of validation rejections, a permission refusal (or the closest analogue
the module actually has), and a cross-tenant isolation case, following the established
`costing.spec.ts` pattern.

## Out of scope

Fixing anything characterised. Several real bugs surfaced during this work (see the hand-off note)
and none of them is fixed here — that is explicitly Phase 2's or the owner's call, not this
package's.

## Acceptance

- All eight suites pass, together and as part of the full 78-file, 491-test run.
- Every suite proves current behaviour with a comment explaining _why_ it is that way where it is
  non-obvious, rather than asserting a number with no explanation.
- No file under `apps/api/src` needed to change for a suite to pass, except the two carved out
  explicitly as their own packages (payroll's overtime rate, in P2T-02).
