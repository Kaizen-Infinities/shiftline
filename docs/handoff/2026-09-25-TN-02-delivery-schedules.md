# TN-02 — OEM delivery schedules and schedule adherence

Spec: `docs/research/tamil-nadu/market-and-features.md`, "BUILD NOW 2: TN-02".

**Changelog:** Record your customers' delivery schedules, book dispatches against each line, and
see your schedule adherence and OTIF per customer and month before the OEM's portal shows it.

## Shipped

- Models `CustomerSchedule`, `CustomerScheduleLine`, `CustomerScheduleDispatch` (uuid ids,
  `Decimal(14,3)` quantities, `@@unique([companyId, scheduleNo, revision])`), migration
  `20260925020000_delivery_schedules` with RLS and audit triggers; the three models are in
  `AUDITED_MODELS`. A dispatch links a sales invoice by id only (checked with `findFirst`).
- `delivery-schedules.calc.ts`, a pure function: per-line dispatched / on time / late / short and
  status (PENDING, MET, LATE, SHORT, EXCESS above 110%); adherence % = Σ min(onTime, scheduled) /
  Σ scheduled over FIRM lines; OTIF % = MET / FIRM lines that are due. 10 unit tests.
- `/api/delivery-schedules`: list, create (with up to 500 lines), get with line metrics, patch
  header/status/revision, bulk add lines, patch/delete line (409 once dispatched), add/delete
  dispatch, `GET /due?days=7`, `GET /adherence?from&to&customerId`. `authMiddleware`,
  `requireFeature("sales")`, `requirePermission("delivery-schedules.*")`. `due` and `adherence`
  take an optional `asOf` so tests do not depend on the clock. Adherence counts only the latest
  non-cancelled revision of each schedule number.
- Shared: permission module `delivery-schedules` (view/create/edit/delete/export), added to the
  `sales` feature, `API_PATHS.deliverySchedules`. The STORES role gets it on provisioning; OWNER
  gets everything.
- Web `/sales/delivery-schedules` (`DeliverySchedulesPage.tsx`): Schedules tab (list, create
  form with an Excel paste box in the order `partNo ⇥ dueDate ⇥ qty ⇥ F/T`, line detail with a
  per-line dispatch entry), Due this week, and Adherence with ≥95 / 85–95 / <85 colour bands.
  Nav entry under Transactions → Production, smoke test entry.
- 7 integration tests: happy path with adherence numbers, the due list, bulk lines and the 409
  on a dispatched line, duplicate number/revision 409, every validation rejection, permission
  refusal (demo.production), cross-tenant (foreign company sees nothing, foreign customer id is a
  404).

## Not done / next

- No editing of a line or header from the web page beyond dispatch entry and the create form;
  the API supports it.
- Product link on a line is accepted by the API but not offered in the paste box.
- The schedule-month picker offers only the last 12 months (`monthOptions`); future months
  need a small helper.
- Linking dispatches automatically from `SalesInvoice`, EDI/ASN transmission: TN-07.
- No screenshot of the running stack was taken.
