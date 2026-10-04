# P1-16 — Statutory payroll and filings

## Shipped

- `statutory.calc.ts`, kept apart from the database because every number in it is a rule someone
  will check:
  - **The provident fund split the EPFO actually takes.** The employer's 12% is not one
    contribution: 8.33% goes to the pension scheme on wages capped at ₹15,000 (so ₹1,250), the
    balance of the 12% to the provident fund, and EDLI and administration charges are 0.50% each
    on top. Voluntary contributions are the employee's alone and are not matched.
  - **ESI at 0.75% and 3.25%, rounded up** — the scheme says up, and rounding down leaves the
    contribution short.
  - **Professional tax by state slab**, including the month-specific slab that states like
    Maharashtra use to take a larger amount once a year.
  - **The Code on Wages check**: basic plus dearness allowance against half of gross, with the
    shortfall named.
  - **Tax on salary** in both regimes with the standard deduction, section 87A rebate and cess.
- `StatutoryRule` per state, seeded for Tamil Nadu, Maharashtra, Karnataka, Gujarat, Telangana and
  Delhi (which levies no professional tax — the rule exists so the absence is explicit).
- `PayrollStatutory`: the split per employee per run, as its own table because PF wage, ESI wage
  and PT wage are three different wages.
- `EmployeeTaxDeclaration`: regime, declared investments, the projected liability and what has
  been deducted so far.
- **The files**: the EPFO ECR (`#~#`-delimited, eleven fields, EPS wage capped at the ceiling),
  the ESIC monthly contribution file, a professional-tax challan summary by state, the bank
  salary transfer file, and the Form 24Q rows.
- **The payroll journal**: gross to salaries, the employer's contributions to their own expense
  ledger, each withholding to its own liability, the net to salaries payable. Idempotent per run.
- **The filing gate** for `PF_ECR`, `ESI_MONTHLY`, `PT_RETURN` and `PAYROLL_RUN`.
- Six seed ledgers, routes under `/api/payroll-statutory`, migration
  `20260913020000_statutory_payroll` with RLS and audit triggers, web `/payroll/statutory`, in
  `e2e/smoke.spec.ts`. `statutory-payroll.spec.ts` — 19 unit tests and 8 integration tests.

## Decisions worth knowing

- **The employer's contribution is a cost, not a deduction.** It is debited to its own expense
  ledger rather than netted against the salary bill, because that is what it is: the cost of
  employing someone, not something taken off their pay.
- **Anyone left out of a file is counted and named.** A member with no UAN cannot go in the ECR
  and an employee with no bank details cannot go in the transfer file — and an employee silently
  dropped from a transfer file does not get paid. The counts travel on response headers so they
  are seen before the file is uploaded.
- **The new regime ignores the declaration.** An employee who declares investments and then
  chooses the new regime gets nothing for them; the calculator sets other deductions to zero
  rather than quietly applying them, and a test asserts it.
- **Delhi has a rule with no professional tax.** An empty rule says "this state does not levy it";
  a missing rule would look like an oversight.
- **Rates are exported constants.** A Finance Act moves them every year, and they should be
  visible and changeable rather than buried in an expression.

## Half-done / known gaps

- **The statutory figures are not fed back into net pay.** `PayrollResult.netSalary` comes from
  the existing engine, which computes PF and ESI its own way; this module computes them again,
  correctly, alongside. The two agree on the employee's PF and ESI but the professional tax and
  the salary tax worked out here do not reduce the net. Reconciling them means the existing engine
  calling this one, which is the next piece of work and the most important one.
- Form 16 is not produced. Part A comes from TRACES and cannot be made here; Part B is a template
  job on top of `form24QRows`, which exists.
- Form 24Q is data, not a file. The `^`-delimited writer lives in the TDS module and takes a
  deductee block; wiring the salary annexure into it is small.
- The ESI contribution period rule is not implemented: eligibility is taken from the employee
  flag each month, where the scheme fixes it for the whole six-month period. An employee crossing
  the wage limit mid-period should keep contributing until the period ends.
- One state per company. `stateCode` comes from the company, so a factory in two states gets one
  state's professional tax for everyone. The employee needs a work-state of their own.
- Only six states are seeded, and the slabs are the rates as at writing. They are editable, which
  is the point, but a company outside those six has to enter its own.
- LWF frequency is honoured by naming the months; a state that collects in a month the default
  does not name needs the rule edited.

## Next

P1-17b: Labour Code rules, leave, gratuity, bonus and full-and-final settlement.

## Blocked on you

- Which states the company employs people in, and the current professional-tax slab for each. The
  seeded rates are correct as at writing but a state notification changes them without notice.

## Changelog sentence

Payroll now produces the statutory half of the month: the provident fund split the way the EPFO
takes it, ESI, professional tax at the state's own slab, the welfare fund and tax on salary — with
the EPFO, ESIC and bank transfer files, the payroll journal, and the filings sent for approval.
