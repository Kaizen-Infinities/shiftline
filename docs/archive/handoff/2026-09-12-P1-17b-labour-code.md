# P1-17b — Labour Code entitlements: leave, gratuity, bonus and settlement

## Shipped

- `labour.calc.ts`, apart from the database because each formula is checked against the bare
  words of an Act:
  - **Overtime** at double wages beyond nine hours a day or forty-eight a week, taking the
    _greater_ of the two excesses rather than the sum, and naming the hours worked beyond the
    quarter's ceiling.
  - **Gratuity**: fifteen days' wages a year on a twenty-six-day month, after five years — one for
    a fixed-term employee — with a final part-year over six months rounding up and the ₹20 lakh
    ceiling applied.
  - **Statutory bonus**: eligible under ₹21,000 of wage, computed on the ₹7,000 calculation
    ceiling (or the minimum wage where higher), held between 8.33% and 20%.
  - **Leave accrual** on an annual, monthly or days-worked basis, carry-forward with lapse, and
    encashment at the daily wage.
  - **The settlement**: dues less recoveries, with notice not served recovered at the daily wage.
- `Holiday`, `LeaveType` (seeded with earned, casual and sick leave), `LeaveBalance` as a running
  register, and `FinalSettlement`.
- The gratuity liability across everyone still employed, valued as if they left today.
- The year's statutory bonus, employee by employee.
- A settlement preview, a stored settlement, and approval that posts a voucher: dues to salaries,
  **gratuity to its own expense ledger**, recoveries against the cost, and the net to salaries
  payable — or to receivables when the settlement comes out negative.
- One seed ledger (`GRATUITY-EXP-001`), routes under `/api/labour`, migration
  `20260913040000_labour_code` with RLS and audit triggers, web `/payroll/entitlements` with five
  tabs, in `e2e/smoke.spec.ts`. `labour-code.spec.ts` — 21 unit tests and 8 integration tests.

## Decisions worth knowing

- **The two overtime triggers do not add up.** An hour beyond nine on Tuesday is the same hour
  that takes the week past forty-eight; adding them pays that hour twice. The answer is the
  greater of the two, and a test says so with the arithmetic spelled out.
- **Hours over the quarterly ceiling are still paid.** The employee worked them. The breach is
  the company's, and underpaying the person who worked the hours does not cure it — so the report
  names the excess instead.
- **Bonus is on the ceiling, not the wage.** An employee on ₹20,000 is eligible but the bonus is
  computed on ₹7,000. Computing it on the real wage overstates the liability nearly threefold,
  and this is the single most common error in the Act.
- **Gratuity is on basic plus dearness allowance, not gross.** Using gross overstates every
  settlement by the allowances.
- **The gratuity liability is reported for everyone, not just leavers.** A company that computes
  it only on resignation is carrying an unrecorded liability, which is exactly what the report
  exists to surface.
- **A settlement may be negative and is left negative.** When notice recovery and advances exceed
  the dues, the employee owes the company; clamping it to zero would lose a real receivable, so
  the voucher debits receivables instead.
- **Leave is a register, not a derivation.** Leave is argued about, and the argument is always
  "what did I have at the start of the year" — which a recomputation cannot answer once the
  policy has changed. The opening balance is written once and then left alone; a test proves a
  second accrual with a different opening does not move it.

## Half-done / known gaps

- **Nothing accrues leave automatically.** `accrue` takes the days worked and has to be called;
  a monthly job off the attendance records is the obvious next piece and is not here.
- Overtime is computed but not wired into the payroll run: the existing engine has its own OT
  slabs, and reconciling the two means the engine calling this calculator. Same shape as the
  P1-16 gap, and the same fix.
- Leave taken is recorded as a number, not as dated requests. There is no application, approval
  or calendar, so a manager cannot see who is off next Tuesday.
- Gratuity is the statutory formula, not an actuarial valuation. For a small company that is what
  is provided on; an Ind AS 19 valuation differs and is an actuary's year-end job.
- Bonus assumes twelve months worked for everyone and takes no account of the year's allocable
  surplus — the Act sets the percentage from the profits, and here it is entered.
- The registers the inspector asks for (muster roll, wages, overtime, fines, deductions,
  advances) are not written. The data for most of them exists across attendance, payroll and
  advances; each is a report and none is hard, but none is done.
- No employee-facing view: nobody can see their own leave balance.

## Next

P1-21 and P1-22: payment links, subscription billing and SMS/OTP — provider interfaces and
fixture adapters only, since the owner accounts do not exist yet.

## Blocked on you

- The leave policy the company actually operates: days a year, the accrual basis and the
  carry-forward cap. The seeded types are the Factories Act's defaults, not the company's rules.
- The bonus percentage for the year, which follows from the allocable surplus and is a decision.

## Changelog sentence

Leave now accrues on days worked and carries forward to a cap, gratuity is reported as the
liability it is for everyone still employed rather than only for leavers, the statutory bonus is
computed on the right ceiling, and a full and final settlement can be prepared, approved and
posted in one step.
