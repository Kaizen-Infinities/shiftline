# P2-02 — Payroll reconciliation

## Shipped

- `payroll.service.ts`'s `computeResult` now delegates to the calculators instead of
  re-deriving the same figures:
  - **PF** via `statutory.calc.pfSplit` on the basic (or gross) wage the payroll settings
    already name — the old flat 12%-both-sides arithmetic is gone. `PayrollResult.employerPf`
    now reports the employer's true monthly cost (pension + PF + EDLI + admin together), not a
    guessed 12%.
  - **ESI** via `statutory.calc.esiSplit`, gated by eligibility for a MONTHLY run through the new
    contribution-period register (below) rather than a month-by-month wage check.
  - **Professional tax** via `statutory.calc.professionalTax`, against the employee's own work
    state and the state's real slabs — the old flat five-band guess keyed to `monthlySalary` is
    gone. `PayrollConfig.professionalTaxEnabled` / `professionalTaxAmount` are no longer read by
    the run (still on the settings screen; a follow-up should remove them from the UI once
    nobody depends on the flat figure).
  - **Salary TDS** (new): `statutory.calc.salaryTax` on the employee's declared regime
    (`EmployeeTaxDeclaration`, default NEW/no deductions when nothing is on file), a twelfth of
    the year's projected liability, stored as `PayrollResult.salaryTds` and subtracted from net.
  - **Overtime** via `labour.calc.overtimeForWeek`, at double the ordinary hourly rate
    (`dailyRate ÷ working hours/day`), instead of `otHours × settings.otRatePerHour` — which
    defaulted to ₹0 and so paid no overtime at all under the seeded settings. `otSlabs`,
    `otMethod`, `weekdayOtMultiplier` and `holidayOtMultiplier` are no longer read by the run for
    the same reason as the PT settings above.
  - `PayrollResult.netSalary` is now `gross + OT − employee PF − employee ESI − PT − salary TDS
− late entry − permission − salary advance − loan recovery − other deductions`, rounded up
    to the nearest ₹10, plus cash-in-hand — where it used to omit PT and TDS entirely.
- **ESI contribution period** (new `EsiContributionPeriod` model, migration
  `20260914020000_payroll_reconciliation`): eligibility is decided once, at the first MONTHLY
  run in each Apr–Sep / Oct–Mar half-year, from that month's gross, and left alone —
  `statutoryPayrollService.resolveEsiEligibility` upserts the row and returns the stored
  decision on every later call in the same period, so a raise that crosses ₹21,000 mid-period
  does not stop the contribution. WEEKLY runs and runs given no statutory context fall back to
  the plain per-run wage-limit test, since the register is a monthly concept.
- **`Employee.workStateCode`** (new column, same migration): defaults to the company's state at
  creation (`employee.service.ts`), drives PT and the welfare fund basis in the run, is on the
  employee validation schema and the employee form (a state picker next to the statutory
  toggles, using the existing `GST_STATES` list) and the view page.
- The payroll journal (`statutoryPayrollService.postJournal`) needed no change: it already
  computed net as gross less PF, ESI, PT and income tax withheld for the voucher, which is
  exactly what `PayrollResult.netSalary` now also equals — the two were already consistent on
  the journal side, just not on the payslip side.
- Web: the payslip (`PayslipDocument.tsx`) and the run screen (`PayrollRun.tsx`, table column,
  CSV export) show PT, salary TDS and OT pay as separate lines.
- `apps/api/test/integration/payroll-reconciliation.spec.ts` (5 tests): the golden-numbers
  reconciliation for an employee in Tamil Nadu above the TDS threshold; two employees on the
  same wage in different states getting different PT; overtime paid once at double wages; ESI
  eligibility surviving a wage rise from month one to month two of a contribution period, with
  the stored decision asserted directly; and a cross-tenant check that a foreign company sees
  neither the `PayrollResult` rows nor the `EsiContributionPeriod` row.

## Decisions worth knowing

- **PF, ESI, PT and TDS are computed synchronously off per-run maps, not per employee.** State
  rules and this year's tax declarations are fetched once per run into `Map`s
  (`StatutoryContext`); only ESI eligibility needs a database round trip per employee (the
  contribution-period upsert), so `computeResult` is async for that one reason and pure
  otherwise.
- **Overtime hours are treated as the excess beyond a single nine-hour synthetic day**
  (`dailyHours: [9 + otHours]`) rather than reconstructing a real daily attendance breakdown,
  because attendance only carries a period total, not per-day hours. This gets the daily trigger
  exactly right and slightly undercounts the weekly trigger for an employee already near 48
  hours before the recorded OT — a real gap, not just a simplification, and worth fixing if
  attendance ever starts recording daily hours (P2-09's territory, not touched here).
  `quarterToDateHours` (the OSH Code's 125-hour cap) is not tracked; every run computes it as
  though the quarter started blank, so `hoursOverCap` is never populated — the cap itself is
  still correct within a single run, just not across a quarter.
- **PT and TDS are monthly-only**, same as before: a WEEKLY run's `computeResult` gets no
  `StatutoryContext` and so charges neither, leaving them for the MONTHLY run that follows.
- **`workStateCode` failing to resolve falls through to no PT**, not to the company's state a
  second time: `professionalTax` only fires when a `StatutoryRule` exists for the resolved
  state. A company with employees in an unseeded state gets ₹0 PT for them rather than an error,
  same as P1-16's existing behaviour for an unrecognised state.

## Half-done / known gaps

- **Quarterly overtime cap is not tracked across runs** (see above) — `hoursOverCap` from
  `labour.calc` is computed but always relative to a blank quarter, so it never actually flags a
  breach. Wiring it needs a running total per employee per quarter, the same shape as the ESI
  register.
- **`PayrollConfig`'s OT and flat-PT fields are now dead weight**: `otRatePerHour`, `otSlabs`,
  `otMethod`, `weekdayOtMultiplier`, `holidayOtMultiplier`, `professionalTaxEnabled` and
  `professionalTaxAmount` are still on the schema and the settings screen but no longer read by
  the run. Leaving them rather than deleting them, since P2-03's registers and other reports may
  still reference the settings screen — but they should come off that screen so nobody edits a
  number that no longer does anything.
- **No UI for `EmployeeTaxDeclaration`** was touched here (P1-16 already has one at
  `/payroll/statutory`); an employee with no declaration on file is taxed under the new regime
  with zero deductions, which is correct per the calculator's own rule but worth an employee
  reminding they should file one.
- Employees created before this migration have `workStateCode = NULL` and are treated as the
  company's own state until someone opens and re-saves their form (which now defaults it) or
  calls the employee update API with an explicit value; there is no backfill migration.

## Next

P2-03 (inspector's registers) can read `PayrollResult.salaryTds` and `EsiContributionPeriod` for
the wages/overtime/deductions registers instead of recomputing them. P2-09 (leave management)
is the natural place to start recording daily attendance hours, which would let the overtime
weekly trigger and the quarterly cap be computed exactly rather than approximately.

## Blocked on you

Nothing — this package only reconciled calculators that were already approved in P1-16/P1-17b.

## Changelog sentence

Professional tax, tax on salary and overtime at double wages now actually reduce net pay, ESI
stays payable for the rest of a contribution half-year once an employee crosses the wage limit,
and an employee's own work state — not just the company's — decides their professional tax.
