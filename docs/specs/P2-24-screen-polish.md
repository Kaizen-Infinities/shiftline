# P2-24 — Screen polish: cosmetic gaps in the HR, compliance, costing and payroll screens

## Why

`docs/archive/handoff/2026-09-14-P2-15-hr-shared.md` notes that the leave request list still shows a raw employee id, not a name — the calendar (built from the same list) shows names, and the picker closed the _input_ gap, but the _display_ was not changed. `docs/archive/handoff/2026-09-14-P2-18-gst-jobwork-followups.md` notes that the follow-up panel still groups by supplier in the UI even though the backend now splits correctly. `docs/archive/handoff/2026-09-14-P2-20-costing-followups.md` notes that the backfill endpoint was never wired to a button. `docs/archive/handoff/2026-09-14-P2-16-payroll-followups.md` notes that the overtime register's `payrollBreach` column has no visual treatment, and the nudge notifications are not surfaced distinctly.

## Scope

Web only, apart from one additive backend change:

1. **Leave request list query** (`apps/api/src/modules/leave/leave.service.ts`): the `listRequests` method now includes the employee's code and name, exactly as the `calendar` method already does. No backend breaking change — the existing test in `leave.spec.ts` still passes since the rows now carry richer data.

2. **Leave request list and calendar display** (`apps/web/src/modules/leave/pages/LeaveHrPage.tsx`): both the requests table (line 311 currently shows raw `employeeId`) and the calendar grid now show employee code and name instead of the id, matching what the grid already does. Frontend interface `LeaveRequestRow` updated to include `employeeCode` and `employeeName`.

3. **Follow-up panel** (`apps/web/src/modules/compliance/components/Gstr2bWorkbench.tsx`, the "Send follow-ups" section): the panel now allows multi-select across suppliers (not just within one), with a preview grouped per supplier; the send button is singular and wired to handle a mixed selection; the result lists one row per supplier sent, matching the backend's response shape.

4. **Nudge notifications** (`apps/web/src/components/common/NotificationCenter.tsx` or equivalent): nudge notifications (those whose `category` matches what `gstr2b-nudge.service.ts` uses) get a distinct badge and a link to the 2B workbench for that period. Existing other notifications are unchanged.

5. **Backfill valuation button** (`apps/web/src/modules/accounts/pages/CostingPage.tsx`, the stock tab): a "Backfill valuation" button behind the `costing.manage` permission that calls the existing `costingService.backfillValuation()` endpoint and renders the per-pair report in a table.

6. **Overtime register breach column** (`apps/web/src/modules/payroll/pages/RegistersPage.tsx`): the `payrollBreach` column is highlighted in red with a tooltip naming the quarterly cap (125 hours).

Tailwind only; `en-IN` formatting; keep every existing smoke marker.

## Out of scope

New routes, new database models, new backend services, new permissions, modifications to any spec'd package's tests.

## Acceptance

- `npm run typecheck -w @shiftline/web` green; lint, prettier and `npm run build -w @shiftline/web` green.
- `apps/api/test/integration/leave.spec.ts` still passes.
- No new screens, so `e2e/smoke.spec.ts` unchanged.
