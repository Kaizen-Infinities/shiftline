# P1-16 — Statutory payroll and filings

## Why

The payroll engine already works out attendance, overtime, gross and net (Phase 0). What it does
not do is the statutory half, and the statutory half is where the penalties are: the provident
fund split the EPFO expects, professional tax at the rate the _state_ charges rather than a flat
number, labour welfare fund, tax on salary, and the four files that have to be uploaded every
month. Today an accountant recomputes all of it in a spreadsheet from the payroll register, which
is both the slowest part of the month and the part most likely to be wrong.

## What the existing engine gets wrong for statutory purposes

- **PF is one number.** The EPFO does not take 12% from the employer: it takes **8.33% to the
  pension fund** (on wages capped at ₹15,000, so ₹1,250), the balance to the provident fund,
  **0.50% EDLI** and **0.50% administration charges**. An ECR built from a single "employer PF"
  figure is rejected.
- **Professional tax is a flat amount.** It is a state tax with its own slabs, and several states
  charge a different amount in one month of the year.
- **There is no labour welfare fund, no salary tax, and no file output at all.**

## Scope

- **Statutory rules per state**: professional tax slabs, and labour welfare fund with its
  frequency, seeded for the states a manufacturer is likely to be in and editable.
- **The statutory split** per employee per run: PF wage, ESI wage and PT wage are three different
  wages, and each contribution comes off its own.
- **The Labour Code wage check**: basic plus dearness allowance must be at least half of gross.
  A structure that fails it is reported rather than silently accepted, because the whole point of
  the rule is that PF, gratuity and bonus are worked out on that wage.
- **Tax on salary** (section 392) with the old and the new regime, the employee's declaration,
  and the month's deduction as a twelfth of the projected liability.
- **The files**: the EPFO ECR (`#~#`-delimited), the ESIC monthly contribution file, a
  professional-tax challan summary and a bank salary transfer file.
- **The payroll journal**: salary and the employer's contributions to expense, everything withheld
  to its own liability, and the net to a payable.
- **The filing gate** for `PF_ECR`, `ESI_MONTHLY`, `PT_RETURN`, `TDS_24Q` and `PAYROLL_RUN`.

## Out of scope

Gratuity, bonus, leave encashment and full-and-final settlement (P1-17b), the Form 16 PDF (TRACES
issues Part A; Part B is a template job), and direct upload to the EPFO or ESIC portals.

## Acceptance

- The employer's 12% splits 8.33/3.67 with the pension share capped at ₹1,250, and EDLI and
  admin charges are computed separately.
- Professional tax follows the state's slab, not a flat figure.
- A structure whose basic is under half of gross is flagged.
- The ECR file has one line per employee in the EPFO's field order.
- The payroll journal balances and the net pay equals the bank transfer file's total.
- Every query is tenant-scoped.
