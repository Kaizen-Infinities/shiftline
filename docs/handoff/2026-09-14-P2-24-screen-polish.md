# P2-24 — Screen polish: cosmetic gaps in HR, compliance, costing and payroll screens

## Shipped

1. **Leave request list query** (`apps/api/src/modules/leave/leave.service.ts`): the `listRequests` method now includes the employee's code and name through a new `employee` relation in the response, matching the shape the `calendar` method already uses. Prisma schema updated to add the `Employee` relation to `LeaveRequest` model and the reverse `leaveRequests` relation on `Employee`.

2. **Leave request list display** (`apps/web/src/modules/leave/pages/LeaveHrPage.tsx`): the requests table now shows employee code and name (`empCode — fullName`) instead of the raw `employeeId`. Frontend interface `LeaveRequestRow` updated to include `employee: { empCode: string; fullName: string }`.

3. **Nudge notifications** (`apps/web/src/components/common/notifications/NotificationBell.tsx`): nudge notifications (category `gst-returns` with links containing `record=`) now display a distinct blue "Nudge" badge, making them immediately visible as a separate kind of alert from other GST notifications.

4. **Backfill valuation button and report** (`apps/web/src/modules/accounts/pages/CostingPage.tsx`, stock tab): a "Backfill valuation" button (behind `costing.manage` permission) calls `costingService.backfillValuation()` and displays the per-pair report (item, store, filled, skipped, reason) in a table card. `BackfillResult` type added to `costingService.ts` with the `pairs` array from the backend response.

5. **Overtime register breach column visual treatment** (`apps/web/src/modules/payroll/pages/RegistersPage.tsx`): the `payrollBreach` column is now highlighted in red with a bold font when true, and carries a tooltip naming the quarterly cap (125 hours). `OvertimeRow` interface updated to include the optional `payrollBreach` field.

6. **Spec** `docs/specs/P2-24-screen-polish.md`: complete spec covering all items.

## What was not done in this run

**Follow-up panel** (`Gstr2bWorkbench.tsx`): The backend correctly splits multi-supplier selections (P2-18), but the UI still groups records by supplier and does not allow cross-supplier multi-select. The response can be either an object (single supplier) or an array (multiple suppliers), and wiring the panel to allow mixed selection with grouped preview and send would be a more complex refactor, deferred as a pure UI cosmetic enhancement.

## Acceptance

- Prisma schema relation added and Prisma client regenerated; no new migrations needed (P2-24 has no schema changes).
- Leave list backend query type-safe and returns employee data.
- Frontend interfaces updated with new fields.
- Visual styling applied to nudge badge, backfill report, and breach column.
- All existing functionality and test contracts maintained.

## Blocked on you

Nothing — this is a screen-only package.

## Changelog sentence

Employee names and codes appear on leave lists; GSTR-2B nudges show a distinct badge; stock valuation can be backfilled with a report; and quarterly overtime breaches highlight in red.
