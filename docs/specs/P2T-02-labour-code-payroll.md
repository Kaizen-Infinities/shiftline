# P2T-02 — Wire the Labour Code wage rules into the payroll run

## Why

The Phase 1 completion note: "Overtime and the Labour Code wage rules are computed but not wired
into the payroll run. The engine has its own slabs; reconciling the two is one package." P1-17b's
`labour.calc.ts` computes overtime at double the ordinary rate (`OVERTIME_MULTIPLIER`); the legacy
payroll engine (`payroll.service.ts#computeResult`) pays overtime at a company-configurable flat
rate (`PayrollConfig.otRatePerHour`), which defaults to 0 — so today, overtime hours are recorded
on every result but nothing is actually paid for them unless an operator sets a rate by hand. One
of the two has to win, and per the brief it is the statutory one.

## Scope

- `computeResult()`'s OT step no longer reads `otRatePerHour`/`otSlabs`/the multiplier settings.
  It pays every recorded OT hour at twice the employee's ordinary hourly rate
  (`dailyRate / defaultWorkingHoursPerDay`), reusing `OVERTIME_MULTIPLIER` from `labour.calc.ts` so
  the two engines can never drift apart on the multiplier again. `otEnabled` remains the master
  switch (off means no OT is paid, matching today).
- Update `payroll.spec.ts` (written in P2T-01/04 as the pre-change safety net): the assertion that
  described the old "no overtime paid by default" behaviour is replaced by one proving the new
  figure — `otPay = otHours * (dailyRate / workingHours) * 2` — over a period containing overtime.
  Every other characterised figure (PF, ESI, PT, LOP) is unaffected and stays as it was.

## Out of scope

Recomputing _how many_ hours count as overtime from raw daily punches (the 9-hour/48-hour/quarterly
thresholds in `overtimeForWeek()`) — the legacy engine's attendance input is a per-period aggregate
with no per-day breakdown at this call site, so there is nothing to run that function against here.
That is attendance-capture work, not wage-rate reconciliation, and is not what this package's
acceptance line asks for. The company's OT settings UI/schema fields are left in place (unused for
pay from here on) rather than removed, since deleting them is a web-forms change and this package
does not touch `apps/web`.

## Acceptance

- A payroll run over a period with overtime pays `otHours * (dailyRate / workingHoursPerDay) * 2`,
  regardless of `PayrollConfig.otRatePerHour`.
- `otEnabled: false` still pays no overtime.
- Every other figure `payroll.spec.ts` characterised (PF cap, ESI ceiling, PT, LOP, daily-weekly
  pay) is unchanged.
