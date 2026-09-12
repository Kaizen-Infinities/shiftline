# P1-15 — TDS and TCS

## Why

A manufacturer holding back tax on what it pays, and collecting it on some of what it sells, has
three obligations that are easy to get wrong and expensive to get wrong: deduct at the right rate,
pay it to the government by the 7th of the next month, and report every deduction quarterly against
the challan that paid it. A deduction that never reaches a challan sinks the whole quarterly
return, and a return filed without it costs ₹200 a day.

## Scope

- **Sections and rates** — the tenant's own table, seeded on first use from the standard list
  (194C, 194J, 194H, 194I(a)/(b), 194Q, 194A, 206C(1), 206C(1H)). Rates move with every Finance
  Act, so the tenant edits them. Both numbers travel together: `code` is the familiar one the
  return carries, `actCode` says where the Income-tax Act 2025 now puts it (393 for deduction,
  394 for collection).
- **Rate decision** — in order: threshold not yet crossed → nothing; no valid PAN → 20% (s.206AA);
  a payee flagged a non-filer → `max(2 × ordinary, 5%)` (s.206AB); otherwise the payee's type rate.
  194Q and 206C(1H) tax only the part **above** the annual threshold, so the threshold accumulates
  against gross paid in the year while the rate is applied to the excess.
- **Deductions** — one row per bill or payment, carrying both what the payee was paid
  (`amountPaid`, what thresholds and the return use) and what the rate actually hit
  (`taxableAmount`). Cancelled, never deleted: a filed return may cite it.
- **Challans** — ITNS 281: BSR code, serial and date from the counterfoil. One challan covers one
  month and one quarter; the server refuses a mixed one, a deduction already on a challan, and a
  BSR code that is not seven digits.
- **Quarterly returns** — 26Q (residents) and 27Q (non-residents) built from the quarter's
  deductions, grouped by challan, exported as the `^`-delimited FH/BH/CD/DD/FT text the e-TDS
  utility imports. Registered on the filing approval gate like every other filing; marking it
  filed freezes its deductions at `RETURN_FILED`.
- **Form 16A** — what a payee was deducted in a year or quarter, and what of it is still
  unchallaned.

## Out of scope

Direct filing to TRACES (no credentials yet), correction statements, 24Q (salary TDS — that is
P1-16's, with payroll), and lower-deduction certificates under s.197.

## Shape

`apps/api/src/modules/tds/` — `tds.sections.ts` (seeds, PAN validity and holder type, financial
year and quarter), `tds.service.ts` (rate decision, deduct, challan, cancel, Form 16A),
`tds.returns.ts` (26Q/27Q, e-TDS text, the filing gate), `tds.routes.ts`. Models `TdsSection`,
`TdsDeduction`, `TdsChallan`; `Supplier.deducteeType` / `higherRate206AB`; `Company.tan` / `pan`.
Web: `/compliance/tds`, four tabs — deductions (with the challan dialog), challans, the quarterly
return, and the rate table.

## Done when

Integration tests cover the rate order, both threshold styles, the challan rejections, the return
and its e-TDS text; every query is tenant-scoped; the screen is in the smoke run.
