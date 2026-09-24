# P2T-02 — Wire the Labour Code wage rules into the payroll run

## Shipped

`payroll.service.ts#computeResult`'s Step 4 (OT pay) no longer reads `PayrollConfig.otRatePerHour`
or `otSlabs`: every recorded overtime hour is now paid at twice the employee's ordinary hourly rate
(`dailyRate / defaultWorkingHoursPerDay`), reusing `OVERTIME_MULTIPLIER` from `labour.calc.ts` so
the settlement/gratuity math and the payroll run can never disagree on the multiplier again.
`otEnabled` is still the on/off switch — with it off, no overtime is paid, same as before.

This closes the Phase 1 completion note's second cross-cutting gap: "Overtime and the Labour Code
wage rules are computed but not wired into the payroll run."

## Tests

`apps/api/test/integration/payroll.spec.ts` (written as the P2T-04 safety net, now updated for the
intentional change): the fixed-monthly happy path now asserts the exact Labour Code figure — 5
hours at `(1000/8)*2 = 125` per hour = ₹1,250 — flowing through to gross and net pay; a new test
proves `otEnabled: false` still pays nothing. Every other characterised figure (PF cap, ESI
ceiling, PT, LOP, the daily-weekly divisor) is untouched. 6/6 tests green; full API suite (once all
P2-T package 4 suites land) still to be re-run together before this package is called done — see
the package 4 note.

## Half-done / known gaps

- This reconciles the **rate**, not the **hours**: which hours count as "overtime" is still
  whatever the caller (today, the web form) already decided and sent as `otHours` for the period —
  there is no per-day breakdown at this call site to run the 9-hour/48-hour/quarterly-cap logic in
  `overtimeForWeek()` against. Recomputing overtime hours themselves from raw attendance is
  attendance-capture work, out of scope for a wage-rate reconciliation package.
- `PayrollConfig.otRatePerHour`, `otSlabs`, `otMethod`, `weekdayOtMultiplier`, `holidayOtMultiplier`
  and the max-OT-hours settings are left in the schema and the settings API, unused for pay from
  here on. Removing them is a web-forms change (`apps/web`'s payroll settings screen still exposes
  them) and this package does not touch `apps/web`.

## Next

P2T-03: the inspector's registers (muster roll, wages, overtime, fines, deductions, advances).

## Blocked on you

Nothing new.

## Changelog

Overtime pay now follows the Labour Code's double-rate rule instead of an optional, separately
configured rate that defaulted to paying nothing.
