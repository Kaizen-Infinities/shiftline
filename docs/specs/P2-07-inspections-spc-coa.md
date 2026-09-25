# P2-07 — Inspections, SPC and the certificate of analysis (M6 part B)

## Why

This is the package that makes quality real: material checked before it is accepted, parts checked
while they run, a lot checked before it ships, and a certificate the customer can file. It is also
the evidence base an IATF 16949 or ISO 9001 audit asks for, which is exactly what priority buyer
segment 2 already has to produce with spreadsheets and binders.

Read `docs/specs/P2-00-shop-floor-foundation.md` and **P2-06 must have landed** — every model here
references its characteristics, plans and reasons.

## Scope

- **`Inspection`** (audited): the stage, the plan version it ran against, what was inspected — a GRN
  invoice line for `INCOMING`, an `HourlyProduction` row or production order for `IN_PROCESS`, a lot
  for `FINAL` and `PRE_DISPATCH` — inspector, timestamp, sample size, and the outcome `ACCEPTED`,
  `REJECTED`, `ACCEPTED_WITH_DEVIATION` (which requires an approver and a note).
- **`InspectionResult`**: one row per characteristic per sampled piece — measured value for a
  variable, pass/fail or a defect count for an attribute, the rejection reason where it failed, and
  a computed in-spec flag. Out-of-spec results on a critical characteristic cannot be saved as
  `ACCEPTED` without the deviation path.
- **Incoming inspection on GRN.** `GrnInvoice` has no quality fields today. Add accepted and
  rejected quantities per line and a quality status, and gate stock: material under inspection does
  not become available stock until accepted, and rejected quantity routes to a rejection store or
  back to the supplier as a purchase return. This changes an existing posting path — read
  `modules/grn-invoice/` fully before touching it and keep `updateStock` behaviour intact for
  tenants that do not use inspection.
- **In-process checks** attached to hourly production, driven by the plan's frequency, with the
  operator prompted rather than relied upon to remember.
- **SPC** for variable characteristics: X-bar and R charts from subgroups, with Cp and Cpk against
  the spec limits, and the standard out-of-control rules (a point beyond a control limit, seven
  consecutive on one side, a run of seven trending). Computed on read from `InspectionResult`; no
  separate chart table. Out-of-control raises a notification, and in P2-10 it becomes a CAPA source.
- **Certificate of analysis** on dispatch: a PDF per lot listing the characteristics, their spec and
  the measured results, the lot number and the test date, generated through the existing template
  path in `apps/api/src/templates/` and attached to the goods dispatch.
- Routes `/api/inspections` (create, result entry, complete, deviation approve, list), `/api/spc`
  (chart data, capability), `/api/inspections/coa/:lotId`. New permission module `inspections`
  (`view, record, approve-deviation, export`) in `permissions.ts`, feature `quality`, paths in
  `api-paths.ts`, keys to OWNER, PRODUCTION and STORES; deviation approval to OWNER only.
- Web: an inspection entry screen per stage, an SPC chart view, an incoming-inspection queue on the
  GRN detail, and the COA download on the dispatch detail. Each into `e2e/smoke.spec.ts`.

**Anchor files:** `modules/grn-invoice/` before changing the receipt path; `modules/hourly-production/`
for attaching to an hourly row; `src/templates/` and `modules/documents/` for the COA PDF;
`modules/e-invoice/e-invoice.print.ts` for a document render with data assembled first.

## Out of scope

Gauge R&R and measurement-system analysis; automated measurement capture from instruments; AI-vision
defect detection (a plastics depth-catalogue item); HACCP and batch-genealogy quality templates
(G5); the full PPAP eighteen-element packet, which is the auto-components vertical pack.

## Acceptance

- `inspections.spec.ts`: an inspection runs against a plan version and records that version even
  after the plan is superseded; a variable result outside spec sets the in-spec flag false; a
  critical out-of-spec result cannot be accepted without a deviation and an approver; sample size
  comes from `quality.sampling.ts`; incoming inspection holds stock until accepted, and the accepted
  quantity becomes available while the rejected quantity does not; a tenant not using inspection
  sees unchanged GRN stock behaviour. **Neither `grn-invoice` nor `hourly-production` has an
  integration suite** — before changing the receipt path, write characterisation cases for the
  current stock behaviour of both, prove them green, then add inspection on top and keep them green.
- `spc.spec.ts`: X-bar and R values and Cp/Cpk from a fixed subgroup set match hand-computed values;
  each of the three out-of-control rules fires on a constructed series and does not fire on a
  well-behaved one; an out-of-control point notifies once.
- COA renders for a lot with results and refuses for a lot with none.
- New models into `AUDITED_MODELS` and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
