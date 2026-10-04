# P2-16 — Payroll follow-ups

## Shipped

- **Quarterly overtime cap, for real.** New `OvertimeQuarterPeriod` model (migration
  `20260914160000_payroll_followups`, audited, RLS — the same shape as P2-02's
  `EsiContributionPeriod`): a per-employee, per-calendar-quarter running total of overtime hours.
  `computeResult`'s Step 4 now reads the quarter's hours banked so far
  (`statutoryPayrollService.peekOvertimeQuarterHours`) before calling `labour.calc.overtimeForWeek`,
  so `quarterToDateHours` is a real figure and `hoursOverCap` is a real breach instead of always
  zero; the run's own hours are then banked back
  (`statutoryPayrollService.recordOvertimeQuarterHours`) for the next run to build on. The breach
  is recorded on the result (`PayrollResult.otHoursOverCap`, new column) and paid in full — the
  cap is a compliance breach for the company, never a reason to withhold overtime already worked.
  `registers.overtime()` now also reports `payrollBreach` per row, read from the persisted
  register rather than the register's own ad-hoc "cumulative attendance hours > cap" estimate
  (kept alongside it as `overCap`, unchanged, since existing tests assert on it).
- **Dead settings off the screen.** `PayrollSettings.tsx` drops the OT "Rate per Hour" field and
  the whole "Professional Tax" toggle/amount block, replacing each with a one-line note pointing
  at what the run actually uses (double the ordinary rate; the employee's own work-state slab).
  Schema and `updatePayrollConfigSchema` are untouched — an old client that still posts
  `otRatePerHour`, `otSlabs`, `otMethod`, `weekdayOtMultiplier`, `holidayOtMultiplier`,
  `professionalTaxEnabled` or `professionalTaxAmount` keeps working, the values just round-trip
  unread.
- **Work-state backfill.** The migration's data step sets every `Employee.workStateCode` still
  `NULL` to the employing company's own `stateCode` — a plain `UPDATE ... FROM companies`, run
  once as part of the migration (the migrator role, which bypasses RLS, same as every other
  migration in this repo).
- **Tax declaration reminder.** `computeRun`'s response now carries `missingTaxDeclarations`:
  every active employee in the run with no `EmployeeTaxDeclaration` for the run's financial year,
  built from the same `declarationByEmployee` map PT/TDS already load — no extra query. The run
  screen (`PayrollRun.tsx`) shows it alongside the existing variance banner, plus a new banner for
  overtime-cap breaches. `statutoryPayrollService.missingDeclarations(fyCode)` (reusable, tenant-
  scoped) and `remindMissingDeclarations(fyCode)` (notifies each missing employee's linked user,
  once per FY — idempotent the same way `msme.job.ts` is, by checking for an existing
  notification with the same `category` + `link` before sending) back both the response and a new
  monthly pg-boss job, `payroll-declaration.job.ts` (queue `payroll.tax-declaration.reminder`,
  09:00 IST on the 1st, after the leave accrual job). An employee with no linked user is simply
  not notified in-app — HR still sees them on the run screen's own list.
- **Wages register TDS.** `registers.service.ts`'s `wages()` reads `tds` from
  `PayrollResult.salaryTds` (added by P2-02) instead of a hard-coded 0, and folds it into the
  row's own `totalDeductions` sum, which previously omitted it too.
- **Landscape PDFs.** `generatePdfFromHtml(html, { landscape })`; `registers.export.ts`'s `toPdf`
  and `registers.routes.ts`'s `respond()` both take the flag through; the muster roll (one column
  per day) and the wages register (a long row) now render landscape. Every other caller of
  `generatePdfFromHtml` is unchanged — the option defaults to `false`.

## Decisions worth knowing

- **The quarter is a calendar quarter** (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec), matching what
  `registers.service.ts`'s `quarterMonthsUpTo` already used for its own (attendance-only)
  estimate — not a rolling 90-day window, and not the company's financial year quarter (which
  would start in April). `statutory.service.ts`'s new `quarterBoundsFor` is the single source for
  both the payroll run and the register.
- **The running total is banked from the run's `periodStart`**, the same "first attended date of
  the period" `computeRun` already derives for both MONTHLY and WEEKLY runs — so a WEEKLY run's
  overtime also counts toward the quarter, even though PT/TDS/ESI stay monthly-only concepts.
  This is a change in behaviour from before (which had no running total at all), not something
  this package had a WEEKLY-specific test for; worth a second look if WEEKLY overtime turns out
  to need its own treatment.
- **`breached` is sticky within the quarter.** Once any run pushes the total past 125 hours, the
  register keeps `breached: true` even if a later run in the same quarter adds no overtime hours
  of its own (`recordOvertimeQuarterHours` only ever sets it, never clears it, within one
  `quarterKey`).
- **Testing the migration's data step directly wasn't possible through the app's own Prisma
  client**: raw SQL via `prisma.$executeRawUnsafe` skips the tenant-scoping extension in
  `lib/prisma.ts` (which only wraps `$allModels.$allOperations`, not `$executeRaw`), so the
  session-local `app.company_id` RLS setting is never applied and the migration's own `UPDATE ...
  FROM companies` statement, run that way, touches zero rows. `payroll-followups.spec.ts`'s
  backfill test instead drives the same `WHERE workStateCode IS NULL` condition through
  `employee.updateMany` (which does go through the extension), proving the same effect the
  migration's SQL produces when the migrator role runs it directly.
- **`missingTaxDeclarations` is every active employee in the run, not just the ones in the
  attendance payload** — the same set `computeRun` already loads for PF/ESI/PT, most of whom are
  probably not new hires with unfiled declarations. This matches how the run already treats
  "every active employee" as its universe elsewhere; a smaller "only who was actually paid this
  run" list would need its own employee set, which nothing else in `computeRun` tracks.

## Half-done / known gaps

- The overtime register's `overCap` field (attendance-summed, P2-03's original estimate) and the
  new `payrollBreach` field (from the persisted running total) can disagree if attendance is
  edited after a run, or if a run for the period was deleted — kept both rather than replacing
  one with the other, since existing `registers.spec.ts` assertions pin `overCap`'s exact
  behaviour. Worth collapsing to one field once a decision is made about which should win.
- No UI change to the overtime register page beyond the new column reaching it automatically
  (the page renders whatever columns the API returns) — nobody has asked yet whether
  `payrollBreach` needs its own visual treatment there the way the run screen's new banner does.
- The reminder job only notifies a user linked to the employee (`User.employeeId`); nothing
  escalates to HR/payroll if an employee has no login at all. The run screen's own banner is the
  only place that gap is currently visible.

## Next

P2-09's daily attendance hours (if they land) would let the quarter's overtime hours be derived
from real per-day figures instead of the single-day `[9 + otHours]` encoding `computeResult`
already used before this package — the running total banked here would then be exact rather than
inheriting that same approximation, which P2-02's own hand-off already flagged as a known gap.

## Blocked on you

Nothing — this package only closed gaps already named in two earlier packages' own hand-off
notes.

## Changelog sentence

The quarterly overtime cap now actually flags a breach instead of never triggering, employees
with no tax declaration on file are reminded once a year, employees created before work-state
tracking existed have it filled in, the wages register shows tax deducted at source, and the
muster roll and wages register can be exported as landscape PDFs.
