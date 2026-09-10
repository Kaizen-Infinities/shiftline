# P1-10 part C — Schedule III layouts and statements of account

## Shipped

- Schedule III variants (summary and detailed) on `/accounts/balance-sheet` and
  `/accounts/profit-loss`, rendering the API's `scheduleIII` structures
  (`components/ScheduleIII.tsx`).
- `GET /accounts/statements/{customer|supplier}/:id[/pdf]` and `POST …/send`
  (`modules/accounts/statement.service.ts`, `templates/statementTemplate.ts`): ledger for the
  period plus ageing, as JSON, PDF, email or WhatsApp.
- `StatementPanel` on the customer and supplier breakdown pages; `statementService.ts`.
- `statements.spec.ts` (2 tests); routes and leak snapshots; balance sheet and P&L in the smoke
  suite.

## Half-done / known gaps

- PDF generation is not exercised in tests (puppeteer); the HTML template is covered only by
  typing. A golden-file test of the HTML would be cheap to add.
- Customer records carry no postal address on the model, so the statement shows the customer's
  GSTIN and contacts only; suppliers show their billing address.
- Sending is synchronous; a slow SMTP server holds the request. Moving it onto pg-boss with a
  notification on completion fits P1-13's compliance calendar work.
- No "statement sent" log against the party yet; the audit trail records nothing for a send
  because no row changes. A `PartyCommunication` row (channel, to, period, sentBy) would give
  the receivables team a history.
- Interest on overdue is shown but not raised as a debit note (unchanged from part A).

## Next

- P1-10d: expenses route restored, expense claims with approval, `PUT /returns/purchase/:id`,
  cash/bank guard by group code, cancel dialogs and History links.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.

## Changelog sentence

Balance sheet and P&L can be shown in the Schedule III format, and a customer or supplier
statement of account can be opened as a PDF or sent by email or WhatsApp from their page.
