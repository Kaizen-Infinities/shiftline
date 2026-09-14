# P2-16 — Payroll follow-ups

## Why

`2026-09-14-P2-02-payroll-reconciliation.md` left four gaps: the quarterly overtime cap
(`hoursOverCap` from `labour.calc`) is computed against a blank quarter every run, so it never
flags a breach; `PayrollConfig`'s OT and flat-PT fields are no longer read by the run but still
sit on the settings screen; employees created before `workStateCode` existed have it `NULL` with
no backfill; and nobody reminds an employee with no tax declaration on file. `P2-03-registers.md`
left two: the wages register's salary-TDS column is hard-coded to zero pending
`PayrollResult.salaryTds` (which P2-02 added), and the muster roll and wages register PDFs need a
landscape option on `generatePdfFromHtml`.

## Scope

1. `OvertimeQuarterPeriod` (new model, audited, RLS — the same shape as `EsiContributionPeriod`):
   a per-employee-per-quarter running total of overtime hours, read before each run's OT
   calculation and written back after it. `labour.calc.overtimeForWeek`'s `quarterToDateHours`
   now carries a real figure, so `hoursOverCap` is real; a run whose OT pushes the total past the
   OSH Code's 125-hour cap records the breach on `PayrollResult.otHoursOverCap` (paid in full —
   the breach is the company's, not a reason to withhold pay already earned) and the overtime
   register shows it as `payrollBreach`.
2. `PayrollSettings.tsx` drops the OT "Rate per Hour" field and the whole "Professional Tax"
   toggle/amount block; `PayrollConfig`'s schema and the settings API (`updatePayrollConfigSchema`)
   are untouched, so an old client that still posts `otRatePerHour` or `professionalTaxAmount`
   keeps working.
3. Data migration (in `20260914160000_payroll_followups`): every `Employee.workStateCode` still
   `NULL` is set to the employing company's own `stateCode`.
4. Tax declaration reminder: `computeRun`'s response carries `missingTaxDeclarations` — active
   employees with no `EmployeeTaxDeclaration` for the run's financial year — shown on the run
   screen; a monthly pg-boss job (`payroll-declaration.job.ts`, queue
   `payroll.tax-declaration.reminder`) notifies each one's linked user once per FY through
   `statutoryPayrollService.remindMissingDeclarations`.
5. `registers.service.ts`'s `wages()` reads `tds` from `PayrollResult.salaryTds` instead of a
   hard-coded 0.
6. `generatePdfFromHtml` takes a `{ landscape?: boolean }` option; the muster roll and wages
   register PDFs render landscape.

## Out of scope

`modules/leave`, `modules/fines`, the employee form, `LeaveHrPage`/`FinesPage` (P2-15). A UI to
file a tax declaration (P1-16 already has one at `/payroll/statutory`) — this only reminds.
Recomputing past `PayrollResult` rows against the new running total; the register is forward-only
from this package's migration.

## Acceptance

`apps/api/test/integration/payroll-followups.spec.ts`: two MONTHLY runs in the same calendar
quarter accumulate overtime and the second flags the breach on its result and the running-total
register; a run in the next quarter starts from zero; the backfill statement leaves no `NULL`
work state; the run response's `missingTaxDeclarations` names the right employees and the
reminder notifies their linked user once per FY; the wages register shows salary TDS from the
persisted run; the wages register's landscape PDF renders real PDF bytes; a foreign tenant sees
none of it. Existing payroll, statutory, labour and registers suites still pass.
