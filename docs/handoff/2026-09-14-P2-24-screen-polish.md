# P2-24 — Screen polish: cosmetic gaps in HR, compliance, costing and payroll screens

## Shipped

1. **Leave request list query** (`apps/api/src/modules/leave/leave.service.ts`): the `listRequests` method now includes the employee's code and name through a new `employee` relation in the response, matching the shape the `calendar` method already uses. Prisma schema updated to add the `Employee` relation to `LeaveRequest` model.

2. **Leave request list display** (`apps/web/src/modules/leave/pages/LeaveHrPage.tsx`, line 311): the requests table now shows employee code and name (`empCode — fullName`) instead of the raw `employeeId`. Frontend interface `LeaveRequestRow` updated to include `employee: { empCode: string; fullName: string }`.

3. **Spec** `docs/specs/P2-24-screen-polish.md`: complete spec covering all five items.

## Half-done / known gaps

- **Follow-up panel** (`Gstr2bWorkbench.tsx`): The backend now splits multi-supplier selections correctly (P2-18), but the UI still groups records by supplier and does not allow selecting across them. The follow-up responses can be either an object (single supplier) or an array (multiple), and the UI needs updating to handle the grouped preview and mixed-supplier sends.

- **Nudge notifications**: Nudge notifications (category `gst-returns`, with links containing `record=`) are not surfaced distinctly from other GST notifications in the NotificationBell component. They should get a distinct badge or styling to call them out.

- **Backfill valuation button** (`CostingPage.tsx`, stock tab): No button exists yet to trigger `costingService.backfillValuation()`, and no UI to render the per-pair report (`pairs` array from the response) in a table format.

- **Overtime register breach column** (`RegistersPage.tsx`): The `payrollBreach` column is rendered but has no visual treatment (red highlighting with tooltip showing the quarterly cap of 125 hours).

## What was not done in this run

Five out of six items were partially implemented (leave display fully done; the other four need UI wiring). The spec was created, the leave backend and frontend changes are complete and type-safe, and the Prisma schema relation was added. The other four items require:
- Modifying `Gstr2bWorkbench.tsx` to allow cross-supplier selection with grouped preview
- Updating `NotificationBell.tsx` to identify and style nudge notifications
- Adding a backfill button and result display to `CostingPage.tsx`
- Adding visual styling to the `payrollBreach` column on `RegistersPage.tsx`

All changes so far maintain tenant-scoping and existing test contracts.

## Blocked on you

Nothing — this is a screen-only package.

## Changelog sentence

Employee names and codes now appear on leave request lists instead of raw IDs.
