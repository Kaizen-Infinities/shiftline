# P2-12 — Piece-rate and incentive pay (HR7)

## Why

The backlog's own line: "Operator is already on every hourly record; pay it." `HourlyProduction`
carries `operatorId`, `qtyProduced` and `rejectQty`, and `ProductShiftRecord` carries the operator
list — none of it reaches payroll. `SalaryType` offers monthly, weekly, daily and hourly and no
piece option, which is how a large part of this sector actually pays.

Read `docs/specs/P2-00-shop-floor-foundation.md` first. P1-16 statutory payroll and P1-17b Labour
Code entitlements have both landed — the wage structure, the basic-at-least-50%-of-gross check and
the overtime rules constrain what piece-rate earnings may be, and this package consumes them rather
than restating them. `SalaryType` still has only `monthly`, `weekly`, `daily` and `hourly`.

## Scope

- **`PieceRate`** master (audited): the product or production step it applies to, the machine or
  technology where the rate differs, the rate per piece, effective-from and effective-to dates, and
  the minimum-wage floor that applies. Rates are versioned by date and never edited in place, so a
  past payroll run recomputes identically.
- **`SalaryType` gains `piece`** and `EmployeePayrollConfig` gains the piece-rate participation
  fields: whether the employee is on piece-rate wholly or as an incentive above a base, and the
  guaranteed minimum.
- **The statutory floor is absolute.** A piece-rate employee's earnings for a period may never fall
  below the applicable minimum wage for the days worked; where the pieces earn less, the difference
  is paid as a top-up and recorded as such, not silently absorbed. This is the rule that makes the
  package lawful and it belongs in the service, not the UI.
- **Earnings derivation** from `HourlyProduction`: good quantity only — `qtyProduced` less
  `rejectQty` — attributed to the operator on the row. Where a row names several operators through
  `DailyProductionPlan.selectedOperatorIds` or `ProductShiftRecord.operatorIds` (both CSV strings
  today), the split rule is explicit and configurable: equal, or by hours present from P2-11's
  attendance. Never infer a split silently.
- **Incentive schemes** above the base: a slab per product or per machine paying a bonus above a
  target quantity, and an optional quality gate that withholds the incentive when the shift's
  rejection percentage exceeds a threshold — which is what stops piece-rate from degrading quality,
  and is the reason this package comes after P2-07.
- **`PieceRateEarning`** per employee per date per production order, computed idempotently so a
  re-run of a period rebuilds without duplicating, and consumed by the P1-16 payroll run as an
  earnings component. Locked once the payroll run that consumed it is locked.
- Routes `/api/piece-rates` CRUD, `/api/piece-rate-earnings` (compute, list, by-employee,
  by-period). New permission module `piece-rates` (`view, configure, compute`) in `permissions.ts`,
  feature `shop-floor`, paths in `api-paths.ts`, keys to OWNER, PRODUCTION and the payroll set in
  `ROLE_DEFS`.
- Web: `/settings/piece-rates` with the effective-dated rate table, an earnings view per employee
  and per period, and a piece-rate component on the payslip. Into `e2e/smoke.spec.ts`.

**Anchor files:** `modules/payroll/` for the run, the components and the payslip;
`modules/hourly-production/hourly-production.service.ts` for where operator output is recorded;
`modules/product-shift-record/` for the multi-operator shape.

## Out of scope

Team or gang piece-rate settled outside individual attribution; contractor piece-rate billing (HR6
contract labour); revising `Machine.operatorId`, which stays the loose current-operator field it is;
any change to the statutory calculations P1-16 and P1-17b own.

## Acceptance

- `piece-rate.spec.ts`: a rate effective for a date is used and a later revision does not change a
  past period's recomputation; earnings count good quantity only and a rejected piece pays nothing;
  the equal split and the by-hours split each produce the expected division for a two-operator row,
  and an unconfigured split is refused rather than guessed; **an employee whose pieces earn below
  minimum wage is topped up and the top-up is recorded as its own component**; the incentive slab
  pays above target and the quality gate withholds it when rejection exceeds the threshold;
  recomputing a period twice produces identical earnings; earnings consumed by a locked payroll run
  cannot be recomputed; the piece component appears on the payslip and the run total reconciles.
- `statutory-payroll.spec.ts` and `labour-code.spec.ts` stay green and no statutory calculation they
  own changes. `modules/payroll/` itself still has no suite — characterise what you touch.
- New models into `AUDITED_MODELS` (payroll class) and `MODELS_WITHOUT_SEED_ROWS`;
  `npx vitest run routes leak -u`.
