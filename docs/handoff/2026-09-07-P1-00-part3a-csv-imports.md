# P1-00 part 3a — CSV imports with dry run

## Shipped

- `/api/imports`: six import types (customers, suppliers, products, raw materials, ledger opening
  balances, opening stock) with templates, tolerant header matching, cell coercion, a row-level
  dry-run report and an all-or-nothing commit that goes through the module services, so ledgers,
  opening vouchers and stock movements are created the same way the screens do.
- Web page `/settings/imports` (Configuration → Data Imports) with template download, dry run on
  file pick, filterable report and Import button; added to the browser smoke suite (13 screens).
- Fix: `rawMaterialService.create` failed under tenancy whenever a store, category or location was
  given (`connect` plus the injected `companyId`); scalar foreign keys now.
- Tests: 121 API (imports.spec.ts adds 8).

## Half-done / known gaps

- Commits are sequential without one wrapping transaction (the master services post vouchers
  outside the caller's transaction); an unexpected failure stops at that row and the report says
  how many went in. Validation catches the ordinary causes first.
- No import history table; the audit trail records every created row, but a `ImportRun` model
  (who, when, file name, counts) would help support later.
- HSN codes are not importable yet: the HSN master arrives with P1-08 and gets an import type then.
- Excel files are not accepted; users export to CSV first.

## Next

- Part 3b: notification centre, surrogate keys for the seven code-keyed models, Prisma 8
  evaluation, retire the legacy password-by-email user creation.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
