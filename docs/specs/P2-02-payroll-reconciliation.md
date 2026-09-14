# P2-02 — Payroll reconciliation

## Why

P1-16 and P1-17b built the statutory and Labour Code calculators correctly but left them
unconnected to the payroll run: professional tax and salary TDS did not reduce net pay, overtime
was paid at the old engine's own rate rather than double wages, ESI eligibility was re-read every
month instead of fixed for the contribution period, and every employee was taxed at the company's
one state regardless of where they actually work.

## Scope

- `payroll.service.ts` calls `statutory.calc` (PF, ESI, PT, salary TDS) and `labour.calc`
  (overtime at double wages) while computing a run, instead of duplicating that arithmetic.
  `PayrollResult.netSalary` = gross + OT − employee PF − employee ESI − PT − salary TDS − other
  deductions (late entry, permission, advance, loan, other).
- ESI eligibility is decided once at the start of each contribution half-year (Apr–Sep,
  Oct–Mar) and stored in a new `EsiContributionPeriod` row; an employee who crosses the wage
  limit mid-period keeps contributing until the period ends.
- `Employee.workStateCode` (defaults to the company's state) drives professional tax and the
  labour welfare fund; exposed on the employee API and form.
- The payroll journal already posted by `statutoryPayrollService.postJournal` carries PT and
  salary TDS to their ledgers — unchanged, now consistent with the reconciled net.
- Web: the payslip shows PT, salary TDS and OT as separate lines; the employee form gets a work
  state field.

## Out of scope

Form 16 Part B, the 24Q file writer, leave requests (P2-09), the inspector's registers (P2-03).
`labour.service.ts`'s leave functions are untouched beyond importing `overtimeForWeek`.

## Acceptance

- An employee in a PT state, above the salary-TDS threshold, gets net = gross + OT − employee PF
  − employee ESI − PT − salary TDS − other deductions.
- An employee who crosses the ESI wage limit in the second month of a contribution period still
  contributes for the rest of that period.
- Two employees in different work states get different professional tax in the same run.
- Overtime is paid once, at double the ordinary hourly rate.
- Every query is tenant-scoped; a cross-tenant test proves a foreign `companyId` sees nothing.
