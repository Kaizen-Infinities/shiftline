# P0-02 — Audit hotfixes and input pipeline

## Shipped
Everything in `docs/specs/P0-02-audit-hotfixes-input-pipeline.md`. Typecheck and lint green
(warnings only). Not yet verified on a running stack: the compose stack arrives in P0-03,
and the integration tests that pin each fix arrive in P0-04.

## Half-done
- `products.fetchAll` on the web still requests the unpaginated list (now capped at 1000
  and lighter). The product list screen should pass `page`/`limit` when it gets a pager.

## Next
- P0-03: Docker compose (postgres + api + worker + web), Makefile, anonymised seed,
  data-handling runbook.

## Blocked on you
- Nothing new. Branch protection and the named approver are still open from P0-00.
